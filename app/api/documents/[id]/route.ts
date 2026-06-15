import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()

  if (profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Only admins can approve/reject documents' }, { status: 403 })
  }

  const body = await request.json()
  const allowedStatuses = ['approved', 'rejected', 'pending_review', 'required']

  if (body.status && !allowedStatuses.includes(body.status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('documents')
    .update({
      status: body.status,
      ...(body.notes ? { notes: body.notes } : {}),
      reviewed_by: user.id,
    })
    .eq('id', params.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // Log to activity
  if (data.project_id) {
    await supabase.from('activity_log').insert({
      project_id: data.project_id,
      user_id: user.id,
      action: `document_${body.status}`,
      entity_type: 'document',
      entity_id: params.id,
      details: { doc_name: data.name, status: body.status },
    })
  }

  return NextResponse.json({ data })
}
