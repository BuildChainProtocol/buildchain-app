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
 *   a) Releases on the ledger: one payment per payee for a dollar-token draw,
 *      the single test escrow for the pilot
 *   b) Records the draw as funded and counts what was paid against the loan,
 *      in ONE database step (mark_draw_funded), so the two can never disagree
 *   c) Announces it (announceRelease): fee line, emails, notifications, the
 *      activity log and Building Block's notices. That step can be run again
 *      safely if it was cut short; the daily check does so.
 *
 * Usage:
 *   import { runOrchestrator } from '@/lib/xrpl/orchestrator'
 *   const result = await runOrchestrator(drawId)
 */

import { createClient } from '@supabase/supabase-js'
import { waitUntil } from '@vercel/functions'
import type { Client } from 'xrpl'
import { getConnectedClient } from './client'
import { isXrplConfigured } from './escrow'
import { isTokenMethod, releaseDraw, releasePayment, ReleaseNeedsNewSignature } from './release'
import { ledgerName, onTestNetwork, pilotNote } from '@/lib/network'
import { appUrl } from '@/lib/app-url'
import { sendEmail } from '@/lib/email/send'
import { drawFundedEmail } from '@/lib/email/templates'

/* eslint-disable @typescript-eslint/no-explicit-any */

// A serverless run is stopped at 60 seconds. Paying a payee takes several
// seconds, so a run stops starting new payments after this long and hands the
// rest to a fresh run.
const PAY_BUDGET_MS = 33 * 1000
const MAX_HOPS = 12

/**
 * For a dollar-token draw, what the ledger actually did, payee by payee: who
 * was paid (with that payment's own transaction) and who is on hold. Null for
 * the pilot method, whose single test escrow stands for the whole draw.
 */
async function ledgerPayments(supabase: any, drawId: string, method: string | null) {
  if (!isTokenMethod(method)) return null
  const { data } = await supabase.from('draw_payments').select('*').eq('draw_request_id', drawId).order('seq')
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

/** Another run is paying this draw right now, or the rest was handed to a fresh run. Not a failure. */
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
  /** Whether the release was made and the draw transitioned to 'funded' */
  escrowFinished: boolean
  /** XRPL release transaction hash (the first payee's, for a dollar-token draw) */
  finishHash?: string
  /** Reason string when conditions not met or error occurred */
  reason?: string
}

function serviceDb() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) return null
  return createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
}

/**
 * Hand the rest of a long release to a fresh run. Returns false when that is
 * not possible (no CRON_SECRET, or it has been handed on too many times).
 */
async function continueInNewRun(drawId: string, hop: number): Promise<boolean> {
  const secret = process.env.CRON_SECRET
  if (!secret || hop >= MAX_HOPS) return false
  try {
    // The receiving route answers at once and works in the background.
    const res = await fetch(`${appUrl()}/api/internal/continue-release`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
      body: JSON.stringify({ drawId, hop: hop + 1 }),
      cache: 'no-store',
    })
    return res.ok
  } catch { return false }
}

/**
 * Run the dual-condition verification check for a draw.
 * If both conditions are met on an 'approved' draw, automatically
 * releases it and transitions it to 'funded'.
 *
 * Uses the Supabase service role key because this runs outside the
 * user auth context (triggered by inspector portal or lender action).
 */
