import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { alertOwner } from '@/lib/alerts'

// The daily job (see "crons" in vercel.json).
//
// 1. Keep-alive: one small database read. Supabase's free plan pauses a
//    project after about a week with no activity.
// 2. Reconcile: look for draws that are not where they should be, fix what
//    can safely be fixed, and tell the owner about the rest.
//
// The keep-alive part answers anyone (it returns only "ok"). The reconcile
// part runs only for the hosting platform's own scheduler, which presents
// CRON_SECRET. Without that secret set it is skipped and says so.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MINUTE = 60 * 1000

function isScheduler(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const given = Buffer.from((req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, ''))
  const want = Buffer.from(secret)
  return given.length === want.length && timingSafeEqual(given, want)
}

export async function GET(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return NextResponse.json({ ok: false, error: 'Supabase is not configured' }, { status: 500 })
  const db = createClient(url, key, { auth: { persistSession: false } })

  const { error: pingErr } = await db.from('projects').select('id', { count: 'exact', head: true })
  if (pingErr) {
    console.error('[daily] database did not answer:', pingErr.message)
    return NextResponse.json({ ok: false, at: new Date().toISOString() }, { status: 503 })
  }
  if (!isScheduler(req) || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ ok: true, at: new Date().toISOString(), reconcile: 'skipped' })
  }

  // ── Reconcile ──────────────────────────────────────────────────────────────
  const problems: string[] = []
  const fixed: string[] = []
  const old = (minutes: number) => new Date(Date.now() - minutes * MINUTE).toISOString()

  try {
    // a. Approved draws that have waited: re-do any missing ledger record and
    //    try the release again (the same thing as the "Check again" button).
    const { data: approved } = await db.from('draw_requests')
      .select('id, request_number, reviewed_at').eq('status', 'approved').lt('reviewed_at', old(15)).limit(15)
    const { checkConditions } = await import('@/lib/xrpl/conditions')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const d of (approved ?? []) as any[]) {
      try {
        const r = await checkConditions(db, d.id)
        if (r.released) fixed.push(`Draw ${d.request_number} was released on a retry`)
        else if (r.inspection.recorded && r.lienWaiver.recorded) problems.push(`Draw ${d.request_number}: both conditions are recorded but it did not release (${r.reason ?? 'no reason given'})`)
        else if (r.inspection.passed && !r.inspection.recorded) problems.push(`Draw ${d.request_number}: the inspection passed but could not be recorded on the ledger`)
      } catch (err) {
        problems.push(`Draw ${d.request_number}: could not be checked (${err instanceof Error ? err.message.slice(0, 120) : 'error'})`)
      }
    }

    // b. Released draws with no fee line: write it.
    const { data: funded } = await db.from('draw_requests')
      .select('id, request_number, project_id, amount, net_amount, settlement_amount, settlement_method, fee_accruals ( id )')
      .eq('status', 'funded').order('funded_at', { ascending: false }).limit(200)
    const { recordFeeAccrual } = await import('@/lib/fees')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const d of (funded ?? []) as any[]) {
      const has = Array.isArray(d.fee_accruals) ? d.fee_accruals.length > 0 : !!d.fee_accruals
      if (has) continue
      await recordFeeAccrual(d)
      const { count } = await db.from('fee_accruals').select('id', { count: 'exact', head: true }).eq('draw_request_id', d.id)
      if (count) fixed.push(`Draw ${d.request_number}: its missing fee line was written`)
      else problems.push(`Draw ${d.request_number} was released but has no fee line, and one could not be written`)
    }

    // c. Signatures and funding requests that have been open too long.
    const { data: stale } = await db.from('draw_requests')
      .select('request_number').eq('settlement_state', 'awaiting_lender_signature').lt('updated_at', old(180)).limit(20)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const d of (stale ?? []) as any[]) problems.push(`Draw ${d.request_number} has been waiting on the lender's signature for over three hours`)
    const { count: staleRequests } = await db.from('settlement_requests')
      .select('id', { count: 'exact', head: true }).eq('state', 'waiting').lt('created_at', old(180))
    if (staleRequests) problems.push(`${staleRequests} funding request(s) have been open for over three hours`)

    // d. A draw the lender locked whose project has since lost its lender wallet or account.
    const { data: locked } = await db.from('draw_requests')
      .select('request_number, projects ( lenders ( xrp_address, profile_id ) )').eq('settlement_state', 'locked').limit(50)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const d of (locked ?? []) as any[]) {
      const l = d.projects?.lenders
      if (!l?.xrp_address || !l?.profile_id) problems.push(`Draw ${d.request_number} is locked, but its lender no longer has a wallet or an account on file`)
    }
  } catch (err) {
    problems.push(`The daily check itself failed part-way: ${err instanceof Error ? err.message.slice(0, 200) : 'error'}`)
  }

  if (problems.length) {
    await alertOwner({
      title: `${problems.length} item${problems.length === 1 ? '' : 's'} need${problems.length === 1 ? 's' : ''} attention`,
      body: problems.slice(0, 6).join(' · ') + (problems.length > 6 ? ` · and ${problems.length - 6} more` : ''),
      link: '/admin/draws',
      details: { fixed_automatically: fixed.length, checked_at: new Date().toISOString() },
    })
  }
  return NextResponse.json({ ok: true, at: new Date().toISOString(), reconcile: { problems, fixed } })
}
