import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/budget-lines?project_id=xxx
export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const project_id = req.nextUrl.searchParams.get('project_id')
  if (!project_id) return NextResponse.json({ error: 'project_id required' }, { status: 400 })

  const { data, error } = await supabase
    .from('budget_line_items')
    .select('*')
    .eq('project_id', project_id)
    .order('sort_order', { ascending: true })
    .order('line_no', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}

// POST /api/budget-lines
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { project_id, line_no, description, scheduled_value, csi_division, trade, sort_order } = body

  if (!project_id || !line_no || !description || scheduled_value == null) {
    return NextResponse.json({ error: 'project_id, line_no, description, scheduled_value required' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('budget_line_items')
    .insert({ project_id, line_no, description, scheduled_value, csi_division, trade, sort_order: sort_order ?? 0 })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}
