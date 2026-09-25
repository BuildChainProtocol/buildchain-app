/**
 * POST /api/buildingblock/draws/[id]/decision
 *
 * Server-to-server endpoint — called by Building Block's lender portal when
 * the lender approves, holds, or declines a draw inside Building Block's UI.
 * Authenticated via BUILDINGBLOCK_API_KEY (same key as /api/buildingblock/submit).
 *
 * This mirrors the logic in PATCH /api/draws/[id] but without requiring a
 * Supabase browser session, so Building Block can relay lender decisions
 * programmatically.
 *
 * Body: {
 *   decision: "approved" | "held" | "declined"
 *   decided_by: string          // name or email of the lender user in BB
 *   reason?: string             // required when decision = "declined" | "held"
 *   amount?: number             // net amount if overriding default
 *   currency?: string           // default "USD"
 *   idempotency_key?: string    // optional — BB should send draw_id-based key
 * }
 *
 * Returns: { ok, draw_id, status, escrow_txn_hash? }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

const VALID_DECISIONS = new Set(['approved', 'held', 'declined'])

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createServiceClient(url, key)
}

function unauth(msg: string) {
  return NextResponse.json({ error: msg }, { status: 401 })
}
function bad(msg: string) {
  return NextResponse.json({ error: msg }, { status: 400 })
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  // ── Auth: Bearer BUILDINGBLOCK_API_KEY ───────────────────────────────────
  const auth = req.headers.get('authorization') || ''
  const token = auth.replace('Bearer ', '').trim()
  const validKey = process.env.BUILDINGBLOCK_API_KEY
  if (!validKey) {
    return NextResponse.json({ error: 'BUILDINGBLOCK_API_KEY not configured on server' }, { status: 500 })
  }
  if (!token || token !== validKey) return unauth('Invalid or missing API key')

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: any
  try { body = await req.json() } catch { return bad('Invalid JSON body') }

  const { decision, decided_by, reason, amount, currency = 'USD' } = body

  if (!decision || !VALID_DECISIONS.has(decision)) {
    return bad(`decision must be one of: ${[...VALID_DECISIONS].join(', ')}`)
  }
  if (!decided_by) return bad('decided_by is required')
  if ((decision === 'declined' || decision === 'held') && !reason) {
    return bad(`reason is required when decision is "${decision}"`)
  }

  const drawId = params.id

  // ── Fetch draw ────────────────────────────────────────────────────────────
  const supabase = getServiceClient()
  const { data: draw, error: fetchErr } = await supabase
    .from('draw_requests')
    .select('*, projects(name, borrower_id, borrowers(xrp_address))')
    .eq('id', drawId)
    .single()

  if (fetchErr || !draw) {
    return NextResponse.json({ error: 'Draw not found', detail: fetchErr?.message }, { status: 404 })
  }

  // ── Guard: prevent double-funding ─────────────────────────────────────────
  if (decision === 'approved' && draw.status === 'approved') {
    console.log(`[BB decision] Draw ${drawId} already approved — returning existing record`)
    return NextResponse.json({
      ok: true,
      draw_id: drawId,
      status: 'approved',
      idempotent: true,
      escrow_txn_hash: draw.escrow_txn_hash ?? null,
    })
  }

  const updates: Record<string, unknown> = {
    status: decision === 'held' ? 'submitted' : decision,   // "held" keeps BC in submitted; BB tracks hold
    reviewed_at: new Date().toISOString(),
    reviewed_by_note: `Building Block: ${decided_by}`,
    ...(decision === 'declined' ? { declined_by: decided_by, decline_reason: reason } : {}),
    ...(decision === 'held' ? { hold_reason: reason } : {}),
  }

  // ── APPROVE: trigger XRPL EscrowCreate ───────────────────────────────────
  if (decision === 'approved') {
    updates.approved_by = decided_by
    try {
      const { isXrplConfigured, createDrawEscrow } = await import('@/lib/xrpl/escrow')
      if (isXrplConfigured()) {
        // Prefer gc_wallet (set by BB on submit) over the borrower's registered XRP address
        const gcWallet = (draw as any).gc_wallet ?? undefined
        const borrowerXrpAddress = gcWallet ?? ((draw.projects as any)?.borrowers?.xrp_address ?? undefined)
        const escrow = await createDrawEscrow({
          destinationAddress: borrowerXrpAddress,
          drawAmountUsd: amount ?? draw.net_amount ?? draw.amount,
          drawRequestId: drawId,
          projectId: draw.project_id,
        })
        updates.escrow_sequence     = escrow.escrowSequence
        updates.escrow_txn_hash     = escrow.txnHash
        updates.escrow_finish_after = escrow.finishAfter.toISOString()
        console.log(`[XRPL] EscrowCreate OK (BB decision) — seq ${escrow.escrowSequence} hash ${escrow.txnHash}`)
      } else {
        console.log('[XRPL] Not configured — approving draw without escrow (BB decision path)')
      }
    } catch (xrplError) {
      const msg = xrplError instanceof Error ? xrplError.message : String(xrplError)
      console.warn('[XRPL] Escrow skipped (non-fatal):', msg.slice(0, 200))
    }
  }

  // ── Apply updates ─────────────────────────────────────────────────────────
  const { data: updated, error: updateErr } = await supabase
    .from('draw_requests')
    .update(updates)
    .eq('id', drawId)
    .select()
    .single()

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 })
  }

  // ── Audit log ─────────────────────────────────────────────────────────────
  await supabase.from('activity_log').insert({
    project_id: updated.project_id,
    user_id: null,
    action: `draw_${decision}_via_building_block`,
    entity_type: 'draw_request',
    entity_id: drawId,
    details: {
      decided_by,
      decision,
      reason: reason ?? null,
      amount: amount ?? null,
      currency,
      source: 'building_block',
      ...(decision === 'approved' && updated.escrow_txn_hash
        ? { xrpl_escrow_hash: updated.escrow_txn_hash, xrpl_sequence: updated.escrow_sequence }
        : {}),
    },
  }).catch((e: any) => console.warn('[BB decision] audit log failed (non-fatal):', e))

  // ── Webhook back to BB (fire-and-forget) ──────────────────────────────────
  if (decision === 'approved') {
    try {
      const { sendBuildingBlockWebhook } = await import('@/lib/webhooks/building-block')
      await sendBuildingBlockWebhook({
        event: 'draw_approved',
        bc_draw_id: drawId,
        escrow_txn_hash:     updated.escrow_txn_hash ?? null,
        xrpl_sequence:       updated.escrow_sequence ?? null,
        escrow_finish_after: updated.escrow_finish_after ?? null,
        approved_by:         decided_by,
        approved_at:         updated.reviewed_at,
        amount:              updated.amount,
        net_amount:          updated.net_amount,
        source:              'building_block_decision',
      })
    } catch (e) {
      console.warn('[BB decision webhook] draw_approved failed (non-fatal):', e)
    }
  }

  // ── Emails (best-effort) ──────────────────────────────────────────────────
  try {
    if (decision === 'approved' || decision === 'declined') {
      const { data: project } = await supabase
        .from('projects')
        .select('name, loan_amount, borrowers(email, company_name, profile_id), lenders(company_name)')
        .eq('id', updated.project_id)
        .single()

      const borrowerRow = (project as any)?.borrowers
      const lenderRow   = (project as any)?.lenders
      let borrowerEmail: string | null = null
      let borrowerName  = 'Borrower'
      if (borrowerRow?.profile_id) {
        const { data: bp } = await supabase
          .from('profiles').select('email, full_name, company_name').eq('id', borrowerRow.profile_id).single()
        borrowerEmail = bp?.email ?? borrowerRow.email ?? null
        borrowerName  = bp?.full_name ?? bp?.company_name ?? borrowerRow.company_name ?? 'Borrower'
      }
      const lenderName = lenderRow?.company_name ?? decided_by ?? 'your lender'
      const { sendEmail } = await import('@/lib/email/send')
      if (borrowerEmail && project) {
        if (decision === 'approved') {
          const { drawApprovedEmail } = await import('@/lib/email/templates')
          const { subject, html } = drawApprovedEmail({
            borrowerName, lenderName, projectName: (project as any).name,
            drawAmount: draw.amount, escrowTxnHash: updated.escrow_txn_hash ?? null,
          })
          await sendEmail({ to: borrowerEmail, subject, html })
        } else if (decision === 'declined') {
          const { drawDeclinedEmail } = await import('@/lib/email/templates')
          const { subject, html } = drawDeclinedEmail({
            borrowerName, lenderName, projectName: (project as any).name,
            drawAmount: draw.amount, declineNotes: reason ?? null,
          })
          await sendEmail({ to: borrowerEmail, subject, html })
        }
      }
    }
  } catch (emailErr) {
    console.warn('[BB decision] email failed (non-fatal):', emailErr instanceof Error ? emailErr.message : emailErr)
  }

  // ── Response ──────────────────────────────────────────────────────────────
  return NextResponse.json({
    ok: true,
    draw_id: drawId,
    status: updated.status,
    decision,
    escrow_txn_hash:     updated.escrow_txn_hash ?? null,
    escrow_sequence:     updated.escrow_sequence ?? null,
    escrow_finish_after: updated.escrow_finish_after ?? null,
    net_amount:          updated.net_amount ?? null,
    reviewed_at:         updated.reviewed_at,
    source:              'building_block',
  })
}
