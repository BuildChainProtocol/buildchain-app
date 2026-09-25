/**
 * Building Block webhook sender.
 *
 * Implementation contract: §4 of the BB↔BC integration spec.
 *
 * Signing scheme
 * --------------
 * Header:    X-BuildChain-Signature: sha256=<hex HMAC-SHA256(secret, "{ts}.{raw_body}")>
 * Header:    X-BuildChain-Timestamp: <unix seconds>
 * Header:    X-BuildChain-Event-Id:  <stable UUID per event>
 *
 * The HMAC input is  `${unixSeconds}.${rawBodyString}` — NOT just the body.
 * BB verifies with BUILDCHAIN_WEBHOOK_REQUIRE_TS=1 and rejects timestamps
 * older than 600 seconds.
 *
 * Retry policy
 * ------------
 * 3 attempts: immediate → 1 s → 4 s (capped at 10 s per attempt).
 * BB replies:
 *   200        success (also for duplicates / unknown events)
 *   401        bad signature / stale timestamp  → do NOT retry
 *   400        bad body                         → do NOT retry
 *   409        already processing               → do NOT retry
 *   5xx        transient                        → retry
 *
 * Environment variables required
 * --------------------------------
 *   BUILDINGBLOCK_WEBHOOK_URL     e.g. https://building-block.fly.dev
 *   BUILDINGBLOCK_WEBHOOK_SECRET  shared HMAC secret (must match BB side)
 *
 * Non-fatal: failures are logged but never throw to callers.
 */

import crypto from 'crypto'

// ── Types ─────────────────────────────────────────────────────────────────────

export type BuildingBlockEvent =
  | 'draw_approved'
  | 'draw_held'
  | 'draw_declined'
  | 'draw_rejected'
  | 'inspector_nft_minted'
  | 'waiver_nft_minted'
  | 'escrow_released'
  | 'payment_confirmed'
  | 'escrow_failed'

/** Per-sub payment row included in escrow_released and payment_confirmed webhooks */
export interface BBPaymentRow {
  /** BB's pay-app id — the primary match key. Use sub_code as fallback. */
  bb_pay_app_id:  number | null
  sub_code:       string | null
  sub_name:       string | null
  /** USD — never XRP or drops */
  amount:         number
  status:         'paid' | 'pending' | 'failed'
  tx_hash:        string | null   // XRPL EscrowFinish hash
  wallet:         string | null   // Destination XRP address (null when sub wallet unknown)
  ledger_index:   number | null   // XRPL ledger index of finish tx
}

export interface BuildingBlockWebhookPayload {
  event:      BuildingBlockEvent
  bc_draw_id: string
  event_id?:  string   // server fills if omitted
  timestamp?: string   // ISO — server fills if omitted
  [key: string]: unknown
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function isConfigured(): boolean {
  return !!process.env.BUILDINGBLOCK_WEBHOOK_URL
}

function sign(unixSeconds: number, rawBody: string): string {
  const secret = process.env.BUILDINGBLOCK_WEBHOOK_SECRET || ''
  if (!secret) return ''
  // Spec: HMAC-SHA256( secret, "{unix_seconds}.{raw_body}" )
  return 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(`${unixSeconds}.${rawBody}`)
    .digest('hex')
}

async function sendWithRetry(
  url: string,
  headers: Record<string, string>,
  body: string,
  eventName: string,
  drawId: string,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  const MAX_ATTEMPTS  = 3
  const RETRY_DELAYS  = [0, 1000, 4000]  // ms before each attempt
  const PER_ATTEMPT_TIMEOUT_MS = 10_000

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (RETRY_DELAYS[attempt] > 0) {
      await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]))
    }
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), PER_ATTEMPT_TIMEOUT_MS)
      const resp = await fetch(url, { method: 'POST', headers, body, signal: controller.signal })
      clearTimeout(timer)

      const text = await resp.text().catch(() => '')

      if (resp.ok) {
        console.log(`[BB webhook] ${eventName} → 200 (attempt ${attempt + 1}) bc_draw_id=${drawId}`)
        return { ok: true, status: resp.status }
      }

      // Do NOT retry on client errors (auth/bad body/duplicate)
      if (resp.status === 401 || resp.status === 400 || resp.status === 409) {
        console.warn(`[BB webhook] ${eventName} → ${resp.status} — not retrying. body=${text.slice(0, 200)}`)
        return { ok: false, status: resp.status, error: text }
      }

      console.warn(`[BB webhook] ${eventName} → ${resp.status} (attempt ${attempt + 1}) — ${text.slice(0, 200)}`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.warn(`[BB webhook] ${eventName} network error (attempt ${attempt + 1}): ${msg}`)
      if (attempt === MAX_ATTEMPTS - 1) return { ok: false, error: msg }
    }
  }
  return { ok: false, error: 'max retries exceeded' }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fire a signed, retried webhook to Building Block.
 *
 * Non-throwing — returns result object. Log lines identify each attempt.
 */
