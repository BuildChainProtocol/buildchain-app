/**
 * BuildChain Verification Orchestrator
 *
 * Implements the core dual-condition release logic from the provisional patent:
 * BLDCHN-001-P — "Multi-Condition Verification System and Method for Automated
 * Construction Draw Disbursement Using Distributed Ledger Technology"
 *
 * Patent §V (Verification Orchestrator):
 *   "Both conditions must be satisfied simultaneously... Satisfaction of only
 *    one condition is insufficient to trigger escrow release."
 *
 * The two conditions checked for each open draw:
 *   1. Inspector Credential: inspection_done = true AND credential_nft_id is set
 *      (XLS-20 NFT, taxon 3 — see lib/xrpl/escrow.ts mintInspectorCredentialNFT)
 *   2. Lien Waiver NFT: lien_waiver = true AND lien_waiver_nft_id is set
 *      (XLS-20 NFT, taxon 2 — see lib/xrpl/escrow.ts mintLienWaiverNFT)
 *
 * When both are present, the orchestrator:
 *   a) Generates a Verification Receipt (Patent §V)
 *   b) Submits EscrowFinish to the XRPL (trigger: 'orchestrator')
 *   c) Updates draw status → 'funded', records finish hash
 *   d) Increments project.amount_drawn
 *   e) Sends funded email to borrower
 *   f) Sends in-app notification
 *   g) Logs all events to activity_log
 *   h) Sends Building Block escrow_released (with payments[]) and one
 *      payment_confirmed per payee — the same payload for every trigger
 *
 * Usage:
 *   import { runOrchestrator } from '@/lib/xrpl/orchestrator'
 *   const result = await runOrchestrator(drawId)
 */

import { createClient } from '@supabase/supabase-js'
import { isXrplConfigured } from './escrow'
import { isTokenMethod, releaseDraw, releasePayment, ReleaseNeedsNewSignature } from './release'
import { ledgerName, onTestNetwork, pilotNote } from '@/lib/network'
import { sendEmail } from '@/lib/email/send'
import { drawFundedEmail } from '@/lib/email/templates'

/**
 * For a dollar-token draw, what the ledger actually did, payee by payee: who
 * was paid (with that payment's own transaction) and who is on hold. Null for
 * the pilot method, whose single test escrow stands for the whole draw.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ledgerPayments(supabase: any, drawId: string, method: string | null) {
  if (!isTokenMethod(method)) return null
  const { data } = await supabase.from('draw_payments').select('*').eq('draw_request_id', drawId).order('seq')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map(p => ({
    bb_pay_app_id: p.bb_pay_app_id ?? null,
    sub_code: p.sub_code ?? null,
    sub_name: p.payee_name ?? null,
    amount: Number(p.amount),
    status: (p.status === 'released' ? 'paid' : 'held') as 'paid' | 'held',
    tx_hash: p.status === 'released' ? p.release_txn_hash : null,
    wallet: p.status === 'released' ? p.wallet : null,
    ledger_index: null,
  }))
}

/** Another run is paying this draw right now. Not a failure: nothing to report. */
class ReleaseInProgress extends Error {}
/** The draw is waiting on the lender, not broken. Not a failure either. */
class WaitingOnLender extends Error {}

export interface OrchestratorResult {
  drawId: string
  /** True when BOTH on-ledger conditions are simultaneously satisfied */
  conditionsMet: boolean
  /** Condition 1: inspection_done=true AND credential_nft_id is set */
  inspectionCondition: boolean
  /** Condition 2: lien_waiver=true AND lien_waiver_nft_id is set */
  lienWaiverCondition: boolean
  /** Whether EscrowFinish was submitted and draw transitioned to 'funded' */
  escrowFinished: boolean
  /** XRPL EscrowFinish transaction hash */
  finishHash?: string
  /** Reason string when conditions not met or error occurred */
  reason?: string
}

/**
 * Run the dual-condition verification check for a draw.
 * If both conditions are met on an 'approved' draw, automatically
 * triggers EscrowFinish and transitions to 'funded'.
 *
 * Uses the Supabase service role key because this runs outside the
 * user auth context (triggered by inspector portal or lender action).
 */
