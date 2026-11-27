/**
 * The two release conditions, and making sure each has its ledger record.
 *
 * A draw releases when (1) an inspection has passed AND its credential is
 * recorded on the ledger, and (2) the lender has confirmed the lien waivers
 * AND that confirmation is recorded on the ledger. Each record is written in
 * the background right after the event. If that write fails (the ledger did
 * not answer) nothing used to try again, and the draw sat "approved" with no
 * way forward. These functions re-do a missing record and re-check release;
 * /api/draws/[id]/conditions exposes them to the lender and the admin.
 */

import { isXrplConfigured, mintInspectorCredentialNFT } from './escrow'
import { runOrchestrator } from './orchestrator'

export interface ConditionsResult {
  ok: boolean
  inspection: { passed: boolean; recorded: boolean }
  lienWaiver: { confirmed: boolean; recorded: boolean }
  released: boolean
  reason?: string
}

/**
 * Write the inspection credential for a passed inspection that has none.
 * `admin` is the service-key client.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ensureInspectionCredential(admin: any, drawId: string): Promise<{ passed: boolean; recorded: boolean; error?: string }> {
  const { data: rows } = await admin
    .from('inspections')
    .select('id, status, credential_nft_id, submitted_at, inspector_name')
    .eq('draw_request_id', drawId)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const passed = ((rows ?? []) as any[]).filter(r => r.status === 'passed')
  if (!passed.length) return { passed: false, recorded: false }
  if (passed.some(r => r.credential_nft_id)) return { passed: true, recorded: true }
  if (!isXrplConfigured()) return { passed: true, recorded: false, error: 'The ledger is not configured' }

  const inspection = passed[0]
  try {
    const nft = await mintInspectorCredentialNFT({
      drawRequestId: drawId,
      inspectionId: inspection.id,
      passedAt: inspection.submitted_at ?? new Date().toISOString(),
    })
    // Only if still unrecorded: two checks at once must not both claim it.
    const { data: saved } = await admin
      .from('inspections')
      .update({
        credential_nft_id: nft.nftTokenId,
        credential_nft_hash: nft.txnHash,
        credential_nft_minted_at: new Date().toISOString(),
      })
      .eq('id', inspection.id).is('credential_nft_id', null).select('id')
    if (saved?.length) {
      try {
        const { sendBuildingBlockWebhook } = await import('@/lib/webhooks/building-block')
        await sendBuildingBlockWebhook({
          event: 'inspector_nft_minted',
          bc_draw_id: drawId,
          nft_token_id: nft.nftTokenId,
          nft_txn_hash: nft.txnHash,
          minted_at: new Date().toISOString(),
          inspector_name: inspection.inspector_name,
          taxon: 3,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any)
      } catch { /* the notice is best effort; the record is what matters */ }
    }
    return { passed: true, recorded: true }
  } catch (err) {
    return { passed: true, recorded: false, error: err instanceof Error ? err.message.slice(0, 200) : 'Ledger error' }
  }
}

/** Re-do any missing ledger record for an approved draw, then try to release it. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function checkConditions(admin: any, drawId: string): Promise<ConditionsResult> {
  const { data: draw } = await admin
    .from('draw_requests').select('status, lien_waiver_nft_id').eq('id', drawId).single()
  if (!draw) return { ok: false, inspection: { passed: false, recorded: false }, lienWaiver: { confirmed: false, recorded: false }, released: false, reason: 'Draw not found' }

  const lienWaiver = { confirmed: !!draw.lien_waiver_nft_id, recorded: !!draw.lien_waiver_nft_id }
  if (draw.status === 'funded') {
    return { ok: true, inspection: { passed: true, recorded: true }, lienWaiver, released: true }
  }
  if (draw.status !== 'approved') {
    return { ok: false, inspection: { passed: false, recorded: false }, lienWaiver, released: false, reason: `This draw is ${draw.status}; only an approved draw can be released` }
  }

  const inspection = await ensureInspectionCredential(admin, drawId)
  const reasons: string[] = []
  if (!inspection.passed) reasons.push('No inspection has passed yet')
  else if (!inspection.recorded) reasons.push(`The inspection could not be recorded on the ledger${inspection.error ? ` (${inspection.error})` : ''}`)
  if (!lienWaiver.confirmed) reasons.push('The lender has not confirmed the lien waivers')

  let released = false
  if (inspection.recorded && lienWaiver.recorded) {
    const result = await runOrchestrator(drawId)
    released = result.escrowFinished
    if (!released && result.reason) reasons.push(result.reason)
  }
  return {
    ok: released || reasons.length === 0,
    inspection: { passed: inspection.passed, recorded: inspection.recorded },
    lienWaiver, released,
    ...(reasons.length ? { reason: reasons.join('. ') } : {}),
  }
}
