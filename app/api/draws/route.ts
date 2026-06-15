import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
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
    .select(`*, projects(name, loan_number, borrower_id, lender_id, loan_amount, amount_drawn)`)
    .order('created_at', { ascending: false })

  if (projectId) query = query.eq('project_id', projectId)
  if (status) query = query.eq('status', status)

  const { data, error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ data })
}

export async function POST(request: NextRequest) {
  const supabase = createClient()
  const body = await request.json()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('draw_requests')
    .insert({
      ...body,
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
      const { data: lp } = await supabase
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
  } catch (emailErr) {
    console.warn('[Email] draw_submitted notification skipped:', emailErr instanceof Error ? emailErr.message : emailErr)
  }

  return NextResponse.json({ data }, { status: 201 })
}