export async function runOrchestrator(drawId: string): Promise<OrchestratorResult> {
  // Service role needed to write status updates and send notifications
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceKey) {
    console.warn('[Orchestrator] Missing SUPABASE_SERVICE_ROLE_KEY — cannot auto-fund')
    return {
      drawId, conditionsMet: false, inspectionCondition: false,
      lienWaiverCondition: false, escrowFinished: false,
      reason: 'SUPABASE_SERVICE_ROLE_KEY not configured',
    }
  }

  const supabase = createClient(supabaseUrl, serviceKey)

  // ── Fetch draw with all verification fields ──────────────────────────────────
  // NOTE: credential_nft_id lives on the inspections table (minted when inspection passes).
  // We join inspections here and extract the credential NFT from the passed inspection.
  // lien_waiver_nft_id lives directly on draw_requests (minted when lender confirms waiver).
  const { data: draw, error } = await supabase
    .from('draw_requests')
    .select(`
      id, status, amount, net_amount, settlement_amount, request_number, project_id,
      inspection_done, lien_waiver,
      lien_waiver_nft_id,
      escrow_sequence, escrow_txn_hash, escrow_finish_after,
      settlement_method, settlement_state, settlement_payee, escrow_owner,
      payees,
      inspections!draw_request_id ( id, status, credential_nft_id ),
      projects (
        name, loan_amount, amount_drawn,
        borrowers ( profile_id, email, company_name ),
        lenders   ( profile_id, company_name, xrp_address )
      )
    `)
    .eq('id', drawId)
    .single()

  if (error || !draw) {
    return {
      drawId, conditionsMet: false, inspectionCondition: false,
      lienWaiverCondition: false, escrowFinished: false,
      reason: `Draw not found: ${error?.message ?? 'unknown'}`,
    }
  }

  // Orchestrator only acts on approved draws (escrow already exists)
  if (draw.status !== 'approved') {
    return {
      drawId, conditionsMet: false, inspectionCondition: false,
      lienWaiverCondition: false, escrowFinished: false,
      reason: `Draw status is '${draw.status}' — orchestrator only runs on approved draws`,
    }
  }

  // ── Evaluate both conditions (Patent §V) ─────────────────────────────────────
  // credential_nft_id lives on inspections (minted when inspector passes).
  // Find the passed inspection that has an on-ledger credential NFT.
  const inspectionRows = (draw as any).inspections ?? []
  const passedInspection = inspectionRows.find(
    (i: { status: string; credential_nft_id: string | null }) =>
      i.status === 'passed' && !!i.credential_nft_id
  )
  const credentialNftId: string | null = passedInspection?.credential_nft_id ?? null

  // Condition 1: inspector passed AND credential NFT is on-ledger
  const inspectionCondition = draw.inspection_done === true && !!credentialNftId
  // Condition 2: lien waiver confirmed AND lien waiver NFT is on-ledger
  const lienWaiverCondition = draw.lien_waiver === true && !!draw.lien_waiver_nft_id

  console.log(
    `[Orchestrator] Draw ${drawId}: ` +
    `inspection=${inspectionCondition} (done=${draw.inspection_done}, nft=${credentialNftId ?? 'none'}) | ` +
    `lien_waiver=${lienWaiverCondition} (flag=${draw.lien_waiver}, nft=${draw.lien_waiver_nft_id ?? 'none'})`
  )

  if (!inspectionCondition || !lienWaiverCondition) {
    return {
      drawId,
      conditionsMet: false,
      inspectionCondition,
      lienWaiverCondition,
      escrowFinished: false,
      reason: [
        !inspectionCondition && (
          !draw.inspection_done
            ? 'Inspection not yet passed'
            : 'Inspector credential NFT not yet minted'
        ),
        !lienWaiverCondition && (
          !draw.lien_waiver
            ? 'Lien waiver not yet confirmed'
            : 'Lien waiver NFT not yet minted'
        ),
      ].filter(Boolean).join('; '),
    }
  }

  // ── Both conditions met — execute release (Patent §V) ────────────────────────
  console.log(`[Orchestrator] ✓ Dual-condition satisfied for draw ${drawId} — initiating auto-release`)

  const result: OrchestratorResult = {
    drawId,
    conditionsMet: true,
    inspectionCondition: true,
    lienWaiverCondition: true,
    escrowFinished: false,
  }

  let funded: { at: string; amount: number } | null = null
  try {
    let escrowFinishHash: string | null = null
    // Dollar-token draws: the total actually paid to payees, from the ledger record.
    let releasedUsd: number | null = null

    // Step (b): Submit EscrowFinish to XRPL with 'orchestrator' trigger
    const tokenSettled = isTokenMethod((draw as any).settlement_method)
    // The pilot stands in for a payment with 1 test XRP. Off the test network
    // that would record a real draw as paid when no money moved: refuse.
    if (!tokenSettled && !onTestNetwork()) {
      throw new Error('This project is on the pilot method, which only runs on the test network. Choose a dollar-token method for it before releasing.')
    }
    if (tokenSettled) {
      // One ledger payment per payee. Each is released on its own, and one
      // already released on an earlier attempt is skipped, so trying again
      // after a partial failure only does what is left. The signatures live
      // where no signed-in user can read or change them.
      if (!isXrplConfigured()) throw new Error('The ledger is not configured, so the draw cannot be released')
      const { data: pays } = await supabase
        .from('draw_payments').select('*, payment_signatures ( txjson, signed_blob )')
        .eq('draw_request_id', drawId).order('seq')
      const lenderWallet: string | null = (draw.projects as any)?.lenders?.xrp_address ?? null
      const list = (pays ?? []) as any[]
      // A payee the lender still has to sign for holds the draw: it is paid
      // out together, once every payee is either signed for or on hold.
      const unsigned = list.filter(p => p.status === 'pending' || p.status === 'awaiting_signature')
      if (unsigned.length) {
        throw new WaitingOnLender(`Waiting for the lender to sign for ${unsigned.length} payee(s)`)
      }
      const failures: string[] = []
      const needSign: string[] = []
      let inProgress = false
      const stamp = () => new Date().toISOString()
      for (const p of list) {
        if (p.status === 'released') continue
        // Claim the payment, so two runs at once can never both submit it.
        // A claim left behind by a run that died is taken over after 3 minutes.
        let claimed: any[] | null = null
        if (p.status === 'locked' || p.status === 'failed') {
          claimed = (await supabase.from('draw_payments').update({ status: 'releasing', updated_at: stamp() })
            .eq('id', p.id).in('status', ['locked', 'failed']).select('id')).data
        } else if (p.status === 'releasing' && Date.now() - new Date(p.updated_at).getTime() > 3 * 60 * 1000) {
          claimed = (await supabase.from('draw_payments').update({ updated_at: stamp() })
            .eq('id', p.id).eq('status', 'releasing').eq('updated_at', p.updated_at).select('id')).data
        } else if (p.status !== 'releasing') {
          continue                                    // held or withdrawn: not paid
        }
        if (!claimed?.length) { inProgress = true; continue }

        const sig = Array.isArray(p.payment_signatures) ? p.payment_signatures[0] : p.payment_signatures
        try {
          const done = await releasePayment(
            { ...p, lender_sign_tx: sig?.txjson ?? null, lender_signed_blob: sig?.signed_blob ?? null },
            (draw as any).settlement_method, lenderWallet)
          const { error: markErr } = await supabase.from('draw_payments').update({
            status: 'released', release_txn_hash: done.txnHash, released_at: stamp(), updated_at: stamp(),
          }).eq('id', p.id).eq('status', 'releasing')
          // Paid on the ledger but not written down: stop here, so the draw
          // is not closed with this payee shown as unpaid. The next run finds
          // the payment already made and records it.
          if (markErr) throw new Error(`paid (${done.txnHash}) but could not be recorded: ${markErr.message}`)
        } catch (payErr) {
          const m = payErr instanceof Error ? payErr.message : String(payErr)
          if (payErr instanceof ReleaseNeedsNewSignature) {
            // The lender's signature for this payee can never be used. Nothing
            // was paid and nothing is locked by it: ask them to sign again.
            needSign.push(p.payee_name ?? 'a payee')
            await supabase.from('draw_payments').update({ status: 'pending', release_ticket: null, updated_at: stamp() })
              .eq('id', p.id).eq('status', 'releasing')
            await supabase.from('payment_signatures').delete().eq('payment_id', p.id)
          } else {
            failures.push(`${p.payee_name ?? 'payee'}: ${m.slice(0, 160)}`)
            await supabase.from('draw_payments').update({ status: 'failed', updated_at: stamp() })
              .eq('id', p.id).eq('status', 'releasing')
          }
        }
      }
      if (needSign.length) {
        await supabase.from('draw_requests').update({ settlement_state: 'awaiting_lender_signature' })
          .eq('id', drawId).eq('status', 'approved')
        const lenderProfile = (draw.projects as any)?.lenders?.profile_id
        if (lenderProfile) {
          await supabase.from('notifications').insert({
            user_id: lenderProfile, type: 'signature_needed', title: 'A payment needs your signature again',
            body: `Draw ${draw.request_number}: the release for ${needSign.join(', ')} could not be used and nothing was paid on it. Open the draw to sign again, or it stays unpaid.`,
            link: '/lender/approvals',
          })
        }
        throw new Error(`The lender has to sign again for ${needSign.join(', ')}; that release could not be used and was not paid.` +
          (failures.length ? ` Also failed: ${failures.join('; ')}` : ''))
      }
      if (failures.length) throw new Error(`${failures.length} payment(s) could not be released. ${failures.join('; ')}`)
      if (inProgress) throw new ReleaseInProgress('Another run is releasing this draw')

      // What the ledger actually paid, read back from the record.
      const { data: paidRows } = await supabase.from('draw_payments')
        .select('amount, release_txn_hash').eq('draw_request_id', drawId).eq('status', 'released').order('seq')
      const paid = (paidRows ?? []) as any[]
      if (!paid.length) throw new Error('No payment on this draw has been signed for')
      releasedUsd = Math.round(paid.reduce((t, r) => t + Number(r.amount), 0) * 100) / 100
      escrowFinishHash = paid[0].release_txn_hash ?? null
      result.finishHash = escrowFinishHash ?? undefined
    } else if (isXrplConfigured() && draw.escrow_sequence != null) {
      const finish = await releaseDraw(draw as any, 'orchestrator')
      escrowFinishHash = finish.txnHash
      result.finishHash = escrowFinishHash
      console.log(`[Orchestrator] EscrowFinish OK — hash ${escrowFinishHash}`)
    } else {
      console.log('[Orchestrator] XRPL not configured or no escrow — transitioning without on-chain finish')
    }

    // Step (a): Generate Verification Receipt (Patent §V)
    const verificationReceipt = {
      verified_at: new Date().toISOString(),
      inspector_credential_nft: credentialNftId,   // from inspections table
      lien_waiver_nft: draw.lien_waiver_nft_id,    // from draw_requests table
      escrow_finish_hash: escrowFinishHash,
      trigger: 'dual_condition_satisfied',
      patent_ref: 'BLDCHN-001-P §V',
    }

    // Step (c): Update draw → 'funded'
    const fundedAt = new Date().toISOString()
    const { data: nowFunded } = await supabase
      .from('draw_requests')
      .update({
        status: 'funded',
        funded_at: fundedAt,
        verification_receipt: verificationReceipt,
        ...(escrowFinishHash ? { escrow_finish_hash: escrowFinishHash } : {}),
        ...(tokenSettled ? { settlement_state: 'released', settlement_amount: releasedUsd } : {}),
      })
      .eq('id', drawId)
      .eq('status', 'approved') // Guard: only update if still approved (prevents double-fund race)
      .select('id')

    // Another check released this draw at the same moment and has already
    // counted it and told everyone: do not count or announce it twice.
    if (!nowFunded?.length) {
      result.escrowFinished = true
      return result
    }

    // What this release paid: for a dollar-token draw the payments the ledger
    // made (a payee on hold is not in it); for the pilot, the draw's amount.
    const paidAmount: number = tokenSettled ? (releasedUsd as number) : Number(draw.amount)
    funded = { at: fundedAt, amount: paidAmount }

    // Step (d): Increment project.amount_drawn
    await supabase.rpc('increment_amount_drawn', {
      p_project_id: draw.project_id,
      // A dollar-token draw counts what the ledger actually paid.
      p_amount: paidAmount,
    })

    // ── Fetch updated project amount for emails ──────────────────────────────
    const { data: projectUpdated } = await supabase
      .from('projects')
      .select('amount_drawn')
      .eq('id', draw.project_id)
      .single()

    const project = draw.projects as any
    const borrowerRow = project?.borrowers as any
    const lenderRow = project?.lenders as any
    const lenderName = lenderRow?.company_name ?? 'your lender'

    // Get borrower email from profiles table (auth email — most reliable)
    let borrowerEmail: string | null = null
    let borrowerName = 'Borrower'
    if (borrowerRow?.profile_id) {
      const { data: bp } = await supabase
        .from('profiles')
        .select('email, full_name, company_name')
        .eq('id', borrowerRow.profile_id)
        .single()
      borrowerEmail = bp?.email ?? borrowerRow.email ?? null
      borrowerName = bp?.full_name ?? bp?.company_name ?? borrowerRow.company_name ?? 'Borrower'
    }

    // Step (e): Send funded email
    if (borrowerEmail && project) {
      try {
        const { subject, html } = drawFundedEmail({
          borrowerName,
          projectName: project.name,
          drawAmount: paidAmount,
          totalDrawn: projectUpdated?.amount_drawn ?? paidAmount,
          loanAmount: project.loan_amount,
          escrowFinishHash: escrowFinishHash ?? null,
        })
        await sendEmail({ to: borrowerEmail, subject, html })
        console.log(`[Orchestrator] Funded email sent to ${borrowerEmail}`)
      } catch (emailErr) {
        console.warn('[Orchestrator] Funded email failed (non-fatal):', emailErr instanceof Error ? emailErr.message : emailErr)
      }
    }

    // Step (f): In-app notifications — borrower + lender
    const fmt = (n: number) =>
      new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)

    if (borrowerRow?.profile_id) {
      await supabase.from('notifications').insert({
        user_id: borrowerRow.profile_id,
        type: 'draw_funded',
        title: 'Draw Release Recorded',
        body: `Draw ${draw.request_number} for ${fmt(paidAmount)} was automatically released on ${ledgerName()}: ` +
              `inspection and lien waiver were both recorded.${pilotNote()}`,
        link: '/borrower',
      })
    }

    // Notify lender that the dual-condition auto-release fired — they need to know
    // funds left escrow even though they didn't manually trigger it.
    // lenderRow already has profile_id from the lenders(profile_id, company_name) sub-select above.
    if (lenderRow?.profile_id) {
      await supabase.from('notifications').insert({
        user_id: lenderRow.profile_id,
        type: 'draw_auto_funded',
        title: '⬡ Draw Auto-Released',
        body: `Draw ${draw.request_number} for ${fmt(paidAmount)} on ${project?.name ?? 'a project'} was automatically released — ` +
              `inspector credential and lien waiver NFTs both recorded on ${ledgerName()}.${pilotNote()}`,
        link: '/lender/approvals',
      })
    }

    // Step (g): Activity log
    await supabase.from('activity_log').insert({
      project_id: draw.project_id,
      action: 'orchestrator_dual_condition_release',
      entity_type: 'draw_request',
      entity_id: drawId,
      details: verificationReceipt,
    })

    result.escrowFinished = true
    {
      const { recordFeeAccrual } = await import('@/lib/fees')
      await recordFeeAccrual({ ...(draw as any), settlement_amount: tokenSettled ? paidAmount : (draw as any).settlement_amount, funded_at: fundedAt })
    }
    console.log(`[Orchestrator] ✓ Draw ${drawId} auto-funded successfully`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // Waiting (on another run, or on the lender) is not a failure: say why
    // and leave it. Nobody is alerted and Building Block is not told it failed.
    if (err instanceof ReleaseInProgress || err instanceof WaitingOnLender) {
      result.reason = message
      return result
    }
    // Two checks can race: the loser finds the escrow already finished. If the
    // draw is funded by now, that is a success, not a failure to report.
    const { data: after } = await supabase.from('draw_requests').select('status').eq('id', drawId).single()
    if (after?.status === 'funded') {
      result.escrowFinished = true
      return result
    }
    console.error('[Orchestrator] Auto-fund failed:', message)
    result.reason = `Release failed: ${message}`
    {
      const { alertOwner } = await import('@/lib/alerts')
      await alertOwner({
        title: 'A draw could not be released',
        body: `Draw ${draw.request_number} met both conditions but its release failed. It is still approved. Open Draw Requests and use "Check again".`,
        link: '/admin/draws',
        details: { draw: drawId, error: message.slice(0, 300) },
      })
    }

    // Fire escrow_failed webhook — BB must know the auto-release failed
    try {
      const { sendBuildingBlockWebhook } = await import('@/lib/webhooks/building-block')
      await sendBuildingBlockWebhook({
        event:      'escrow_failed',
        bc_draw_id: drawId,
        error:      message.slice(0, 500),
        trigger:    'orchestrator',
        failed_at:  new Date().toISOString(),
      })
    } catch (wErr) {
      console.warn('[Orchestrator] escrow_failed webhook failed (non-fatal):', wErr)
    }
  }

  // ── BB webhooks: the release with payments[], whichever condition came last ──
  // Outside the try above, so a failed notice never reads as a failed release.
  if (result.escrowFinished) {
    try {
      const { data: lineItems } = await supabase
        .from('draw_line_items')
        .select('bb_pay_app_id, sub_code, current_payment_due')
        .eq('draw_request_id', drawId)

      const { sendEscrowReleasedWebhooks } = await import('@/lib/webhooks/building-block')
      await sendEscrowReleasedWebhooks({
        bcDrawId:         drawId,
        escrowFinishHash: result.finishHash ?? null,
        netAmount:        draw.net_amount ?? draw.amount,
        payees:           draw.payees ?? null,
        lineItems:        lineItems ?? [],
        payments:         await ledgerPayments(supabase, drawId, (draw as any).settlement_method),
        releasedAmount:   funded?.amount ?? null,
        fundedAt:         funded?.at ?? new Date().toISOString(),
        trigger:          'orchestrator',
      })
    } catch (webhookErr) {
      console.warn('[Orchestrator] escrow_released webhook failed (non-fatal):', webhookErr instanceof Error ? webhookErr.message : webhookErr)
    }
  }

  return result
}
