import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { sendEmail } from '@/lib/email/send'
import { drawApprovedEmail, drawDeclinedEmail, drawFundedEmail } from '@/lib/email/templates'
import { isTokenMethod } from '@/lib/xrpl/release'
import { serviceClient } from '@/lib/supabase/service'
import { bearer, sameKey } from '@/lib/api-key'
import { ledgerName, pilotNote } from '@/lib/network'

// Must run on Node.js runtime — xrpl uses WebSockets (not supported in Edge)
export const runtime = 'nodejs'

// GET /api/draws/[id]
// Returns the current draw record. Accepts:
//   - Supabase auth (browser session)
//   - Bearer BUILDINGBLOCK_API_KEY (for Building Block sync polls)
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  // Two auth paths:
  //  - Bearer BUILDINGBLOCK_API_KEY → use service-role client (bypasses RLS)
  //  - Supabase session → use session client (RLS applies)
  const auth = request.headers.get('authorization') || ''
  const bbKey = process.env.BUILDINGBLOCK_API_KEY
  const isBB = sameKey(bearer(auth), bbKey)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let supabase: any
  if (isBB) {
    supabase = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
  } else {
    supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data, error } = await supabase
    .from('draw_requests')
    .select('*')
    .eq('id', params.id)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Draw not found', detail: error?.message }, { status: 404 })
  }
  if (!isBB) return NextResponse.json(data)

  // For Building Block: everything a missed notice would have said. There is
  // no later redelivery of a notice, so this read is how the two are brought
  // back in step.
  const { onTestNetwork } = await import('@/lib/network')
  const { data: pays } = await supabase.from('draw_payments').select('*').eq('draw_request_id', params.id).order('seq')
  const testnet = onTestNetwork()
  return NextResponse.json({
    ...data,
    network: testnet ? 'testnet' : 'mainnet',
    funds_moved: !testnet && data.status === 'funded',
    // Dollar-token loans only: one row per payee, as the ledger stands now.
    payments: ((pays ?? []) as any[]).map(p => ({
      bb_pay_app_id: p.bb_pay_app_id ?? null,
      sub_code: p.sub_code ?? null,
      sub_name: p.payee_name ?? null,
      amount: Number(p.amount),
      status: p.status === 'released' ? 'paid' : p.status === 'held' ? 'held' : p.status === 'failed' ? 'failed' : 'pending',
      tx_hash: p.status === 'released' ? p.release_txn_hash : null,
      wallet: p.status === 'released' ? p.wallet : null,
      held_reason: p.status === 'held' ? p.held_reason : null,
    })),
  })
}