export async function sendBuildingBlockWebhook(
  payload: BuildingBlockWebhookPayload
): Promise<{ ok: boolean; status?: number; body?: string; error?: string }> {
  if (!isConfigured()) {
    return { ok: true, status: 0, body: 'BB webhook URL not configured — skipping' }
  }

  const url = process.env.BUILDINGBLOCK_WEBHOOK_URL!.replace(/\/$/, '') +
              '/api/webhooks/buildchain'

  const unixSeconds = Math.floor(Date.now() / 1000)
  const eventId = payload.event_id || crypto.randomUUID()

  const bodyObj = {
    ...payload,
    event_id:  eventId,
    timestamp: new Date(unixSeconds * 1000).toISOString(),
  }
  const rawBody = JSON.stringify(bodyObj)
  const sig     = sign(unixSeconds, rawBody)

  const headers: Record<string, string> = {
    'Content-Type':           'application/json',
    'X-BuildChain-Timestamp': String(unixSeconds),
    'X-BuildChain-Event-Id':  eventId,
    'User-Agent':             'BuildChain-Webhook/1.0',
  }
  if (sig) headers['X-BuildChain-Signature'] = sig

  return sendWithRetry(url, headers, rawBody, payload.event, payload.bc_draw_id)
}

// ── Convenience builders ──────────────────────────────────────────────────────

/**
 * Build a payments[] array for the escrow_released event from the payees
 * stored on the draw_request row and the XRPL finish transaction details.
 *
 * payees is the JSONB array we stored from BB's submit call.
 * All amounts are USD — we do NOT send XRP or drops.
 */
export function buildPaymentsRows(
  payees: any[] | null,
  drawLineItems: Array<{ bb_pay_app_id: number | null; sub_code: string | null; sub_name?: string | null; current_payment_due: number | null }>,
  opts: {
    escrowFinishHash:  string | null
    ledgerIndex?:      number | null
    destinationWallet: string | null
  },
): BBPaymentRow[] {
  // Prefer payees from the stored JSONB (richer — has bb_pay_app_id + sub_code + amount).
  // Fall back to draw_line_items current_payment_due if payees weren't stored.
  if (payees && payees.length > 0) {
    return payees.map((p: any) => ({
      bb_pay_app_id:  p.bb_pay_app_id ?? null,
      sub_code:       p.sub_code      ?? null,
      sub_name:       p.sub_name      ?? null,
      amount:         Math.round(parseFloat(p.amount || 0) * 100) / 100,
      status:         'paid' as const,
      tx_hash:        opts.escrowFinishHash,
      wallet:         p.wallet ?? opts.destinationWallet ?? null,
      ledger_index:   opts.ledgerIndex ?? null,
    }))
  }

  // Fallback: aggregate from draw_line_items grouped by bb_pay_app_id
  const map = new Map<number | null, BBPaymentRow>()
  for (const li of drawLineItems) {
    const key = li.bb_pay_app_id ?? null
    const existing = map.get(key)
    const amt = parseFloat(String(li.current_payment_due || 0))
    if (existing) {
      existing.amount = Math.round((existing.amount + amt) * 100) / 100
    } else {
      map.set(key, {
        bb_pay_app_id:  key,
        sub_code:       li.sub_code ?? null,
        sub_name:       (li as any).sub_name ?? null,
        amount:         Math.round(amt * 100) / 100,
        status:         'paid',
        tx_hash:        opts.escrowFinishHash,
        wallet:         opts.destinationWallet,
        ledger_index:   opts.ledgerIndex ?? null,
      })
    }
  }
  return [...map.values()]
}
