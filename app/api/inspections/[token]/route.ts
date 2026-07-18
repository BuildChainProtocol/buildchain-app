/**
 * Public API for the inspector portal — no auth required.
 * Only the inspection token grants access.
 *
 * When an inspection passes (status → 'passed'):
 *   1. Mints an XLS-20 Inspector Credential NFT on XRPL (Patent §III)
 *   2. Stores the NFT ID on the inspection record
 *   3. Runs the Verification Orchestrator (Patent §V)
 *      → If lien waiver NFT is also present, auto-releases escrow
 */
import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { sendEmail } from '@/lib/email/send'
import { inspectionPassedEmail, inspectionFailedEmail } from '@/lib/email/templates'

export const runtime = 'nodejs'

// ─── GET /api/inspections/[token] ─────────────────────────────────────────────
// Returns the inspection + associated project + draw info
// (no sensitive borrower/lender data exposed)
export async function GET(
  _request: NextRequest,
  { params }: { params: { token: string } }
) {
  const supabase = createClient()

  const { data: inspection, error } = await supabase
    .from('inspections')
    .select(`
      id, token, status, notes, submitted_at, scheduled_date,
      inspector_name, inspector_email,
      draw_requests (
        request_number, amount, phase, purpose, description
      ),
      projects (
        name, address, city, state, zip
      )
    `)
    .eq('token', params.token)
    .single()

  if (error || !inspection) {
    return NextResponse.json({ error: 'Inspection not found' }, { status: 404 })
  }

  return NextResponse.json({ data: inspection })
}

