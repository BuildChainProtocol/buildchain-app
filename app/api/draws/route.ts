import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { serviceClient } from '@/lib/supabase/service'
import { sendEmail } from '@/lib/email/send'
import { drawSubmittedEmail } from '@/lib/email/templates'

export async function GET(request: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('project_id')
  const status = searchParams.get('status')

  let query = supabase
    .from('draw_requests')
    .select(`*, projects(name, loan_number, borrower_id, lender_id, loan_amount, amount_drawn, settlement_method)`)
    .order('created_at', { ascending: false })

  // mine=true → filter to this user's borrower projects only
  const mine = searchParams.get('mine') === 'true'
  if (mine) {
    const { data: borrower } = await supabase
      .from('borrowers').select('id').eq('profile_id', user.id).single()
    if (!borrower) return NextResponse.json({ data: [] })

    const { data: myProjects } = await supabase
      .from('projects').select('id').eq('borrower_id', borrower.id)
    const ids = (myProjects ?? []).map(p => p.id)
    if (ids.length === 0) return NextResponse.json({ data: [] })
    query = query.in('project_id', ids)
  }

  if (projectId) query = query.eq('project_id', projectId)
  // status may be one value or a comma-separated list (e.g. status=submitted,pending)
  if (status) {
    const wanted = status.split(',').map(s => s.trim()).filter(Boolean)
    if (wanted.length === 1) query = query.eq('status', wanted[0])
    else if (wanted.length > 1) query = query.in('status', wanted)
  }

  const { data, error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ data })
}

export async function POST(request: NextRequest) {
  const supabase = createClient()
  const body = await request.json()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null)
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 4000) : null)
  const amount = num(body?.amount)
  if (typeof body?.project_id !== 'string' || !amount) {
    return NextResponse.json({ error: 'A draw needs a project and a positive amount' }, { status: 400 })
  }
  const net = num(body?.net_amount)
  const netAmount = net && net <= amount ? net : amount

  const { data, error } = await supabase
    .from('draw_requests')
    .insert({
      // Only the request itself comes from the borrower. Flags, escrow, NFT,
      // settlement and payee fields are set by the server alone.
      project_id: body?.project_id,
      amount,
      net_amount: netAmount,
      retainage_rate: num(body?.retainage_rate),
      retainage_held: num(body?.retainage_held),
      phase: text(body?.phase),
      purpose: text(body?.purpose),
      description: text(body?.description),
      inspection_done: false,
      lien_waiver: false,
      submitted_by: user.id,
      status: 'submitted',
      submitted_at: new Date().toISOString(),
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // Log activity
  await supabase.from('activity_log').insert({
    project_id: body.project_id,
    user_id: user.id,
    action: 'draw_submitted',
    entity_type: 'draw_request',
    entity_id: data.id,
    details: { amount: body.amount, purpose: body.purpose },
  })

  // ── Email lender: new draw needs review ──────────────────────────────────
  try {
    // Two-step: get project + lender row, then get lender's auth email from profiles
    const { data: project } = await supabase
      .from('projects')
      .select('name, lenders(id, email, company_name, profile_id)')
      .eq('id', body.project_id)
      .single()

    const { data: borrowerProfile } = await supabase
      .from('profiles').select('full_name, company_name').eq('id', user.id).single()

    const lenderRow = (project?.lenders as any)
    let lenderEmail: string | null = lenderRow?.email ?? null
    let lenderName: string = lenderRow?.company_name ?? 'Lender'

    // Prefer auth email from profiles (more reliable than lenders.email)
    if (lenderRow?.profile_id) {
      // A borrower cannot read the lender's profile; the server looks it up.
      const { data: lp } = await serviceClient()
        .from('profiles').select('email, full_name').eq('id', lenderRow.profile_id).single()
      if (lp?.email) { lenderEmail = lp.email; lenderName = lp.full_name ?? lenderName }
    }

    if (lenderEmail && project) {
      const { subject, html } = drawSubmittedEmail({
        lenderName,
        borrowerName: borrowerProfile?.full_name ?? borrowerProfile?.company_name ?? 'Borrower',
        projectName: project.name,
        drawAmount: body.amount,
        drawPurpose: body.purpose || 'Construction draw',
        projectId: body.project_id,
        drawId: data.id,
      })
      await sendEmail({ to: lenderEmail, subject, html })
    }

    // ── In-app notification for lender ─────────────────────────────────────
    const lenderProfileId = lenderRow?.profile_id
    if (lenderProfileId) {
      const fmt = (n: number) =>
        new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).from('notifications').insert({
        user_id: lenderProfileId,
        type: 'draw_submitted',
        title: 'New Draw Request Submitted',
        body: `${(borrowerProfile as any)?.full_name ?? (borrowerProfile as any)?.company_name ?? 'Borrower'} submitted draw ${(data as any).request_number} for ${fmt(body.amount)} on ${(project as any)?.name ?? 'their project'}.`,
        link: '/lender/approvals',
      })
    }
  } catch (emailErr) {
    console.warn('[Email] draw_submitted notification skipped:', emailErr instanceof Error ? emailErr.message : emailErr)
  }

  return NextResponse.json({ data }, { status: 201 })
}
