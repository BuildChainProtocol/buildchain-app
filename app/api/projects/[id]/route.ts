import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('projects')
    .select(`
      *,
      borrowers(id, company_name, contact_name, email, phone, rating, license_number, license_state),
      lenders(id, company_name, contact_name, email, phone, max_ltv, loan_types),
      draw_requests(id, request_number, amount, phase, purpose, status, submitted_at, funded_at, escrow_txn_hash),
      documents(id, name, doc_type, status, required, file_name, file_size, uploaded_at),
      activity_log(id, action, details, created_at, profiles(full_name))
    `)
    .eq('id', params.id)
    .order('created_at', { referencedTable: 'draw_requests', ascending: false })
    .order('created_at', { referencedTable: 'activity_log', ascending: false })
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 404 })
  return NextResponse.json({ data })
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const body = await request.json()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data, error } = await supabase
    .from('projects')
    .update({ ...body, updated_at: new Date().toISOString() })
    .eq('id', params.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  await supabase.from('activity_log').insert({
    project_id: params.id,
    user_id: user.id,
    action: 'project_updated',
    entity_type: 'project',
    entity_id: params.id,
    details: body,
  })

  return NextResponse.json({ data })
}