// ─── PATCH /api/inspections/[token] ───────────────────────────────────────────
// Inspector submits their result
export async function PATCH(
  request: NextRequest,
  { params }: { params: { token: string } }
) {
  const supabase = createClient()

  // Verify token exists and is still pending
  const { data: inspection, error: fetchErr } = await supabase
    .from('inspections')
    .select('id, status, draw_request_id')
    .eq('token', params.token)
    .single()

  if (fetchErr || !inspection) {
    return NextResponse.json({ error: 'Inspection not found' }, { status: 404 })
  }

  if (inspection.status !== 'pending') {
    return NextResponse.json(
      { error: `Inspection already ${inspection.status}` },
      { status: 409 }
    )
  }

  const body = await request.json()
  const { status, notes } = body

  if (!status || !['passed', 'failed'].includes(status)) {
    return NextResponse.json({ error: 'status must be "passed" or "failed"' }, { status: 400 })
  }

  const { data: updated, error: updateErr } = await supabase
    .from('inspections')
    .update({
      status,
      notes: notes?.trim() || null,
      submitted_at: new Date().toISOString(),
    })
    .eq('id', inspection.id)
    .select()
    .single()

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 })
  }

  // If inspection passed, mark the draw's inspection_done flag
  if (status === 'passed') {
    await supabase
      .from('draw_requests')
      .update({ inspection_done: true })
      .eq('id', inspection.draw_request_id)
  }

  // Notify admins via activity log
  try {
    await supabase.from('activity_log').insert({
      action: status === 'passed' ? 'inspection_passed' : 'inspection_failed',
      details: {
        inspection_id: inspection.id,
        draw_request_id: inspection.draw_request_id,
        notes: notes?.trim() || null,
      },
    })
  } catch { /* non-fatal */ }

  // ── In-app + email notifications: borrower (pass/fail) + lender (pass only) ──
  try {
    const fmt = (n: number) =>
      new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)

    // Fetch draw + project + borrower + lender profile data
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: drawCtx } = await (supabase as any)
      .from('draw_requests')
      .select(`
        request_number, amount, phase, purpose,
        projects (
          name,
          borrowers ( profile_id, email, company_name ),
          lenders   ( profile_id )
        )
      `)
      .eq('id', (inspection as any).draw_request_id)
      .single()

    const project      = (drawCtx as any)?.projects
    const borrowerRow  = project?.borrowers
    const lenderRow    = project?.lenders
    const drawNumber   = (drawCtx as any)?.request_number ?? '—'
    const drawAmount   = (drawCtx as any)?.amount ?? 0
    const phase        = (drawCtx as any)?.phase ?? (drawCtx as any)?.purpose ?? null
    const projectName  = project?.name ?? 'your project'

    // Get borrower email from profiles table
    let borrowerEmail: string | null = null
    let borrowerName = 'Borrower'
    if (borrowerRow?.profile_id) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: bp } = await (supabase as any)
        .from('profiles').select('email, full_name, company_name').eq('id', borrowerRow.profile_id).single()
      borrowerEmail = (bp as any)?.email ?? borrowerRow.email ?? null
      borrowerName  = (bp as any)?.full_name ?? (bp as any)?.company_name ?? borrowerRow.company_name ?? 'Borrower'
    }

    // In-app: notify borrower of inspection result
    if (borrowerRow?.profile_id) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).from('notifications').insert({
        user_id: borrowerRow.profile_id,
        type: status === 'passed' ? 'inspection_passed' : 'inspection_failed',
        title: status === 'passed'
          ? '✓ Inspection Passed'
          : 'Inspection Not Passed',
        body: status === 'passed'
          ? `Inspection for Draw #${drawNumber} on ${projectName} passed. Your lender will confirm the lien waiver to complete dual-condition release.`
          : `Inspection for Draw #${drawNumber} on ${projectName} was not approved${notes ? `: ${notes.trim()}` : '. Contact your lender for next steps.'}`,
        link: '/borrower',
      })
    }

    // In-app: notify lender when inspection PASSES — they need to confirm lien waiver next
    if (status === 'passed' && lenderRow?.profile_id) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).from('notifications').insert({
        user_id: lenderRow.profile_id,
        type: 'inspection_condition_met',
        title: '⬡ Condition 1 Satisfied — Action Required',
        body: `Inspector credential NFT minted for Draw #${drawNumber} (${fmt(drawAmount)}) on ${projectName}. Confirm the lien waiver to trigger dual-condition auto-release.`,
        link: '/lender/approvals',
      })
    }

    // Email borrower
    if (borrowerEmail && drawCtx) {
      try {
        if (status === 'passed') {
          const { subject, html } = inspectionPassedEmail({
            borrowerName,
            projectName,
            drawNumber,
            drawAmount,
            inspectorName: (updated as any).inspector_name ?? null,
            phase,
          })
          await sendEmail({ to: borrowerEmail, subject, html })
        } else {
          const { subject, html } = inspectionFailedEmail({
            borrowerName,
            projectName,
            drawNumber,
            drawAmount,
            inspectorName: (updated as any).inspector_name ?? null,
            notes: notes?.trim() ?? null,
          })
          await sendEmail({ to: borrowerEmail, subject, html })
        }
      } catch (emailErr) {
        console.warn('[Inspections] Email send failed (non-fatal):', emailErr instanceof Error ? emailErr.message : emailErr)
      }
    }
  } catch (notifErr) {
    console.warn('[Inspections] Notification block failed (non-fatal):', notifErr instanceof Error ? notifErr.message : notifErr)
  }

  // ── On-ledger credential NFT + Orchestrator (Patent §III + §V) ──────────────
  // Only runs when inspection passes — failed inspections do not trigger NFT mint
  if (status === 'passed') {
    // Fire async — don't block the inspector's portal response
    // Non-fatal: any failure is logged but does not fail the inspection submission
    ;(async () => {
      try {
        const { isXrplConfigured, mintInspectorCredentialNFT } = await import('@/lib/xrpl/escrow')
        const { runOrchestrator } = await import('@/lib/xrpl/orchestrator')

        let credentialNftId: string | null = null
        let credentialNftHash: string | null = null

        // Step 1: Fetch draw + project context for NFT metadata
        const { data: drawData } = await supabase
          .from('draw_requests')
          .select('request_number, amount, phase, purpose, project_id, projects(name)')
          .eq('id', inspection.draw_request_id)
          .single()

        if (isXrplConfigured() && drawData) {
          // Step 2: Mint Inspector Credential NFT (XLS-20, taxon 3)
          const nft = await mintInspectorCredentialNFT({
            drawRequestId: inspection.draw_request_id,
            drawNumber: drawData.request_number,
            projectId: drawData.project_id,
            projectName: (drawData.projects as any)?.name ?? 'Unknown Project',
            inspectionId: inspection.id,
            inspectorName: updated.inspector_name,
            inspectorEmail: updated.inspector_email,
            milestone: drawData.phase ?? drawData.purpose ?? undefined,
            scheduledDate: updated.scheduled_date,
            passedAt: updated.submitted_at ?? new Date().toISOString(),
          })

          credentialNftId   = nft.nftTokenId
          credentialNftHash = nft.txnHash
          console.log(`[Inspections] Credential NFT minted — ID ${nft.nftTokenId} hash ${nft.txnHash}`)

          // Step 3: Store NFT fields on inspection record
          await supabase
            .from('inspections')
            .update({
              credential_nft_id:        credentialNftId,
              credential_nft_hash:      credentialNftHash,
              credential_nft_minted_at: new Date().toISOString(),
            })
            .eq('id', inspection.id)

          // BB webhook: inspector NFT minted
          try {
            const { sendBuildingBlockWebhook } = await import('@/lib/webhooks/building-block')
            await sendBuildingBlockWebhook({
              event: 'inspector_nft_minted',
              bc_draw_id: inspection.draw_request_id,
              nft_token_id: credentialNftId,
              nft_txn_hash: credentialNftHash,
              minted_at:    new Date().toISOString(),
              inspector_name: updated.inspector_name,
              taxon:        3,
            })
          } catch (webhookErr) {
            console.warn('[BB webhook] inspector_nft_minted dispatch failed:', webhookErr)
          }
        } else if (!isXrplConfigured()) {
          console.log('[Inspections] XRPL not configured — skipping credential NFT mint')
        }

        // Step 4: Run Verification Orchestrator — checks if lien waiver NFT
        // is also present and auto-releases escrow if dual-condition is satisfied
        const orchResult = await runOrchestrator(inspection.draw_request_id)
        console.log(
          `[Inspections] Orchestrator result for draw ${inspection.draw_request_id}:`,
          `conditions=${orchResult.conditionsMet}`,
          orchResult.escrowFinished ? `auto-funded! hash=${orchResult.finishHash}` : orchResult.reason
        )

        // BB webhook: escrow released (only if orchestrator auto-funded via inspection path)
        if (orchResult.escrowFinished) {
          try {
            const { sendBuildingBlockWebhook } = await import('@/lib/webhooks/building-block')
            await sendBuildingBlockWebhook({
              event: 'escrow_released',
              bc_draw_id: inspection.draw_request_id,
              escrow_finish_hash: orchResult.finishHash ?? null,
              funded_at:  new Date().toISOString(),
              trigger:    'inspector_condition_completed',
            })
          } catch (webhookErr) {
            console.warn('[BB webhook] escrow_released dispatch failed:', webhookErr)
          }
        }
      } catch (err) {
        console.warn(
          '[Inspections] NFT/Orchestrator non-fatal error:',
          err instanceof Error ? err.message : err
        )
      }
    })()
  }

  return NextResponse.json({ data: updated })
}
