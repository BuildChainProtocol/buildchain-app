/**
 * POST /api/buildingblock/submit
 *
 * Server-to-server endpoint — called by Building Block's Lender Submit Agent
 * instead of posting to BuiltIn Capital Partners. Authenticated via
 * BUILDINGBLOCK_API_KEY env var (Bearer token in Authorization header).
 *
 * Accepts a full draw package and populates BuildChain's database:
 *   - Creates the draw_request
 *   - Saves draw_line_items (G703 rows)
 *   - Saves lien_waivers (per sub)
 *   - Saves inspection record (if included)
 *
 * Returns: { draw_id, status_url, draw_number, net_amount, retainage_held }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Service role client — bypasses RLS for server-to-server ingestion
function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createClient(url, key)
}

function unauthorized(msg: string) {
  return NextResponse.json({ error: msg }, { status: 401 })
}

function bad(msg: string) {
  return NextResponse.json({ error: msg }, { status: 400 })
}

export async function POST(req: NextRequest) {
  // ── Auth: Bearer API key ─────────────────────────────────
  const authHeader = req.headers.get('authorization') || ''
  const token = authHeader.replace('Bearer ', '').trim()
  const validKey = process.env.BUILDINGBLOCK_API_KEY

  if (!validKey) {
    return NextResponse.json({ error: 'BUILDINGBLOCK_API_KEY not configured on server' }, { status: 500 })
  }
  if (!token || token !== validKey) {
    return unauthorized('Invalid or missing API key')
  }

  // ── Parse body ──────────────────────────────────────────
  let body: any
  try { body = await req.json() } catch { return bad('Invalid JSON body') }

  const {
    project_id,       // BuildChain project UUID (preferred)
    loan_number,      // fallback: match by loan_number
    draw_number,
    period_to,
    total_amount,
    description,
    retainage_rate = 0.10,
    line_items = [],  // G703 rows — see schema below
    lien_waivers = [], // per-sub waiver records
    inspection,       // optional inspection object
    source = 'building_block',
  } = body

  if (!total_amount) return bad('total_amount required')

  const supabase = getServiceClient()

  // ── Resolve project ──────────────────────────────────────
  let projectId = project_id
  if (!projectId && loan_number) {
    const { data: proj } = await supabase
      .from('projects')
      .select('id')
      .eq('loan_number', loan_number)
      .single()
    if (!proj) return bad(`No project found with loan_number ${loan_number}`)
    projectId = proj.id
  }
  if (!projectId) return bad('project_id or loan_number required')

  // ── Create draw_request ──────────────────────────────────
  const retainageHeld = Math.round(total_amount * retainage_rate * 100) / 100
  const netAmount = Math.round((total_amount - retainageHeld) * 100) / 100

  const { data: draw, error: drawErr } = await supabase
    .from('draw_requests')
    .insert({
      project_id: projectId,
      request_number: draw_number ? `BB-${draw_number}` : undefined,
      amount: total_amount,
      purpose: description || `Building Block Draw #${draw_number}`,
      description: description || `Submitted via Building Block Lender Submit Agent`,
      phase: period_to ? `Period ending ${period_to}` : 'See G703',
      status: 'submitted',
      submitted_at: new Date().toISOString(),
      inspection_done: !!inspection && ['pass', 'pass_with_observations'].includes(inspection.outcome),
      lien_waiver: lien_waivers.length > 0,
      retainage_rate,
      retainage_held: retainageHeld,
      net_amount: netAmount,
    })
    .select()
    .single()

  if (drawErr) return NextResponse.json({ error: drawErr.message }, { status: 500 })

  // ── Save draw line items (G703) ──────────────────────────
  /**
   * Expected line_items shape (mirrors Building Block's SOVLineItem):
   * {
   *   line_no: "1", description: "Foundation", scheduled_value: 80000,
   *   work_completed_prev: 40000, work_completed_period: 20000,
   *   materials_stored: 0, budget_line_item_id?: "uuid"
   * }
   *
   * If budget_line_item_id is not provided, we upsert a budget line first.
   */
  const drawLineRows: any[] = []

  for (const item of line_items) {
    let budgetLineId = item.budget_line_item_id

    // Auto-create budget line if not linked yet
    if (!budgetLineId && item.description && item.scheduled_value != null) {
      // Check if one exists by line_no
      const { data: existing } = await supabase
        .from('budget_line_items')
        .select('id')
        .eq('project_id', projectId)
        .eq('line_no', String(item.line_no || item.description.slice(0, 3)))
        .maybeSingle()

      if (existing) {
        budgetLineId = existing.id
      } else {
        const { data: newLine } = await supabase
          .from('budget_line_items')
          .insert({
            project_id: projectId,
            line_no: String(item.line_no || '?'),
            description: item.description,
            scheduled_value: item.scheduled_value,
            trade: item.trade || null,
            csi_division: item.csi_division || null,
            sort_order: item.sort_order ?? drawLineRows.length,
          })
          .select('id')
          .single()
        budgetLineId = newLine?.id
      }
    }

    if (!budgetLineId) continue

    const prev = parseFloat(item.work_completed_prev) || 0
    const period = parseFloat(item.work_completed_period) || 0
    const stored = parseFloat(item.materials_stored) || 0
    const total = prev + period + stored
    const sv = parseFloat(item.scheduled_value) || 0
    const pct = sv > 0 ? Math.round((total / sv) * 10000) / 100 : 0
    const balance = sv - total
    const lineRetainage = Math.round(period * retainage_rate * 100) / 100
    const due = Math.round((period - lineRetainage) * 100) / 100

    drawLineRows.push({
      draw_request_id: draw.id,
      budget_line_item_id: budgetLineId,
      work_completed_prev: prev,
      work_completed_period: period,
      materials_stored: stored,
      total_completed_stored: total,
      percent_complete: pct,
      balance_to_finish: balance,
      retainage_amount: lineRetainage,
      current_payment_due: due,
    })
  }

  if (drawLineRows.length > 0) {
    await supabase.from('draw_line_items').insert(drawLineRows)
  }

  // ── Save lien waivers ────────────────────────────────────
  /**
   * Expected lien_waivers shape:
   * {
   *   sub_name: "Apex Electric", sub_code: "SUB-201", trade: "Electrical",
   *   waiver_type: "conditional_partial", through_amount: 50000,
   *   signed_by: "John Smith", status: "signed"
   * }
   */
  if (lien_waivers.length > 0) {
    const waiverRows = lien_waivers.map((w: any) => ({
      project_id: projectId,
      draw_request_id: draw.id,
      sub_name: w.sub_name,
      sub_code: w.sub_code || null,
      trade: w.trade || null,
      waiver_type: w.waiver_type || 'conditional_partial',
      state: w.state || 'TX',
      statute_ref: w.statute_ref || null,
      through_amount: w.through_amount || 0,
      payment_amount: w.payment_amount || 0,
      status: w.status || (w.signed_by ? 'signed' : 'pending'),
      signed_at: w.signed_by ? (w.signed_at || new Date().toISOString()) : null,
      signed_by: w.signed_by || null,
      source: 'building_block',
    }))
    await supabase.from('lien_waivers').insert(waiverRows)
  }

  // ── Save inspection ──────────────────────────────────────
  /**
   * Expected inspection shape:
   * {
   *   inspector_name: "Jane Doe", inspector_company: "ABC Inspections",
   *   inspection_date: "2026-06-16", outcome: "pass",
   *   percent_complete_verified: 42.5, notes: "Work verified on site."
   * }
   */
  if (inspection && inspection.inspector_name && inspection.inspection_date) {
    await supabase.from('inspections').insert({
      project_id: projectId,
      draw_request_id: draw.id,
      inspector_name: inspection.inspector_name,
      inspector_company: inspection.inspector_company || null,
      inspector_email: inspection.inspector_email || null,
      inspection_date: inspection.inspection_date,
      outcome: inspection.outcome || 'pending',
      percent_complete_verified: inspection.percent_complete_verified || null,
      report_path: inspection.report_path || null,
      notes: inspection.notes || null,
      source: 'building_block',
    })
  }

  // ── Notify lender via notification ──────────────────────
  // Find the lender's profile_id for this project
  const { data: proj } = await supabase
    .from('projects')
    .select('lenders(profile_id), name')
    .eq('id', projectId)
    .single()

  if (proj?.lenders) {
    const lenderProfileId = (proj.lenders as any).profile_id
    if (lenderProfileId) {
      await supabase.from('notifications').insert({
        user_id: lenderProfileId,
        type: 'draw_submitted',
        title: 'New draw submitted via Building Block',
        message: `${proj.name} — Draw #${draw_number || draw.request_number} for ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(netAmount)} (net) is ready for review.`,
        link: `/lender/approvals`,
      })
    }
  }

  // ── Response ─────────────────────────────────────────────
  const baseUrl = req.nextUrl.origin
  return NextResponse.json({
    ok: true,
    draw_id: draw.id,
    draw_number: draw.request_number,
    status: 'submitted',
    total_amount,
    retainage_held: retainageHeld,
    net_amount: netAmount,
    line_items_saved: drawLineRows.length,
    lien_waivers_saved: lien_waivers.length,
    inspection_saved: !!(inspection?.inspector_name),
    status_url: `${baseUrl}/api/draws/${draw.id}`,
    review_url: `${baseUrl}/lender/approvals`,
  })
}
