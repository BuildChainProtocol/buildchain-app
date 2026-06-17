import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/budget-lines?project_id=xxx
export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const project_id = req.nextUrl.searchParams.get('project_id')
  if (!project_id) return NextResponse.json({ error: 'project_id required' }, { status: 400 })

  // Fetch budget lines + draw_line_items (approved/funded draws only) in parallel
  const [linesResult, drawnResult] = await Promise.all([
    supabase
      .from('budget_line_items')
      .select('*')
      .eq('project_id', project_id)
      .order('sort_order', { ascending: true })
      .order('line_no', { ascending: true }),

    supabase
      .from('draw_line_items')
      .select('budget_line_item_id, work_completed_period, materials_stored, draw_requests!inner(project_id, status)')
      .eq('draw_requests.project_id', project_id)
      .in('draw_requests.status', ['approved', 'funded']),
  ])

  if (linesResult.error) return NextResponse.json({ error: linesResult.error.message }, { status: 500 })

  // Aggregate drawn amounts per budget_line_item_id across all qualifying draws
  const drawnByLine: Record<string, number> = {}
  for (const row of drawnResult.data ?? []) {
    const id = row.budget_line_item_id
    const amount = (Number(row.work_completed_period) || 0) + (Number(row.materials_stored) || 0)
    drawnByLine[id] = (drawnByLine[id] || 0) + amount
  }

  // Merge drawn_to_date into each budget line
  const data = (linesResult.data ?? []).map(line => ({
    ...line,
    drawn_to_date: drawnByLine[line.id] || 0,
  }))

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
