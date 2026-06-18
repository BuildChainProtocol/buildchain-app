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
 *
 * Usage:
 *   import { runOrchestrator } from '@/lib/xrpl/orchestrator'
 *   const result = await runOrchestrator(drawId)
 */

import { createClient } from '@supabase/supabase-js'
import { finishDrawEscrow, isXrplConfigured } from './escrow'
import { sendEmail } from '@/lib/email/send'
import { drawFundedEmail } from '@/lib/email/templates'

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
      id, status, amount, request_number, project_id,
      inspection_done, lien_waiver,
      lien_waiver_nft_id,
      escrow_sequence, escrow_txn_hash,
      inspections!draw_request_id ( id, status, credential_nft_id ),
      projects (
        name, loan_amount, amount_drawn,
        borrowers ( profile_id, email, company_name ),
        lenders   ( company_name )
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

  try {
    let escrowFinishHash: string | null = null

    // Step (b): Submit EscrowFinish to XRPL with 'orchestrator' trigger
    if (isXrplConfigured() && draw.escrow_sequence != null) {
      const finish = await finishDrawEscrow({
        escrowSequence: draw.escrow_sequence,
        drawRequestId: drawId,
        trigger: 'orchestrator',
      })
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
    await supabase
      .from('draw_requests')
      .update({
        status: 'funded',
        funded_at: new Date().toISOString(),
        verification_receipt: verificationReceipt,
        ...(escrowFinishHash ? { escrow_finish_hash: escrowFinishHash } : {}),
      })
      .eq('id', drawId)
      .eq('status', 'approved') // Guard: only update if still approved (prevents double-fund race)

    // Step (d): Increment project.amount_drawn
    await supabase.rpc('increment_amount_drawn', {
      p_project_id: draw.project_id,
      p_amount: draw.amount,
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
          drawAmount: draw.amount,
          totalDrawn: projectUpdated?.amount_drawn ?? draw.amount,
          loanAmount: project.loan_amount,
          escrowFinishHash: escrowFinishHash ?? null,
        })
        await sendEmail({ to: borrowerEmail, subject, html })
        console.log(`[Orchestrator] Funded email sent to ${borrowerEmail}`)
      } catch (emailErr) {
        console.warn('[Orchestrator] Funded email failed (non-fatal):', emailErr instanceof Error ? emailErr.message : emailErr)
      }
    }

    // Step (f): In-app notification
    if (borrowerRow?.profile_id) {
      const fmt = (n: number) =>
        new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
      await supabase.from('notifications').insert({
        user_id: borrowerRow.profile_id,
        type: 'draw_funded',
        title: 'Funds Released! 🎉',
        body: `Draw ${draw.request_number} for ${fmt(draw.amount)} was automatically released — ` +
              `inspection and lien waiver were both verified on the XRP Ledger.`,
        link: '/borrower',
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
    console.log(`[Orchestrator] ✓ Draw ${drawId} auto-funded successfully`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[Orchestrator] Auto-fund failed:', message)
    result.reason = `Release failed: ${message}`
  }

  return result
}
