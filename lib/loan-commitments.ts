/**
 * What is already promised on a loan: the money and the release slots
 * (ledger tickets) spoken for by payments the lender has signed or is
 * signing, and by funding requests still waiting on a signature.
 *
 * One place, used by both the signing route and the funding desk, so they can
 * never hand the same slot to two things or promise the same dollar twice.
 */

/**
 * A payment in any of these states is signed for (or being signed for) and
 * not yet paid. Its money is committed and its slot is in use. `failed`
 * counts: a release the ledger refused is still signed for.
 */
export const COMMITTED_STATUSES = ['awaiting_signature', 'locked', 'releasing', 'failed']

/** `admin` is the service-key client. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loanCommitments(admin: any, projectId: string, exceptPaymentId?: string): Promise<{
  tickets: number[]
  committedUsd: number
}> {
  let q = admin.from('draw_payments').select('id, amount, release_ticket')
    .eq('project_id', projectId).in('status', COMMITTED_STATUSES)
  if (exceptPaymentId) q = q.neq('id', exceptPaymentId)
  const { data: pays } = await q
  const { data: waiting } = await admin.from('settlement_requests')
    .select('txjson').eq('project_id', projectId).eq('state', 'waiting')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: any[] = pays ?? []
  const tickets = new Set<number>()
  for (const r of rows) if (r.release_ticket != null) tickets.add(Number(r.release_ticket))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const w of (waiting ?? []) as any[]) {
    const t = Number(w.txjson?.TicketSequence)
    if (Number.isFinite(t) && t > 0) tickets.add(t)
  }
  return {
    tickets: Array.from(tickets),
    committedUsd: rows.reduce((sum, r) => sum + Number(r.amount ?? 0), 0),
  }
}
