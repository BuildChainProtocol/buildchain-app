import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const body = await request.json()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !['admin', 'lender'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const updates: Record<string, unknown> = { ...body, reviewed_at: new Date().toISOString() }

  if (body.status === 'approved') {
    updates.approved_by = user.id
    updates.wire_reference = `WIRE-${Date.now()}`
  }
  if (body.status === 'funded') {
    updates.funded_at = new Date().toISOString()
    // Update project amount_drawn
    const { data: draw } = await supabase.from('draw_requests').select('amount, project_id').eq('id', params.id).single()
    if (draw) {
      await supabase.rpc('increment_amount_drawn', { p_project_id: draw.project_id, p_amount: draw.amount })
    }
  }
  if (body.status === 'declined') {
    updates.declined_by = user.id
  }

  const { data, error } = await supabase
    .from('draw_requests')
    .update(updates)
    .eq('id', params.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // Log activity
  await supabase.from('activity_log').insert({
    project_id: data.project_id,
    user_id: user.id,
    action: `draw_${body.status}`,
    entity_type: 'draw_request',
    entity_id: params.id,
    details: { status: body.status },
  })

  return NextResponse.json({ data })
}
