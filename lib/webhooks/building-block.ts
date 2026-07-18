/**
 * Building Block webhook sender.
 *
 * Fires signed POSTs to Building Block's /api/webhooks/buildchain endpoint
 * when key BuildChain events happen. Building Block uses these to keep its
 * local BuildChainDraw + PayApplication state in sync with the on-chain reality.
 *
 * Auth: HMAC-SHA256 signature over the raw request body, using the
 *       BUILDINGBLOCK_WEBHOOK_SECRET env var (must match on both sides).
 *       Sent as `X-BuildChain-Signature: sha256=<hex>` header.
 *
 * Environment variables required:
 *   BUILDINGBLOCK_WEBHOOK_URL     e.g. https://building-block.fly.dev
 *   BUILDINGBLOCK_WEBHOOK_SECRET  shared secret (must match BB's env)
 *
 * Non-fatal: if the webhook fails, we log but never block the BC-side action.
 * The receiver is idempotent and can recover from missed events via reconciliation.
 */

import crypto from 'crypto'

export type BuildingBlockEvent =
  | 'draw_approved'
  | 'inspector_nft_minted'
  | 'waiver_nft_minted'
  | 'escrow_released'

export interface BuildingBlockWebhookPayload {
  event: BuildingBlockEvent
  bc_draw_id: string
  timestamp?: string  // ISO — server fills if omitted
  [key: string]: unknown
}

function isConfigured(): boolean {
  return !!process.env.BUILDINGBLOCK_WEBHOOK_URL
}

/**
 * Fire a webhook to Building Block. Non-throwing — returns success bool.
 * Runs synchronously to make sequencing predictable inside API routes.
 */
export async function sendBuildingBlockWebhook(
  payload: BuildingBlockWebhookPayload
): Promise<{ ok: boolean; status?: number; body?: string; error?: string }> {
  if (!isConfigured()) {
    // Silent no-op when BB integration not configured (still works fine on BC alone).
    return { ok: true, status: 0, body: 'BB webhook URL not configured — skipping' }
  }
  const url = process.env.BUILDINGBLOCK_WEBHOOK_URL!.replace(/\/$/, '') +
              '/api/webhooks/buildchain'
  const secret = process.env.BUILDINGBLOCK_WEBHOOK_SECRET || ''
  const body = JSON.stringify({
    timestamp: new Date().toISOString(),
    ...payload,
  })
  const sig = secret
    ? 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex')
    : ''
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10_000)
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(sig ? { 'X-BuildChain-Signature': sig } : {}),
        'User-Agent': 'BuildChain-Webhook/1.0',
      },
      body,
      signal: controller.signal,
    })
    clearTimeout(timer)
    const text = await resp.text().catch(() => '')
    if (!resp.ok) {
      console.warn(`[BB webhook] ${payload.event} → ${resp.status} ${text.slice(0, 200)}`)
      return { ok: false, status: resp.status, body: text }
    }
    console.log(`[BB webhook] ${payload.event} → 200 for bc_draw_id=${payload.bc_draw_id}`)
    return { ok: true, status: resp.status, body: text }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.warn(`[BB webhook] ${payload.event} network error: ${msg}`)
    return { ok: false, error: msg }
  }
}
