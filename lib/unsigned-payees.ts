/**
 * A payee the lender still has to sign for holds up an approved draw: nobody
 * on it is paid until every payee is signed for or on hold. That wait cannot
 * be open-ended. After a time limit the unsigned payee is put on hold, so the
 * rest of the draw can be released and reported. The lender can still sign
 * for a held payee later by opening the draw.
 */

import { cancelSignRequest, getSignResult } from '@/lib/xaman'

const SIGNED = ['locked', 'releasing', 'failed', 'released']

/** `admin` is the service-key client. Rows untouched since `olderThan` (ISO time) are held. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function holdUnsignedPayees(admin: any, drawId: string, olderThan: string): Promise<{ held: number; stillOpen: number; unlocked: boolean }> {
  const { data } = await admin.from('draw_payments')
    .select('id, status, payment_signatures ( payload )')
    .eq('draw_request_id', drawId).in('status', ['pending', 'awaiting_signature']).lt('updated_at', olderThan)
  let held = 0, stillOpen = 0
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const p of (data ?? []) as any[]) {
    const sig = Array.isArray(p.payment_signatures) ? p.payment_signatures[0] : p.payment_signatures
    if (p.status === 'awaiting_signature' && sig?.payload) {
      // Never clear a request that was signed or can still be signed.
      try {
        const r = await getSignResult(sig.payload)
        if (r.resolved && r.signed) { stillOpen++; continue }
        const spent = r.expired || (r.resolved && !r.signed)
        if (!spent && !(await cancelSignRequest(sig.payload))) { stillOpen++; continue }
      } catch { stillOpen++; continue }
    }
    const { data: done } = await admin.from('draw_payments').update({
      status: 'held', release_ticket: null, updated_at: new Date().toISOString(),
      held_reason: 'Not signed for in time. Open this draw to sign for this payee.',
    }).eq('id', p.id).eq('status', p.status).select('id')
    if (done?.length) {
      held++
      await admin.from('payment_signatures').delete().eq('payment_id', p.id)
    }
  }
  if (!held) return { held, stillOpen, unlocked: false }

  // Nothing left to sign: the draw is locked again, for what is signed for.
  const { data: rows } = await admin.from('draw_payments').select('status, amount').eq('draw_request_id', drawId)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const all = (rows ?? []) as any[]
  if (all.some(r => r.status === 'pending' || r.status === 'awaiting_signature')) return { held, stillOpen, unlocked: false }
  const signed = all.filter(r => SIGNED.includes(r.status))
  if (!signed.length) return { held, stillOpen, unlocked: false }
  await admin.from('draw_requests').update({
    settlement_state: 'locked',
    settlement_amount: Math.round(signed.reduce((t, r) => t + Number(r.amount), 0) * 100) / 100,
  }).eq('id', drawId).eq('status', 'approved').eq('settlement_state', 'awaiting_lender_signature')
  return { held, stillOpen, unlocked: true }
}
