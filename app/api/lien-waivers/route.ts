import { serviceClient } from '@/lib/supabase/service'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/lien-waivers?project_id=xxx  or  ?draw_request_id=xxx
export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const project_id = req.nextUrl.searchParams.get('project_id')
  const draw_request_id = req.nextUrl.searchParams.get('draw_request_id')

  let query = supabase.from('lien_waivers').select('*').order('created_at', { ascending: false })
  if (draw_request_id) query = query.eq('draw_request_id', draw_request_id)
  else if (project_id) query = query.eq('project_id', project_id)
  else return NextResponse.json({ error: 'project_id or draw_request_id required' }, { status: 400 })

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}

// POST /api/lien-waivers
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { project_id, draw_request_id, sub_name, sub_code, trade,
          waiver_type, state, through_amount, payment_amount, signed_by, notes } = body

  if (!project_id || !sub_name || !waiver_type) {
    return NextResponse.json({ error: 'project_id, sub_name, waiver_type required' }, { status: 400 })
  }

  // A waiver can only be attached to a draw on the same project, and only
  // while that draw is still open.
  let drawOpen = false
  if (draw_request_id) {
    const { data: linked } = await supabase
      .from('draw_requests').select('project_id, status').eq('id', draw_request_id).single()
    if (!linked || (linked as any).project_id !== project_id) {
      return NextResponse.json({ error: 'That draw is not on this project' }, { status: 400 })
    }
    drawOpen = ['draft', 'submitted', 'pending'].includes((linked as any).status)
    if (!drawOpen) {
      return NextResponse.json({ error: 'Lien waivers can no longer be added to this draw' }, { status: 409 })
    }
  }

  const { data, error } = await supabase
    .from('lien_waivers')
    .insert({
      project_id, draw_request_id, sub_name, sub_code, trade,
      waiver_type, state: state || 'TX', through_amount, payment_amount,
      signed_by, notes, status: signed_by ? 'signed' : 'pending',
      signed_at: signed_by ? new Date().toISOString() : null,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Update lien_waiver flag on draw_requests if linked
  if (draw_request_id) {
    const { data: waivers } = await supabase
      .from('lien_waivers')
      .select('id, status')
      .eq('draw_request_id', draw_request_id)
    const allSigned = waivers && waivers.length > 0 && waivers.every((w: any) => w.status === 'signed' || w.status === 'issued')
    // The contractor's own record that waivers are in hand. It is advisory:
    // release still needs the lender's confirmation and its on-ledger record.
    // Draw state is written by the server (see migration 023).
    if (drawOpen) {
      await serviceClient().from('draw_requests')
        .update({ lien_waiver: allSigned, updated_at: new Date().toISOString() })
        .eq('id', draw_request_id)
    }
  }

  return NextResponse.json({ data })
}
