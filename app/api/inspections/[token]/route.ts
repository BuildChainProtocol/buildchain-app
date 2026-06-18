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
