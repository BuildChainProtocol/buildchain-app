import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

// Must run on Node.js runtime — xrpl uses WebSockets (not supported in Edge)
export const runtime = 'nodejs'

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const body = await request.json()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !['admin', 'lender'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Fetch the draw before we mutate anything
  const { data: draw, error: fetchError } = await supabase
    .from('draw_requests')
    .select('*, projects(borrower_id, borrowers(xrp_address))')
    .eq('id', params.id)
    .single()

  if (fetchError || !draw) {
    return NextResponse.json({ error: 'Draw not found' }, { status: 404 })
  }

  const updates: Record<string, unknown> = {
    ...body,
    reviewed_at: new Date().toISOString(),
  }

  // ─── APPROVE: Create XRPL escrow ───────────────────────────────────────────
  if (body.status === 'approved') {
    updates.approved_by = user.id

    try {
      // Lazy-load xrpl via dynamic import — avoids loading at module init time
      const { isXrplConfigured, createDrawEscrow } = await import('@/lib/xrpl/escrow')

      if (isXrplConfigured()) {
        const borrowerXrpAddress = (draw.projects as any)?.borrowers?.xrp_address ?? undefined
        const escrow = await createDrawEscrow({ destinationAddress: borrowerXrpAddress })

        updates.escrow_sequence     = escrow.escrowSequence
        updates.escrow_txn_hash     = escrow.txnHash
        updates.escrow_finish_after = escrow.finishAfter.toISOString()

        console.log(`[XRPL] EscrowCreate OK — seq ${escrow.escrowSequence} hash ${escrow.txnHash}`)
      } else {
        console.warn('[XRPL] Not configured — skipping escrow creation')
      }
    } catch (xrplError) {
      const message = xrplError instanceof Error ? xrplError.message : String(xrplError)
      console.error('[XRPL] EscrowCreate failed:', message)
      return NextResponse.json(
        { error: `XRPL escrow failed: ${message}` },
        { status: 502 }
      )
    }
  }

  // ─── FUND: Finish XRPL escrow + update project drawn amount ────────────────
  if (body.status === 'funded') {
    updates.funded_at = new Date().toISOString()

    try {
      // Lazy-load xrpl via dynamic import
      const { isXrplConfigured, finishDrawEscrow } = await import('@/lib/xrpl/escrow')

      if (isXrplConfigured() && draw.escrow_sequence != null) {
        const finish = await finishDrawEscrow({ escrowSequence: draw.escrow_sequence })
        updates.escrow_finish_hash = finish.txnHash
        console.log(`[XRPL] EscrowFinish OK — hash ${finish.txnHash}`)
      }
    } catch (xrplError) {
      const message = xrplError instanceof Error ? xrplError.message : String(xrplError)
      console.error('[XRPL] EscrowFinish failed:', message)
      return NextResponse.json(
        { error: `XRPL escrow release failed: ${message}` },
        { status: 502 }
      )
    }

    // Always increment project amount_drawn, regardless of XRPL
    await supabase.rpc('increment_amount_drawn', {
      p_project_id: draw.project_id,
      p_amount: draw.amount,
    })
  }

  // ─── DECLINE ───────────────────────────────────────────────────────────────
  if (body.status === 'declined') {
    updates.declined_by = user.id
  }

  // Apply updates
  const { data: updated, error } = await supabase
    .from('draw_requests')
    .update(updates)
    .eq('id', params.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // Activity log
  await supabase.from('activity_log').insert({
    project_id: updated.project_id,
    user_id: user.id,
    action: `draw_${body.status}`,
    entity_type: 'draw_request',
    entity_id: params.id,
    details: {
      status: body.status,
      ...(body.status === 'approved' && updated.escrow_txn_hash
        ? { xrpl_escrow_hash: updated.escrow_txn_hash, xrpl_sequence: updated.escrow_sequence }
        : {}),
      ...(body.status === 'funded' && updated.escrow_finish_hash
        ? { xrpl_finish_hash: updated.escrow_finish_hash }
        : {}),
    },
  })

  return NextResponse.json({ data: updated })
}
