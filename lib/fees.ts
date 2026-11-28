/**
 * The protocol fee record.
 *
 * Every released draw gets one row in fee_accruals: the fee under the rate in
 * force (0.30% of the amount released unless PROTOCOL_FEE_BPS says otherwise)
 * and whether it is waived. Fees are waived unless PROTOCOL_FEES_ACTIVE is
 * 'true', always on the test network, and on a lender's first real draw. This is a record for a statement;
 * it charges no one.
 */

import { createClient } from '@supabase/supabase-js'
import { isTestnet } from '@/lib/xrpl/escrow'

export function feeRateBps(): number {
  const bps = parseInt(process.env.PROTOCOL_FEE_BPS ?? '30', 10)
  return Number.isFinite(bps) && bps >= 0 && bps <= 1000 ? bps : 30
}

/** The fee on a released amount, to the cent. */
export function feeFor(releaseAmount: number, bps = feeRateBps()): number {
  if (!Number.isFinite(releaseAmount) || releaseAmount <= 0) return 0
  return Math.round((releaseAmount * bps) / 100) / 100
}

/** Best effort: a failed fee record never blocks or undoes a release. */
export async function recordFeeAccrual(draw: {
  id: string
  project_id: string
  amount: number
  net_amount?: number | null
  settlement_amount?: number | null
  settlement_method?: string | null
}): Promise<void> {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) return
    const supabase = createClient(url, key, { auth: { persistSession: false } })
    const { data: project } = await supabase.from('projects').select('lender_id').eq('id', draw.project_id).single()
    const released = Number(draw.settlement_amount ?? draw.net_amount ?? draw.amount)
    const testnet = isTestnet()
    const active = process.env.PROTOCOL_FEES_ACTIVE === 'true'
    // "The first draw is free": the first real (mainnet) draw released for a
    // lender carries no fee. Counted per lender, so it is the first draw of
    // that lender's first loan.
    let firstDraw = false
    if (!testnet && active && project?.lender_id) {
      const { count } = await supabase.from('fee_accruals').select('id', { count: 'exact', head: true })
        .eq('lender_id', project.lender_id).eq('network', 'mainnet').neq('draw_request_id', draw.id)
      firstDraw = (count ?? 0) === 0
    }
    const waived = testnet || !active || firstDraw
    const { error: feeErr } = await supabase.from('fee_accruals').upsert({
      draw_request_id: draw.id,
      project_id: draw.project_id,
      lender_id: project?.lender_id ?? null,
      released_at: new Date().toISOString(),
      release_amount: released,
      rate_bps: feeRateBps(),
      fee_amount: feeFor(released),
      waived,
      waiver_reason: testnet ? 'Pilot on the test network: no funds moved' : !active ? 'Fees not yet in force' : firstDraw ? 'First draw free' : null,
      settlement_method: draw.settlement_method ?? 'test_xrp',
      network: testnet ? 'testnet' : 'mainnet',
    }, { onConflict: 'draw_request_id', ignoreDuplicates: true })
    // The database reports a refused write in the result; make it count as a failure.
    if (feeErr) throw new Error(feeErr.message)
  } catch (err) {
    console.warn('[fees] accrual not recorded (non-fatal):', err instanceof Error ? err.message : err)
    try {
      const { alertOwner } = await import('@/lib/alerts')
      await alertOwner({
        title: 'A fee line could not be written',
        body: 'A draw was released but its fee line was not recorded. The daily check will try again.',
        link: '/admin/fees',
        details: { draw: draw.id, error: err instanceof Error ? err.message.slice(0, 200) : 'error' },
      })
    } catch { /* never let reporting a problem cause another */ }
  }
}
