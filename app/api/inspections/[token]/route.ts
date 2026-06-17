/**
 * Public API for the inspector portal — no auth required.
 * Only the inspection token grants access.
 */
import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

// ─── GET /api/inspections/[token] ─────────────────────────────────────────────
// Returns the inspection + associated project + draw info
// (no sensitive borrower/lender data exposed)
export async function GET(
  _request: NextRequest,
  { params }: { params: { token: string } }
) {
  const supabase = createClient()

  const { data: inspection, error } = await supabase
    .from('inspections')
    .select(`
      id, token, status, notes, submitted_at, scheduled_date,
      inspector_name, inspector_email,
      draw_requests (
        request_number, amount, phase, purpose, description
      ),
      projects (
        name, address, city, state, zip
      )
    `)
    .eq('token', params.token)
    .single()

  if (error || !inspection) {
    return NextResponse.json({ error: 'Inspection not found' }, { status: 404 })
  }

  return NextResponse.json({ data: inspection })
}

// ─── PATCH /api/inspections/[token] ───────────────────────────────────────────
// Inspector submits their result
export async function PATCH(
  request: NextRequest,
  { params }: { params: { token: string } }
) {
  const supabase = createClient()

  // Verify token exists and is still pending
  const { data: inspection, error: fetchErr } = await supabase
    .from('inspections')
    .select('id, status, draw_request_id')
    .eq('token', params.token)
    .single()

  if (fetchErr || !inspection) {
    return NextResponse.json({ error: 'Inspection not found' }, { status: 404 })
  }

  if (inspection.status !== 'pending') {
    return NextResponse.json(
      { error: `Inspection already ${inspection.status}` },
      { status: 409 }
    )
  }

  const body = await request.json()
  const { status, notes } = body

  if (!status || !['passed', 'failed'].includes(status)) {
    return NextResponse.json({ error: 'status must be "passed" or "failed"' }, { status: 400 })
  }

  const { data: updated, error: updateErr } = await supabase
    .from('inspections')
    .update({
      status,
      notes: notes?.trim() || null,
      submitted_at: new Date().toISOString(),
    })
    .eq('id', inspection.id)
    .select()
    .single()

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 })
  }

  // If inspection passed, mark the draw's inspection_done flag
  if (status === 'passed') {
    await supabase
      .from('draw_requests')
      .update({ inspection_done: true })
      .eq('id', inspection.draw_request_id)
  }

  // Notify admins via activity log (using service role if available)
  try {
    const { createClient: createServiceClient } = await import('@/lib/supabase/server')
    const sc = createServiceClient()
    await sc.from('activity_log').insert({
      action: status === 'passed' ? 'inspection_passed' : 'inspection_failed',
      details: {
        inspection_id: inspection.id,
        draw_request_id: inspection.draw_request_id,
        notes: notes?.trim() || null,
      },
    })
  } catch { /* non-fatal */ }

  return NextResponse.json({ data: updated })
}
