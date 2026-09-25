import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { sendEmail } from '@/lib/email/send'
import { drawApprovedEmail, drawDeclinedEmail, drawFundedEmail } from '@/lib/email/templates'

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
  const isBB = !!bbKey && auth === `Bearer ${bbKey}`

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
  return NextResponse.json(data)
}

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

    // XRPL EscrowCreate — now includes drawRequestId + projectId for on-ledger memo
    try {
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
      const message = xrplError instanceof Error ? xrplError.message : String(xrplError)
      console.warn('[XRPL] Escrow skipped (non-fatal):', message.slice(0, 200))
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

    updates.funded_at = new Date().toISOString()

    try {
      const { isXrplConfigured, finishDrawEscrow } = await import('@/lib/xrpl/escrow')

      if (isXrplConfigured() && draw.escrow_sequence != null) {
        const finish = await finishDrawEscrow({
          escrowSequence: draw.escrow_sequence,
          drawRequestId: params.id,
          trigger: 'manual',
        })
        updates.escrow_finish_hash = finish.txnHash
        console.log(`[XRPL] EscrowFinish OK — hash ${finish.txnHash}`)
      }
    } catch (xrplError) {
      // Non-fatal: log, fire escrow_failed webhook, continue with status update
      const message = xrplError instanceof Error ? xrplError.message : String(xrplError)
      console.warn('[XRPL] EscrowFinish failed (non-fatal):', message.slice(0, 200))
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
    }

    // Always increment project amount_drawn, regardless of XRPL
    await supabase.rpc('increment_amount_drawn', {
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
  const { data: updated, error } = await supabase
    .from('draw_requests')
    .update(updates)
    .eq('id', params.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // ─── BB webhooks — per §4 of the BB↔BC integration spec ──────────────
  try {
    const { sendBuildingBlockWebhook, buildPaymentsRows } = await import('@/lib/webhooks/building-block')

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
      // Manual funded path — build payments[] from stored payees / line items
      const { data: lineItems } = await supabase
        .from('draw_line_items')
        .select('bb_pay_app_id, sub_code, current_payment_due')
        .eq('draw_request_id', params.id)

      const gcWallet = (updated as any).gc_wallet ?? null
      const payments = buildPaymentsRows(
        (updated as any).payees ?? null,
        lineItems ?? [],
        {
          escrowFinishHash:  updated.escrow_finish_hash ?? null,
          ledgerIndex:       null,
          destinationWallet: gcWallet ?? ((draw.projects as any)?.borrowers?.xrp_address ?? null),
        }
      )

      await sendBuildingBlockWebhook({
        event:              'escrow_released',
        bc_draw_id:         params.id,
        escrow_finish_hash: updated.escrow_finish_hash ?? null,
        funded_at:          updates.reviewed_at,
        net_amount:         updated.net_amount ?? updated.amount,
        payments,
      })

      // payment_confirmed — one event per payee for per-sub granularity
      await Promise.allSettled(
        payments.map(p =>
          sendBuildingBlockWebhook({
            event:          'payment_confirmed',
            bc_draw_id:     params.id,
            bb_pay_app_id:  p.bb_pay_app_id,
            sub_code:       p.sub_code,
            sub_name:       p.sub_name,
            amount:         p.amount,
            status:         p.status,
            tx_hash:        p.tx_hash,
            wallet:         p.wallet,
            ledger_index:   p.ledger_index,
            confirmed_at:   updates.reviewed_at,
          })
        )
      )
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
          title: 'Funds Released!',
          body: `Draw ${updated.request_number} for ${fmt(draw.amount)} has been funded. Funds are on the way.`,
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
  // This is fire-and-forget (async IIFE) — does not block the PATCH response.
  // The inspector confirmation path is handled in app/api/inspections/[token]/route.ts.
  if (body.lien_waiver === true && updated.status === 'approved') {
    ;(async () => {
      try {
        const { isXrplConfigured, mintLienWaiverNFT } = await import('@/lib/xrpl/escrow')
        const { runOrchestrator } = await import('@/lib/xrpl/orchestrator')

        if (isXrplConfigured()) {
          // Mint Lien Waiver NFT (XLS-20, taxon 2) — Patent §IV
          const nft = await mintLienWaiverNFT({
            drawRequestId: params.id,
            drawNumber: updated.request_number,
            projectId: updated.project_id,
            projectName: (draw.projects as any)?.name ?? 'Unknown Project',
            drawAmount: updated.amount,
            waiverType: 'conditional',
            // throughDate and gcSignatureHash will be populated when GC signs via BuildingBlock
            // For now, the lender's confirmation triggers the NFT as proxy for GC waiver receipt
          })

          // Store NFT fields on draw record
          await supabase
            .from('draw_requests')
            .update({
              lien_waiver_nft_id:        nft.nftTokenId,
              lien_waiver_nft_hash:      nft.txnHash,
              lien_waiver_nft_minted_at: new Date().toISOString(),
            })
            .eq('id', params.id)

          console.log(`[Draws] Lien Waiver NFT minted — ID ${nft.nftTokenId} hash ${nft.txnHash}`)

          // BB webhook: waiver NFT minted
          try {
            const { sendBuildingBlockWebhook } = await import('@/lib/webhooks/building-block')
            await sendBuildingBlockWebhook({
              event: 'waiver_nft_minted',
              bc_draw_id: params.id,
              nft_token_id: nft.nftTokenId,
              nft_txn_hash: nft.txnHash,
              minted_at:    new Date().toISOString(),
              taxon:        2,
            })
          } catch (webhookErr) {
            console.warn('[BB webhook] waiver_nft_minted dispatch failed:', webhookErr)
          }
        } else {
          console.log('[Draws] XRPL not configured — skipping lien waiver NFT mint')
        }

        // Run Verification Orchestrator — checks if inspector credential NFT
        // is also present and auto-releases escrow if dual-condition is satisfied
        const orchResult = await runOrchestrator(params.id)
        console.log(
          `[Draws] Orchestrator result for draw ${params.id}:`,
          `conditions=${orchResult.conditionsMet}`,
          orchResult.escrowFinished ? `auto-funded! hash=${orchResult.finishHash}` : orchResult.reason
        )

        // BB webhook: escrow released (only if orchestrator auto-funded)
        if (orchResult.escrowFinished) {
          try {
            const { sendBuildingBlockWebhook, buildPaymentsRows } = await import('@/lib/webhooks/building-block')
            // Fetch line items to build payments[] — orchestrator doesn't return them
            const { data: orchLineItems } = await supabase
              .from('draw_line_items')
              .select('bb_pay_app_id, sub_code, current_payment_due')
              .eq('draw_request_id', params.id)
            const orchGcWallet = (updated as any).gc_wallet ?? null
            const orchPayments = buildPaymentsRows(
              (updated as any).payees ?? null,
              orchLineItems ?? [],
              {
                escrowFinishHash:  orchResult.finishHash ?? null,
                ledgerIndex:       null,
                destinationWallet: orchGcWallet ?? ((draw.projects as any)?.borrowers?.xrp_address ?? null),
              }
            )
            await sendBuildingBlockWebhook({
              event:              'escrow_released',
              bc_draw_id:         params.id,
              escrow_finish_hash: orchResult.finishHash ?? null,
              funded_at:          new Date().toISOString(),
              net_amount:         updated.net_amount,
              trigger:            'orchestrator',
              payments:           orchPayments,
            })

            // payment_confirmed — one event per payee (per-sub granularity)
            await Promise.allSettled(
              orchPayments.map(p =>
                sendBuildingBlockWebhook({
                  event:         'payment_confirmed',
                  bc_draw_id:    params.id,
                  bb_pay_app_id: p.bb_pay_app_id,
                  sub_code:      p.sub_code,
                  sub_name:      p.sub_name,
                  amount:        p.amount,
                  status:        p.status,
                  tx_hash:       p.tx_hash,
                  wallet:        p.wallet,
                  ledger_index:  p.ledger_index,
                  confirmed_at:  new Date().toISOString(),
                  trigger:       'orchestrator',
                })
              )
            )
          } catch (webhookErr) {
            console.warn('[BB webhook] escrow_released dispatch failed:', webhookErr)
          }
        }
      } catch (err) {
        console.warn(
          '[Draws] Lien waiver NFT/Orchestrator non-fatal error:',
          err instanceof Error ? err.message : err
        )
      }
    })()
  }

  return NextResponse.json({ data: updated })
}