export async function runOrchestrator(drawId: string, opts: { hop?: number } = {}): Promise<OrchestratorResult> {
  const startedAt = Date.now()
  const hop = opts.hop ?? 0
  const none = { drawId, conditionsMet: false, inspectionCondition: false, lienWaiverCondition: false, escrowFinished: false }

  const supabase = serviceDb()
  if (!supabase) {
    console.warn('[Orchestrator] Missing SUPABASE_SERVICE_ROLE_KEY — cannot auto-fund')
    return { ...none, reason: 'SUPABASE_SERVICE_ROLE_KEY not configured' }
  }

  // credential_nft_id lives on the inspections table (minted when inspection passes).
  // lien_waiver_nft_id lives directly on draw_requests (minted when lender confirms waiver).
  const { data: draw, error } = await supabase
    .from('draw_requests')
    .select(`
      id, status, amount, net_amount, settlement_amount, request_number, project_id,
      inspection_done, lien_waiver,
      lien_waiver_nft_id,
      escrow_sequence, escrow_txn_hash, escrow_finish_after,
      settlement_method, settlement_state, settlement_payee, escrow_owner,
      inspections!draw_request_id ( id, status, credential_nft_id ),
      projects ( name, lenders ( profile_id, xrp_address ) )
    `)
    .eq('id', drawId)
    .single()

  if (error || !draw) return { ...none, reason: `Draw not found: ${error?.message ?? 'unknown'}` }

  // Orchestrator only acts on approved draws (escrow already exists)
  if (draw.status !== 'approved') {
    return { ...none, reason: `Draw status is '${draw.status}' — orchestrator only runs on approved draws` }
  }

  // ── Evaluate both conditions (Patent §V) ─────────────────────────────────────
  const inspectionRows = (draw as any).inspections ?? []
  const passedInspection = inspectionRows.find(
    (i: { status: string; credential_nft_id: string | null }) => i.status === 'passed' && !!i.credential_nft_id
  )
  const credentialNftId: string | null = passedInspection?.credential_nft_id ?? null

  // Condition 1: inspector passed AND credential NFT is on-ledger
  const inspectionCondition = draw.inspection_done === true && !!credentialNftId
  // Condition 2: lien waiver confirmed AND lien waiver NFT is on-ledger
  const lienWaiverCondition = draw.lien_waiver === true && !!draw.lien_waiver_nft_id

  if (!inspectionCondition || !lienWaiverCondition) {
    return {
      drawId, conditionsMet: false, inspectionCondition, lienWaiverCondition, escrowFinished: false,
      reason: [
        !inspectionCondition && (!draw.inspection_done ? 'Inspection not yet passed' : 'Inspector credential NFT not yet minted'),
        !lienWaiverCondition && (!draw.lien_waiver ? 'Lien waiver not yet confirmed' : 'Lien waiver NFT not yet minted'),
      ].filter(Boolean).join('; '),
    }
  }

  // ── Both conditions met — execute release (Patent §V) ────────────────────────
  console.log(`[Orchestrator] ✓ Dual-condition satisfied for draw ${drawId} — initiating release`)
  const result: OrchestratorResult = { drawId, conditionsMet: true, inspectionCondition: true, lienWaiverCondition: true, escrowFinished: false }

  try {
    let escrowFinishHash: string | null = null
    // Dollar-token draws: the total actually paid to payees, from the ledger record.
    let releasedUsd: number | null = null
    const method = (draw as any).settlement_method as string | null
    const tokenSettled = isTokenMethod(method)

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
      const payments = async () => ((await supabase
        .from('draw_payments').select('*, payment_signatures ( txjson, signed_blob )')
        .eq('draw_request_id', drawId).order('seq')).data ?? []) as any[]
      const unsigned = (rows: any[]) => rows.filter(p => p.status === 'pending' || p.status === 'awaiting_signature')
      const list = await payments()
      // A payee the lender still has to sign for holds the draw: it is paid
      // out together, once every payee is either signed for or on hold.
      if (unsigned(list).length) throw new WaitingOnLender(`Waiting for the lender to sign for ${unsigned(list).length} payee(s)`)

      const lenderWallet: string | null = (draw.projects as any)?.lenders?.xrp_address ?? null
      const failures: string[] = []
      const needSign: string[] = []
      let inProgress = false
      let outOfTime = false
      const stamp = () => new Date().toISOString()
      // One ledger connection for the whole draw.
      let client: Client | null = null
      try {
        for (const p of list) {
          if (p.status === 'released') continue
          if (!['locked', 'failed', 'releasing'].includes(p.status)) continue      // held or withdrawn: not paid
          if (Date.now() - startedAt > PAY_BUDGET_MS) { outOfTime = true; break }
          // Claim the payment, so two runs at once can never both submit it.
          // A claim left behind by a run that died is taken over after 3 minutes.
          let claimed: any[] | null = null
          if (p.status === 'locked' || p.status === 'failed') {
            claimed = (await supabase.from('draw_payments').update({ status: 'releasing', updated_at: stamp() })
              .eq('id', p.id).in('status', ['locked', 'failed']).select('id')).data
          } else if (Date.now() - new Date(p.updated_at).getTime() > 3 * 60 * 1000) {
            claimed = (await supabase.from('draw_payments').update({ updated_at: stamp() })
              .eq('id', p.id).eq('status', 'releasing').eq('updated_at', p.updated_at).select('id')).data
          }
          if (!claimed?.length) { inProgress = true; continue }

          const sig = Array.isArray(p.payment_signatures) ? p.payment_signatures[0] : p.payment_signatures
          try {
            if (!client) client = await getConnectedClient()
            const done = await releasePayment(
              { ...p, lender_sign_tx: sig?.txjson ?? null, lender_signed_blob: sig?.signed_blob ?? null },
              method as 'token_escrow' | 'two_signature', lenderWallet, client)
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
              // The ledger's own history shows this signature can never pay
              // and did not pay. Nothing is locked by it: ask to sign again.
              needSign.push(p.payee_name ?? 'a payee')
              await supabase.from('draw_payments').update({ status: 'pending', release_ticket: null, updated_at: stamp() })
                .eq('id', p.id).eq('status', 'releasing')
              await supabase.from('payment_signatures').delete().eq('payment_id', p.id)
            } else {
              failures.push(`${p.payee_name ?? 'payee'}: ${m.slice(0, 160)}`)
              await supabase.from('draw_payments').update({ status: 'failed', updated_at: stamp() })
                .eq('id', p.id).eq('status', 'releasing')
              // A broken connection would fail every payee after this one too.
              try { await client?.disconnect() } catch { /* already gone */ }
              client = null
            }
          }
        }
      } finally {
        try { await client?.disconnect() } catch { /* already gone */ }
      }

      if (needSign.length) {
        await supabase.from('draw_requests').update({ settlement_state: 'awaiting_lender_signature' })
          .eq('id', drawId).eq('status', 'approved')
        const lenderProfile = (draw.projects as any)?.lenders?.profile_id
        if (lenderProfile) {
          await supabase.from('notifications').insert({
            user_id: lenderProfile, type: 'signature_needed', title: 'A payment needs your signature again',
            body: `Draw ${draw.request_number}: the release for ${needSign.join(', ')} could not be used and nothing was paid on it. ` +
                  'Open the draw under Approved and choose "Sign for remaining payees". If it is not signed within a day, that payee goes on hold and the rest of the draw is released.',
            link: '/lender/approvals',
          })
        }
        throw new Error(`The lender has to sign again for ${needSign.join(', ')}; that release could not be used and was not paid.` +
          (failures.length ? ` Also failed: ${failures.join('; ')}` : ''))
      }
      if (failures.length) throw new Error(`${failures.length} payment(s) could not be released. ${failures.join('; ')}`)
      if (outOfTime) {
        if (await continueInNewRun(drawId, hop)) throw new ReleaseInProgress('The remaining payees are being paid in a follow-on run')
        throw new Error('This draw has more payees than one run can pay and the rest could not be handed on. Use "Check again" to pay the remaining payees.')
      }

      // Read the record back: it decides what happens next, not this run's memory.
      const now = await payments()
      // Another run paid some payees and may still be at it.
      if (inProgress && now.some(p => ['locked', 'releasing', 'failed'].includes(p.status))) {
        throw new ReleaseInProgress('Another run is releasing this draw')
      }
      // The lender may have started signing for a held payee while this ran.
      if (unsigned(now).length) throw new WaitingOnLender(`Waiting for the lender to sign for ${unsigned(now).length} payee(s)`)
      const paid = now.filter(p => p.status === 'released')
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

    // Verification Receipt (Patent §V)
    const verificationReceipt = {
      verified_at: new Date().toISOString(),
      inspector_credential_nft: credentialNftId,   // from inspections table
      lien_waiver_nft: draw.lien_waiver_nft_id,    // from draw_requests table
      escrow_finish_hash: escrowFinishHash,
      trigger: 'dual_condition_satisfied',
      patent_ref: 'BLDCHN-001-P §V',
    }

    // What this release paid: for a dollar-token draw the payments the ledger
    // made (a payee on hold is not in it); for the pilot, the draw's amount.
    const paidAmount: number = tokenSettled ? (releasedUsd as number) : Number(draw.amount)

    // Funded, and counted against the loan, in one database step. Only one
    // caller can win this; the loser has nothing left to do or announce.
    const { data: won, error: fundErr } = await supabase.rpc('mark_draw_funded', {
      p_draw_id: drawId,
      p_amount: paidAmount,
      p_changes: {
        funded_at: new Date().toISOString(),
        verification_receipt: verificationReceipt,
        ...(escrowFinishHash ? { escrow_finish_hash: escrowFinishHash } : {}),
        ...(tokenSettled ? { settlement_state: 'released', settlement_amount: paidAmount } : {}),
      },
    })
    if (fundErr) throw new Error(`The release went through on the ledger but the draw could not be recorded as funded: ${fundErr.message}`)
    result.escrowFinished = true
    if (won !== true) return result

    await announceRelease(supabase, drawId, 'orchestrator')
    console.log(`[Orchestrator] ✓ Draw ${drawId} funded`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // Waiting (on another run, or on the lender) is not a failure: say why
    // and leave it. Nobody is alerted and Building Block is not told it failed.
    if (err instanceof ReleaseInProgress || err instanceof WaitingOnLender) {
      result.reason = message
      return result
    }
    // Two checks can race: the loser finds the escrow already finished. If the
    // draw is funded by now, that is a success, and the winner announces it.
    const { data: after } = await supabase.from('draw_requests').select('status').eq('id', drawId).single()
    if (after?.status === 'funded') {
      result.escrowFinished = true
      return result
    }
    console.error('[Orchestrator] Release failed:', message)
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

  return result
}

/**
 * Tell everyone a draw was released: its fee line, the borrower's email, the
 * in-app notices, the activity log, and Building Block's escrow_released and
 * payment_confirmed notices. Works only from what is recorded on the funded
 * draw, so it can be run again if it was cut short (the daily check does);
 * it marks the draw once it has finished and does nothing after that.
 *
 * `supabase` is the service-key client.
 */
export async function announceRelease(supabase: any, drawId: string, trigger: 'manual' | 'orchestrator'): Promise<boolean> {
  const { data: draw } = await supabase
    .from('draw_requests')
    .select(`
      id, status, amount, net_amount, settlement_amount, settlement_method, request_number, project_id,
      payees, funded_at, escrow_finish_hash, verification_receipt, release_announced_at,
      projects ( name, loan_amount, amount_drawn,
        borrowers ( profile_id, email, company_name ),
        lenders   ( profile_id, company_name ) )
    `)
    .eq('id', drawId).single()
  if (!draw || draw.status !== 'funded' || draw.release_announced_at) return false

  const tokenSettled = isTokenMethod(draw.settlement_method)
  const paidAmount = tokenSettled ? Number(draw.settlement_amount ?? 0) : Number(draw.amount)
  const fundedAt: string = draw.funded_at ?? new Date().toISOString()
  const project = draw.projects as any
  const borrowerRow = project?.borrowers as any
  const lenderRow = project?.lenders as any
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try { await fn() } catch (err) { console.warn(`[Release notice] ${name} failed (non-fatal):`, err instanceof Error ? err.message : err) }
  }

  // The fee line (it reports its own failure to the owner).
  await step('fee line', async () => {
    const { recordFeeAccrual } = await import('@/lib/fees')
    await recordFeeAccrual({ ...draw, settlement_amount: tokenSettled ? paidAmount : draw.settlement_amount, funded_at: fundedAt })
  })

  // Building Block: the release with payments[], then one notice per paid payee.
  await step('Building Block notices', async () => {
    const { data: lineItems } = await supabase
      .from('draw_line_items').select('bb_pay_app_id, sub_code, current_payment_due').eq('draw_request_id', drawId)
    const { sendEscrowReleasedWebhooks } = await import('@/lib/webhooks/building-block')
    await sendEscrowReleasedWebhooks({
      bcDrawId:         drawId,
      escrowFinishHash: draw.escrow_finish_hash ?? null,
      netAmount:        draw.net_amount ?? draw.amount,
      payees:           draw.payees ?? null,
      lineItems:        lineItems ?? [],
      payments:         await ledgerPayments(supabase, drawId, draw.settlement_method),
      releasedAmount:   tokenSettled ? paidAmount : null,
      fundedAt,
      trigger,
    })
  })

  // The borrower's email (address from the account, which is the reliable one).
  await step('borrower email', async () => {
    if (!borrowerRow?.profile_id || !project) return
    const { data: bp } = await supabase.from('profiles').select('email, full_name, company_name').eq('id', borrowerRow.profile_id).single()
    const to = bp?.email ?? borrowerRow.email ?? null
    if (!to) return
    const { subject, html } = drawFundedEmail({
      borrowerName: bp?.full_name ?? bp?.company_name ?? borrowerRow.company_name ?? 'Borrower',
      projectName: project.name,
      drawAmount: paidAmount,
      totalDrawn: project.amount_drawn ?? paidAmount,
      loanAmount: project.loan_amount,
      escrowFinishHash: draw.escrow_finish_hash ?? null,
    })
    await sendEmail({ to, subject, html })
  })

  const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
  await step('notifications', async () => {
    if (borrowerRow?.profile_id) {
      await supabase.from('notifications').insert({
        user_id: borrowerRow.profile_id, type: 'draw_funded', title: 'Draw Release Recorded',
        body: trigger === 'orchestrator'
          ? `Draw ${draw.request_number} for ${fmt(paidAmount)} was automatically released on ${ledgerName()}: inspection and lien waiver were both recorded.${pilotNote()}`
          : `Draw ${draw.request_number} for ${fmt(paidAmount)} was released on ${ledgerName()}.${pilotNote()}`,
        link: '/borrower',
      })
    }
    // The lender did not press anything for an automatic release: tell them.
    if (trigger === 'orchestrator' && lenderRow?.profile_id) {
      await supabase.from('notifications').insert({
        user_id: lenderRow.profile_id, type: 'draw_auto_funded', title: '⬡ Draw Auto-Released',
        body: `Draw ${draw.request_number} for ${fmt(paidAmount)} on ${project?.name ?? 'a project'} was automatically released — ` +
              `inspector credential and lien waiver NFTs both recorded on ${ledgerName()}.${pilotNote()}`,
        link: '/lender/approvals',
      })
    }
  })

  await step('activity log', async () => {
    await supabase.from('activity_log').insert({
      project_id: draw.project_id,
      action: trigger === 'orchestrator' ? 'orchestrator_dual_condition_release' : 'draw_funded',
      entity_type: 'draw_request', entity_id: drawId,
      details: { ...(draw.verification_receipt ?? {}), released_amount: paidAmount, xrpl_finish_hash: draw.escrow_finish_hash ?? null },
    })
  })

  await supabase.from('draw_requests').update({ release_announced_at: new Date().toISOString() })
    .eq('id', drawId).is('release_announced_at', null)
  return true
}

/** For callers that want the release notices sent without holding up their answer. */
export function announceReleaseInBackground(supabase: any, drawId: string, trigger: 'manual' | 'orchestrator'): void {
  waitUntil(announceRelease(supabase, drawId, trigger).catch(err =>
    console.warn('[Release notice] failed:', err instanceof Error ? err.message : err)))
}
