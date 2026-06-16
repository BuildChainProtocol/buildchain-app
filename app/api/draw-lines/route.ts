import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/draw-lines?draw_request_id=xxx
export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const draw_request_id = req.nextUrl.searchParams.get('draw_request_id')
  if (!draw_request_id) return NextResponse.json({ error: 'draw_request_id required' }, { status: 400 })

  const { data, error } = await supabase
    .from('draw_line_items')
    .select('*, budget_line_items(line_no, description, scheduled_value, csi_division, trade, sort_order)')
    .eq('draw_request_id', draw_request_id)
    .order('budget_line_items(sort_order)', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}

// POST /api/draw-lines  — batch upsert all line items for a draw
// Body: { draw_request_id, lines: [{ budget_line_item_id, work_completed_period, materials_stored, retainage_rate }] }
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { draw_request_id, lines } = await req.json()
  if (!draw_request_id || !Array.isArray(lines)) {
    return NextResponse.json({ error: 'draw_request_id and lines[] required' }, { status: 400 })
  }

  // Load prior draw totals per budget line item for this project
  const { data: draw } = await supabase
    .from('draw_requests')
    .select('project_id, retainage_rate')
    .eq('id', draw_request_id)
    .single()

  // Compute each row
  const rows = lines.map((line: any) => {
    const prev = parseFloat(line.work_completed_prev) || 0
    const period = parseFloat(line.work_completed_period) || 0
    const stored = parseFloat(line.materials_stored) || 0
    const total = prev + period + stored
    const scheduled = parseFloat(line.scheduled_value) || 0
    const pct = scheduled > 0 ? Math.round((total / scheduled) * 10000) / 100 : 0
    const balance = scheduled - total
    const retainage_rate = parseFloat(draw?.retainage_rate) || 0.10
    const retainage_amount = Math.round(period * retainage_rate * 100) / 100
    const current_payment_due = Math.round((period - retainage_amount) * 100) / 100

    return {
      draw_request_id,
      budget_line_item_id: line.budget_line_item_id,
      work_completed_prev: prev,
      work_completed_period: period,
      materials_stored: stored,
      total_completed_stored: total,
      percent_complete: pct,
      balance_to_finish: balance,
      retainage_amount,
      current_payment_due,
    }
  }).filter((r: any) => r.work_completed_period > 0 || r.materials_stored > 0)

  if (rows.length === 0) return NextResponse.json({ data: [] })

  // Delete existing then re-insert (simple upsert strategy)
  await supabase.from('draw_line_items').delete().eq('draw_request_id', draw_request_id)
  const { data, error } = await supabase.from('draw_line_items').insert(rows).select()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Update draw total to sum of current_payment_due across lines
  const netTotal = rows.reduce((sum: number, r: any) => sum + r.current_payment_due, 0)
  const retainageTotal = rows.reduce((sum: number, r: any) => sum + r.retainage_amount, 0)
  const grossTotal = netTotal + retainageTotal
  await supabase.from('draw_requests').update({
    amount: Math.round(grossTotal * 100) / 100,
    retainage_held: Math.round(retainageTotal * 100) / 100,
    net_amount: Math.round(netTotal * 100) / 100,
    updated_at: new Date().toISOString(),
  }).eq('id', draw_request_id)

  return NextResponse.json({ data })
}
