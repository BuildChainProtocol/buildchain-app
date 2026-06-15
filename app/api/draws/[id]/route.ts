import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { sendEmail } from '@/lib/email/send'
import { drawApprovedEmail, drawDeclinedEmail, drawFundedEmail } from '@/lib/email/templates'

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
    .select('*, projects(name, borrower_id, borrowers(xrp_address))')
    .eq('id', params.id)
    .single()

  if (fetchError || !draw) {
    return NextResponse.json({ error: 'Draw not found' }, { status: 404 })
  }

  const updates: Record<string, unknown> = {
    ...body,
    reviewed_at: new Date().toISOString(),
  }

  // ─── APPROVE ──────────────────────────────────────────────────────────────
  if (body.status === 'approved') {
    updates.approved_by = user.id

    // XRPL EscrowCreate (optional — non-fatal if ESM/connection fails)
    try {
      const { isXrplConfigured, createDrawEscrow } = await import('@/lib/xrpl/escrow')
      if (isXrplConfigured()) {
        const borrowerXrpAddress = (draw.projects as any)?.borrowers?.xrp_address ?? undefined
        const escrow = await createDrawEscrow({ destinationAddress: borrowerXrpAddress })
        updates.escrow_sequence     = escrow.escrowSequence
        updates.escrow_txn_hash     = escrow.txnHash
        updates.escrow_finish_after = escrow.finishAfter.toISOString()
        console.log(`[XRPL] EscrowCreate OK — seq ${escrow.escrowSequence} hash ${escrow.txnHash}`)
      } else {
        console.log('[XRPL] Not configured — approving draw without escrow')
      }
    } catch (xrplError) {
      const message = xrplError instanceof Error ? xrplError.message : String(xrplError)
      console.warn('[XRPL] Escrow skipped (non-fatal):', message.slice(0, 200))
    }

    // Draw-level XRPL record: the EscrowCreate TX hash above is the record.
    // No separate NFT needed per draw — that would be redundant with the escrow.
    // The loan-level NFT (minted at project origination) is the digital title.
  }

  // ─── FUND: Finish XRPL escrow + update project drawn amount ────────────────
  if (body.status === 'funded') {
    updates.funded_at = new Date().toISOString()

    try {
      const { isXrplConfigured, finishDrawEscrow } = await import('@/lib/xrpl/escrow')

      if (isXrplConfigured() && draw.escrow_sequence != null) {
        const finish = await finishDrawEscrow({ escrowSequence: draw.escrow_sequence })
        updates.escrow_finish_hash = finish.txnHash
        console.log(`[XRPL] EscrowFinish OK — hash ${finish.txnHash}`)
      }
    } catch (xrplError) {
      // Non-fatal: log and continue with status update
      const message = xrplError instanceof Error ? xrplError.message : String(xrplError)
      console.warn('[XRPL] EscrowFinish skipped (non-fatal):', message.slice(0, 200))
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

  // ── Transactional emails ─────────────────────────────────────────────────
  try {
    // Fetch borrower email + name, lender name, and project details
    const { data: project } = await supabase
      .from('projects')
      .select(`
        name, loan_amount, amount_drawn,
        borrowers(email, company_name, profile_id),
        lenders(company_name, profile_id)
      `)
      .eq('id', updated.project_id)
      .single()

    const borrowerRow = project?.borrowers as any
    const lenderRow   = project?.lenders as any

    // Get borrower auth email from profiles (more reliable than borrowers.email)
    let borrowerEmail: string | null = null
    let borrowerName  = 'Borrower'
    if (borrowerRow?.profile_id) {
      const { data: bp } = await supabase
        .from('profiles').select('email, full_name, company_name').eq('id', borrowerRow.profile_id).single()
      borrowerEmail = bp?.email ?? borrowerRow.email ?? null
      borrowerName  = bp?.full_name ?? bp?.company_name ?? borrowerRow.company_name ?? 'Borrower'
    }

    const lenderName = lenderRow?.company_name ?? 'your lender'

    if (borrowerEmail && project) {
      if (body.status === 'approved') {
        const { subject, html } = drawApprovedEmail({
          borrowerName,
          lenderName,
          projectName: project.name,
          drawAmount: draw.amount,
          escrowTxnHash: updated.escrow_txn_hash ?? null,
        })
        await sendEmail({ to: borrowerEmail, subject, html })

      } else if (body.status === 'declined') {
        const { subject, html } = drawDeclinedEmail({
          borrowerName,
          lenderName,
          projectName: project.name,
          drawAmount: draw.amount,
          declineNotes: body.notes ?? null,
        })
        await sendEmail({ to: borrowerEmail, subject, html })

      } else if (body.status === 'funded') {
        // project.amount_drawn already reflects the increment (RPC ran before this email block)
        const { subject, html } = drawFundedEmail({
          borrowerName,
          projectName: project.name,
          drawAmount: draw.amount,
          totalDrawn: project.amount_drawn ?? draw.amount,
          loanAmount: project.loan_amount,
          escrowFinishHash: updated.escrow_finish_hash ?? null,
        })
        await sendEmail({ to: borrowerEmail, subject, html })
      }
    }
  } catch (emailErr) {
    console.warn('[Email] draw status email skipped:', emailErr instanceof Error ? emailErr.message : emailErr)
  }

  return NextResponse.json({ data: updated })
}
