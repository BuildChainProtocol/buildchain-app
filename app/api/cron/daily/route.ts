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
  // The platform stops this job at 60 seconds.
  const started = Date.now()
  // A single draw's release can itself take over 30 seconds, so no new
  // ledger work is started after 20.
  const timeLeft = () => Date.now() - started < 20 * 1000

  try {
    // 0. A payee the lender has not signed for within a day, on an approved
    //    draw, goes on hold so the rest of the draw can be released.
    {
      const { data: waiting } = await db.from('draw_payments')
        .select('draw_request_id, draw_requests!inner ( request_number, status )')
        .in('status', ['pending', 'awaiting_signature']).lt('updated_at', old(24 * 60))
        .eq('draw_requests.status', 'approved').limit(40)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const byDraw = new Map<string, string>()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const p of (waiting ?? []) as any[]) {
        const d = Array.isArray(p.draw_requests) ? p.draw_requests[0] : p.draw_requests
        byDraw.set(p.draw_request_id, d?.request_number ?? '')
      }
      const { holdUnsignedPayees } = await import('@/lib/unsigned-payees')
      for (const [drawId, number] of Array.from(byDraw.entries())) {
        try {
          const r = await holdUnsignedPayees(db, drawId, old(24 * 60))
          if (r.held) fixed.push(`Draw ${number}: ${r.held} payee(s) not signed for within a day were put on hold so the rest can be released`)
          if (r.stillOpen) problems.push(`Draw ${number}: a signature request is still open or was signed but not confirmed; the lender should open the draw`)
        } catch (err) {
          problems.push(`Draw ${number}: its unsigned payees could not be looked at (${err instanceof Error ? err.message.slice(0, 100) : 'error'})`)
        }
      }
    }

    // a. Approved draws that have waited: re-do any missing ledger record and
    //    try the release again (the same thing as the "Check again" button).
    const { data: approved } = await db.from('draw_requests')
      .select('id, request_number, reviewed_at').eq('status', 'approved').lt('reviewed_at', old(15)).order('reviewed_at').limit(60)
    const { checkConditions } = await import('@/lib/xrpl/conditions')
    // Start at a different draw each day, so one slow draw at the front can
    // never keep the ones behind it from being looked at.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const queue = (approved ?? []) as any[]
    const offset = queue.length ? Math.floor(Date.now() / (24 * 60 * MINUTE)) % queue.length : 0
    const ordered = [...queue.slice(offset), ...queue.slice(0, offset)]
    let checked = 0
    for (const d of ordered) {
      if (!timeLeft()) {
        problems.push(`${ordered.length - checked} approved draw(s) were not checked today (the check ran out of time); they are first in line tomorrow, or use "Check again" on each`)
        break
      }
      checked++
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
      .select('id, request_number, project_id, amount, net_amount, settlement_amount, settlement_method, funded_at, fee_accruals ( id )')
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

    //    Released draws whose announcement was cut short (fee line, emails,
    //    Building Block's notices): finish it.
    {
      const { data: quiet } = await db.from('draw_requests')
        .select('id, request_number').eq('status', 'funded').is('release_announced_at', null).lt('funded_at', old(10)).limit(10)
      const { announceRelease } = await import('@/lib/xrpl/orchestrator')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const d of (quiet ?? []) as any[]) {
        try {
          if (await announceRelease(db, d.id, 'orchestrator')) fixed.push(`Draw ${d.request_number}: its release notices, cut short at the time, were sent`)
        } catch (err) {
          problems.push(`Draw ${d.request_number} was released but its notices could not be sent (${err instanceof Error ? err.message.slice(0, 100) : 'error'})`)
        }
      }
    }

    // c. Signatures and funding requests that have been open too long.
    //    A payee still to be signed for is told by its own payment row.
    const { data: stale } = await db.from('draw_payments')
      .select('draw_request_id, draw_requests ( request_number, status )')
      .in('status', ['pending', 'awaiting_signature']).lt('updated_at', old(180)).limit(100)
    const waitingDraws = new Set<string>()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const p of (stale ?? []) as any[]) {
      const d = Array.isArray(p.draw_requests) ? p.draw_requests[0] : p.draw_requests
      if (d && ['submitted', 'pending', 'approved'].includes(d.status)) waitingDraws.add(d.request_number)
    }
    waitingDraws.forEach(n => problems.push(`Draw ${n} has been waiting on the lender's signature for over three hours`))

    //    A funding request nobody signed is closed (its sign request expired
    //    long ago). One that WAS signed but never finished is reported: the
    //    lender finishes it by opening the Funding page.
    const { data: staleRequests } = await db.from('settlement_requests')
      .select('id, kind, payload').eq('state', 'waiting').lt('created_at', old(180)).limit(20)
    if ((staleRequests ?? []).length) {
      const { getSignResult, isXamanConfigured } = await import('@/lib/xaman')
      let closed = 0
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const r of (staleRequests ?? []) as any[]) {
        if (!timeLeft() || !isXamanConfigured()) { problems.push('Some funding requests have been open for over three hours and could not be looked at'); break }
        try {
          const s = await getSignResult(r.payload)
          if (s.resolved && s.signed) {
            problems.push(`A signed funding request (${String(r.kind).replace('_', ' ')}) was never finished; it finishes when the lender opens the Funding page`)
          } else {
            await db.from('settlement_requests').update({ state: 'expired', completed_at: new Date().toISOString() }).eq('id', r.id).eq('state', 'waiting')
            closed++
          }
        } catch { problems.push('A funding request has been open for over three hours and the wallet service did not answer about it') }
      }
      if (closed) fixed.push(`${closed} unsigned funding request(s) were closed`)
    }

    //    A payment stuck "being paid" means a release run died part-way. The
    //    retry in (a) takes it over; say so if it is still there.
    const { data: stuck } = await db.from('draw_payments')
      .select('payee_name, draw_requests ( request_number )').eq('status', 'releasing').lt('updated_at', old(30)).limit(20)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const p of (stuck ?? []) as any[]) {
      const d = Array.isArray(p.draw_requests) ? p.draw_requests[0] : p.draw_requests
      problems.push(`Draw ${d?.request_number ?? ''}: the payment to ${p.payee_name ?? 'a payee'} has been "being paid" for over 30 minutes`)
    }

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
