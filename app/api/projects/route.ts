import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('projects')
    .select(`*, borrowers(company_name, contact_name, email), lenders(company_name, contact_name)`)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ data })
}

export async function POST(request: NextRequest) {
  const supabase = createClient()
  const body = await request.json()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Generate loan number
  const loanNumber = `LN-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`

  const { data, error } = await supabase
    .from('projects')
    .insert({ ...body, loan_number: loanNumber })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // Create default required documents
  const defaultDocs = [
    { name: 'Executed Loan Agreement', doc_type: 'loan_agreement', required: true },
    { name: 'Title Commitment', doc_type: 'title_commitment', required: true },
    { name: 'Approved Plans & Permits', doc_type: 'plans_permits', required: true },
    { name: 'Insurance Certificate', doc_type: 'insurance', required: true },
  ]

  await supabase.from('documents').insert(defaultDocs.map(d => ({ ...d, project_id: data.id })))

  await supabase.from('activity_log').insert({
    project_id: data.id,
    user_id: user.id,
    action: 'project_created',
    entity_type: 'project',
    entity_id: data.id,
    details: { name: body.name },
  })

  return NextResponse.json({ data }, { status: 201 })
}