// The only draw statuses a lender or admin may set through this route.
// 'submitted' is accepted only to take a held draw off hold.
const SETTABLE_STATUSES = new Set(['approved', 'held', 'declined', 'funded', 'submitted'])

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient()

  // Only these fields are ever read from the request. Nothing else the caller
  // sends can reach the draw row (amounts, escrow hashes, NFT ids, payees and
  // wallets are set by the server alone).
  let raw: Record<string, unknown>
  try { raw = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 2000) : undefined)
  const body: {
    status?: string
    lien_waiver?: true
    decline_reason?: string
    hold_reason?: string
    notes?: string
  } = {
    ...(typeof raw?.status === 'string' ? { status: raw.status } : {}),
    ...(raw?.lien_waiver === true ? { lien_waiver: true as const } : {}),
    ...(text(raw?.decline_reason) ? { decline_reason: text(raw.decline_reason) } : {}),
    ...(text(raw?.hold_reason) ? { hold_reason: text(raw.hold_reason) } : {}),
    ...(text(raw?.notes) ? { notes: text(raw.notes) } : {}),
  }
  if (body.status !== undefined && !SETTABLE_STATUSES.has(body.status)) {
    return NextResponse.json({ error: `status must be one of: ${Array.from(SETTABLE_STATUSES).join(', ')}` }, { status: 400 })
  }
  if (body.status === undefined && body.lien_waiver === undefined) {
    return NextResponse.json({ error: 'Nothing to update: send a status or lien_waiver: true' }, { status: 400 })
  }

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !['admin', 'lender'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Fetch the draw before we mutate anything
  const { data: draw, error: fetchError } = await supabase
    .from('draw_requests')
    .select('*, projects(name, borrower_id, settlement_method, borrowers(xrp_address), lenders(profile_id))')
    .eq('id', params.id)
    .single()

  if (fetchError || !draw) {
    return NextResponse.json({ error: 'Draw not found' }, { status: 404 })
  }
  // Being able to read the draw is not enough (its borrower can too): only an
  // admin or this project's own lender decides it.
  if (profile.role !== 'admin' && (draw.projects as any)?.lenders?.profile_id !== user.id) {
    return NextResponse.json({ error: 'Only this loan\'s lender can decide its draws' }, { status: 403 })
  }

  // ── State guards ────────────────────────────────────────────────────────
  // The caller may act on this draw (row-level security let them read it and
  // their role is checked above). The database accepts changes to a draw's
  // state only from the server, so the writes below use the service key.
  const admin = serviceClient()

  // A funded or declined draw is final. Approving twice would lock a second
  // escrow, so a repeat approval returns the draw as it is.
  if (body.status && (draw.status === 'funded' || draw.status === 'declined') && body.status !== draw.status) {
    return NextResponse.json({ error: `This draw is already ${draw.status} and can no longer be changed` }, { status: 409 })
  }
  if (body.status === 'approved' && draw.status === 'approved') {
    return NextResponse.json({ data: draw })
  }
  if (body.status === 'submitted' && draw.status !== 'held') {
    return NextResponse.json({ error: 'Only a draw that is on hold can be returned to review' }, { status: 409 })
  }
  if (body.status === 'held' && !['submitted', 'pending'].includes(draw.status)) {
    return NextResponse.json({ error: 'Only a draw awaiting review can be put on hold' }, { status: 409 })
  }
  if (body.status === 'funded' && draw.status !== 'approved' && draw.status !== 'funded') {
    return NextResponse.json({ error: 'Only an approved draw can be funded' }, { status: 409 })
  }

  // A draw the lender has locked by signature is undone on the Funding page
  // (withdraw the approval, or take back the escrow), not by a status click:
  // the signature or the escrow would otherwise outlive the decision.
  if ((body.status === 'declined' || body.status === 'held') && (draw as any).settlement_state === 'locked') {
    return NextResponse.json(
      { error: 'This draw is locked by the lender\'s signature. Withdraw the approval or take back the escrow on the Funding page first.' },
      { status: 409 }
    )
  }
  // Signing still in progress: a payee the lender has already signed for is
  // locked on the ledger, so the same rule applies. Otherwise the open
  // request is cancelled along with the draw's payment list.
  if ((body.status === 'declined' || body.status === 'held') && (draw as any).settlement_state === 'awaiting_lender_signature') {
    const { count: signedFor } = await admin.from('draw_payments')
      .select('id', { count: 'exact', head: true }).eq('draw_request_id', params.id).eq('status', 'locked')
    if (signedFor) {
      return NextResponse.json(
        { error: 'The lender has already signed for part of this draw. Withdraw those approvals on the Funding page first.' },
        { status: 409 }
      )
    }
    await admin.from('draw_payments').delete().eq('draw_request_id', params.id)
  }

  const updates: Record<string, unknown> = {
    ...((body.status === 'declined' || body.status === 'held') && (draw as any).settlement_state === 'awaiting_lender_signature'
      ? { settlement_state: null, release_ticket: null } : {}),
    ...(body.status ? { status: body.status } : {}),
    ...(body.lien_waiver ? { lien_waiver: true } : {}),
    ...(body.status === 'declined' && body.decline_reason ? { decline_reason: body.decline_reason } : {}),
    reviewed_at: new Date().toISOString(),
  }

  // ─── APPROVE ──────────────────────────────────────────────────────────────
  if (body.status === 'approved') {
    updates.approved_by = user.id

    // Dollar-token settlement: the lender locks the draw by signing it in
    // their own wallet (see /api/draws/[id]/sign). Approval only records that.
    const tokenSettled = isTokenMethod((draw.projects as any)?.settlement_method)
    if (tokenSettled && (draw as any).settlement_state !== 'locked') {
      return NextResponse.json(
        { error: 'The lender signs this draw in their wallet before it can be approved', code: 'signature_needed' },
        { status: 409 }
      )
    }

    // Pilot method: BuildChain's test wallet creates the escrow.
    // A draw that was held and is approved again keeps the escrow it has.
    if (!tokenSettled && draw.escrow_sequence == null) try {
      const { isXrplConfigured, createDrawEscrow } = await import('@/lib/xrpl/escrow')
      if (isXrplConfigured()) {
        // Prefer gc_wallet (set by BB on submit) over the borrower's registered XRP address
        const gcWallet = (draw as any).gc_wallet ?? undefined
        const borrowerXrpAddress = gcWallet ?? ((draw.projects as any)?.borrowers?.xrp_address ?? undefined)
        const escrow = await createDrawEscrow({
          destinationAddress: borrowerXrpAddress,
          drawAmountUsd: draw.amount,
          drawRequestId: params.id,
          projectId: draw.project_id,
        })
        updates.escrow_sequence     = escrow.escrowSequence
        updates.escrow_txn_hash     = escrow.txnHash
        updates.escrow_finish_after = escrow.finishAfter.toISOString()
        console.log(`[XRPL] EscrowCreate OK — seq ${escrow.escrowSequence} hash ${escrow.txnHash}`)
      } else {
        console.log('[XRPL] Not configured — approving draw without escrow')
      }
    } catch (xrplError) {
      // Never record an approval the ledger does not back: the draw stays as
      // it was and the lender sees why.
      const message = xrplError instanceof Error ? xrplError.message : String(xrplError)
      console.error('[XRPL] EscrowCreate failed — draw not approved:', message.slice(0, 300))
      return NextResponse.json(
        { error: `The escrow could not be created on the XRP Ledger, so the draw was not approved. ${message.slice(0, 200)}` },
        { status: 502 }
      )
    }

    // Draw-level XRPL record: the EscrowCreate TX hash above is the record.
    // No separate NFT needed per draw — that would be redundant with the escrow.
    // The loan-level NFT (minted at project origination) is the digital title.
  }

  // ─── FUND: Manual lender-triggered fund ────────────────────────────────────
  // NOTE: Draws with both on-ledger conditions met (inspection credential NFT +
  // lien waiver NFT) are automatically funded by the Verification Orchestrator
  // (lib/xrpl/orchestrator.ts) without requiring this manual path.
  // This path remains as a fallback for draws without on-ledger NFTs.
  if (body.status === 'funded') {
    // Guard: prevent double-funding if the orchestrator already auto-funded this draw
    if (draw.status === 'funded') {
      console.log(`[Draws] Draw ${params.id} is already funded — skipping duplicate fund request`)
      return NextResponse.json({ data: draw })
    }

    // A dollar-token draw is released only by the Verification Orchestrator,
    // once the inspection and the lien waiver are both recorded. That is what
    // the lender signed for, so there is no manual release.
    if (isTokenMethod((draw as any).settlement_method)) {
      return NextResponse.json(
        { error: 'This draw releases automatically once the inspection and the lien waiver are both recorded' },
        { status: 409 }
      )
    }

    updates.funded_at = new Date().toISOString()

    try {
      const { isXrplConfigured } = await import('@/lib/xrpl/escrow')
      const { releaseDraw } = await import('@/lib/xrpl/release')

      if (isXrplConfigured() && draw.escrow_sequence != null) {
        const finish = await releaseDraw(draw as any, 'manual')
        updates.escrow_finish_hash = finish.txnHash
        console.log(`[XRPL] EscrowFinish OK — hash ${finish.txnHash}`)
      }
    } catch (xrplError) {
      // Never mark a draw funded when the release did not happen: tell
      // Building Block, leave the draw approved, and show the lender why.
      const message = xrplError instanceof Error ? xrplError.message : String(xrplError)
      console.error('[XRPL] EscrowFinish failed — draw not funded:', message.slice(0, 300))
      try {
        const { sendBuildingBlockWebhook } = await import('@/lib/webhooks/building-block')
        await sendBuildingBlockWebhook({
          event:      'escrow_failed',
          bc_draw_id: params.id,
          error:      message.slice(0, 500),
          trigger:    'manual',
          failed_at:  new Date().toISOString(),
        })
      } catch (wErr) {
        console.warn('[BB webhook] escrow_failed dispatch failed:', wErr)
      }
      return NextResponse.json(
        { error: `The escrow could not be released on the XRP Ledger, so the draw was not marked funded. ${message.slice(0, 200)}` },
        { status: 502 }
      )
    }

    // The release went through (or no escrow applies): record its fee line and count it as drawn
    {
      const { recordFeeAccrual } = await import('@/lib/fees')
      await recordFeeAccrual(draw as any)
    }
    await admin.rpc('increment_amount_drawn', {
      p_project_id: draw.project_id,
      p_amount: draw.amount,
    })
  }

  // ─── HELD ──────────────────────────────────────────────────────────────────
  if (body.status === 'held') {
    updates.hold_reason = body.hold_reason ?? body.notes ?? null
  }

  // ─── DECLINE ───────────────────────────────────────────────────────────────
  if (body.status === 'declined') {
    updates.declined_by = user.id
  }

  // Apply updates
  const { data: updated, error } = await admin
    .from('draw_requests')
    .update(updates)
    .eq('id', params.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // ─── BB webhooks — per §4 of the BB↔BC integration spec ──────────────
  try {
    const { sendBuildingBlockWebhook, sendEscrowReleasedWebhooks } = await import('@/lib/webhooks/building-block')

    if (body.status === 'approved') {
      await sendBuildingBlockWebhook({
        event:               'draw_approved',
        bc_draw_id:          params.id,
        // Amounts in USD — never XRP or drops
        amount:              updated.amount,
        net_amount:          updated.net_amount ?? updated.amount,
        escrow_txn_hash:     updated.escrow_txn_hash     ?? null,
        xrpl_sequence:       updated.escrow_sequence     ?? null,
        escrow_finish_after: updated.escrow_finish_after ?? null,
        approved_by:         (profile?.role === 'lender' ? user.email : null) ?? user.id,
        approved_at:         updates.reviewed_at,
      })
    }

    if (body.status === 'held') {
      await sendBuildingBlockWebhook({
        event:      'draw_held',
        bc_draw_id: params.id,
        reason:     body.hold_reason ?? body.notes ?? null,
        decided_by: user.id,
        decided_at: updates.reviewed_at,
      })
    }

    if (body.status === 'declined') {
      await sendBuildingBlockWebhook({
        event:      'draw_declined',
        bc_draw_id: params.id,
        reason:     body.decline_reason ?? body.notes ?? null,
        decided_by: user.id,
        decided_at: updates.reviewed_at,
      })
    }

    // waiver_nft_minted is fired later (in the async IIFE below) after NFT minting

    if (body.status === 'funded') {
      // Manual funded path — the same release payload as the orchestrator's
      const { data: lineItems } = await supabase
        .from('draw_line_items')
        .select('bb_pay_app_id, sub_code, current_payment_due')
        .eq('draw_request_id', params.id)

      await sendEscrowReleasedWebhooks({
        bcDrawId:         params.id,
        escrowFinishHash: updated.escrow_finish_hash ?? null,
        netAmount:        updated.net_amount ?? updated.amount,
        payees:           (updated as any).payees ?? null,
        lineItems:        lineItems ?? [],
        fundedAt:         String(updates.reviewed_at),
        trigger:          'manual',
      })
    }
  } catch (webhookErr) {
    console.warn('[BB webhook] dispatch failed (non-fatal):', webhookErr instanceof Error ? webhookErr.message : webhookErr)
  }

  // Activity log
  await supabase.from('activity_log').insert({
    project_id: updated.project_id,
    user_id: user.id,
    action: `draw_${body.status ?? 'updated'}`,
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
      ...(body.lien_waiver === true ? { lien_waiver_confirmed: true } : {}),
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
      const { data: bp } = await admin
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
          // body.decline_reason is the authoritative field; body.notes is a fallback
          declineNotes: body.decline_reason ?? body.notes ?? null,
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

    // ── In-app notifications for borrower ───────────────────────────────────
    const borrowerProfileId = borrowerRow?.profile_id
    if (borrowerProfileId) {
      const fmt = (n: number) =>
        new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)

      const notifMap: Record<string, { type: string; title: string; body: string }> = {
        approved: {
          type: 'draw_approved',
          title: 'Draw Request Approved ✓',
          body: `Draw ${updated.request_number} for ${fmt(draw.amount)} has been approved by ${lenderName}.`,
        },
        held: {
          type: 'draw_held',
          title: 'Draw Request On Hold',
          body: body.hold_reason
            ? `Draw ${updated.request_number} has been placed on hold. Reason: ${body.hold_reason}`
            : `Draw ${updated.request_number} has been placed on hold by ${lenderName}. Contact them for details.`,
        },
        declined: {
          type: 'draw_declined',
          title: 'Draw Request Not Approved',
          body: body.decline_reason
            ? `Draw ${updated.request_number} was not approved. Reason: ${body.decline_reason}`
            : `Draw ${updated.request_number} was not approved. Contact ${lenderName} for details.`,
        },
        funded: {
          type: 'draw_funded',
          title: 'Draw Release Recorded',
          body: `Draw ${updated.request_number} for ${fmt(draw.amount)} was released on ${ledgerName()}.${pilotNote()}`,
        },
      }
      const notif = notifMap[body.status]
      if (notif) {
        await supabase.from('notifications').insert({
          user_id: borrowerProfileId,
          ...notif,
          link: '/borrower',
        })
      }
    }
  } catch (emailErr) {
    console.warn('[Email] draw status email/notification skipped:', emailErr instanceof Error ? emailErr.message : emailErr)
  }

  // ── Lien Waiver NFT + Verification Orchestrator (Patent §IV + §V) ────────────
  // When the lender confirms a lien waiver (lien_waiver=true), mint the XLS-20
  // Lien Waiver NFT and run the orchestrator to check dual-condition release.
  //
  // Runs after the response under waitUntil, so it doesn't block the PATCH
  // and Vercel keeps the function alive until the chain finishes (an
  // un-awaited promise can be frozen once the response is sent).
  // The inspector confirmation path is handled in app/api/inspections/[token]/route.ts.
  if (body.lien_waiver === true && updated.status === 'approved') {
    waitUntil((async () => {
      try {
        const { isXrplConfigured, mintLienWaiverNFT } = await import('@/lib/xrpl/escrow')
        const { runOrchestrator } = await import('@/lib/xrpl/orchestrator')

        if ((draw as any).lien_waiver_nft_id) {
          // Confirmed and recorded before: nothing to record again, just re-check release.
          console.log('[Draws] Lien waiver already recorded — checking release')
        } else if (isXrplConfigured()) {
          // Mint Lien Waiver NFT (XLS-20, taxon 2) — Patent §IV
          const nft = await mintLienWaiverNFT({
            drawRequestId: params.id,
            drawNumber: updated.request_number,
            drawAmount: updated.amount,
            waiverType: 'conditional',
            // throughDate and gcSignatureHash will be populated when GC signs via BuildingBlock
            // For now, the lender's confirmation triggers the NFT as proxy for GC waiver receipt
          })

          // Store NFT fields on draw record
          await admin
            .from('draw_requests')
            .update({
              lien_waiver_nft_id:        nft.nftTokenId,
              lien_waiver_nft_hash:      nft.txnHash,
              lien_waiver_nft_minted_at: new Date().toISOString(),
            })
            .eq('id', params.id)

          console.log(`[Draws] Lien Waiver NFT minted — ID ${nft.nftTokenId} hash ${nft.txnHash}`)

          // BB webhook: waiver NFT minted — one event per BB waiver on the draw
          try {
            const { data: bbWaivers } = await (supabase as any)
              .from('lien_waivers')
              .select('bb_waiver_id, bb_pay_app_id')
              .eq('draw_request_id', params.id)
              .not('bb_waiver_id', 'is', null)
            const { sendWaiverNftMintedWebhooks } = await import('@/lib/webhooks/building-block')
            await sendWaiverNftMintedWebhooks({
              bcDrawId:   params.id,
              nftTokenId: nft.nftTokenId,
              nftTxnHash: nft.txnHash,
              mintedAt:   new Date().toISOString(),
              waivers:    bbWaivers ?? [],
            })
          } catch (webhookErr) {
            console.warn('[BB webhook] waiver_nft_minted dispatch failed:', webhookErr)
          }
        } else {
          console.log('[Draws] XRPL not configured — skipping lien waiver NFT mint')
        }

        // Run Verification Orchestrator — checks if inspector credential NFT
        // is also present and auto-releases escrow if dual-condition is satisfied.
        // On release it sends BB escrow_released + payment_confirmed itself.
        const orchResult = await runOrchestrator(params.id)
        console.log(
          `[Draws] Orchestrator result for draw ${params.id}:`,
          `conditions=${orchResult.conditionsMet}`,
          orchResult.escrowFinished ? `auto-funded! hash=${orchResult.finishHash}` : orchResult.reason
        )
      } catch (err) {
        console.warn(
          '[Draws] Lien waiver NFT/Orchestrator non-fatal error:',
          err instanceof Error ? err.message : err
        )
      }
    })())
  }

  return NextResponse.json({ data: updated })
}
