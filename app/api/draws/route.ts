import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const supabase = createClient()
  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('project_id')
  const status = searchParams.get('status')

  let query = supabase
    .from('draw_requests')
    .select(`*, projects(name, loan_number, borrower_id, lender_id)`)
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

  return NextResponse.json({ data }, { status: 201 })
}
