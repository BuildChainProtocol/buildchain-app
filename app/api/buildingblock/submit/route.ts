/**
 * POST /api/buildingblock/submit
 *
 * Server-to-server endpoint — called by Building Block when a GC taps
 * "GC Sign & Send to Lender". Authenticated via BUILDINGBLOCK_API_KEY.
 *
 * Integration contract: §3.1 of the BB↔BC spec.
 *
 * Idempotency
 * -----------
 * BB sends Idempotency-Key: <key> as both a header and body field.
 * If a draw_request row with that key already exists, we return the original
 * draw_id immediately — no duplicate insert, no duplicate webhook.
 *
 * Duplicate bb_pay_app_id guard
 * ------------------------------
 * If any bb_pay_app_id in the incoming line_items already appears in an
 * active (non-declined, non-failed) draw for the same project, we reject
 * the request with 409. This prevents double-paying a sub if BB resubmits
 * after a timeout.
 *
 * Amounts
 * -------
 * BB sends gross_amount / retainage_held / net_amount / currency explicitly.
 * We honor those rather than recomputing. If only total_amount + retainage_rate
 * are present (older BB builds) we fall back to computing.
 *
 * Inspection
 * ----------
 * BB sends the project's latest signed inspection. A passed one that no other
 * active draw has used becomes this draw's passed inspection, and its
 * Inspector Credential NFT (taxon 3) is minted after the response. Anything
 * else is saved as a pending inspection, so BuildChain's inspector link
 * remains the fallback.
 */

import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { createClient } from '@supabase/supabase-js'

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set')
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set')
  return createClient(url, key)
}

function unauthorized(msg: string) {
  return NextResponse.json({ error: msg }, { status: 401 })
}
function bad(msg: string) {
  return NextResponse.json({ error: msg }, { status: 400 })
}

/**
 * Anchor BB's passed inspection on-ledger, as the inspector portal does for
 * its own: mint the Inspector Credential NFT, record it, tell BB, and run the
 * orchestrator in case the lien waiver condition is already met. The row is
 * claimed pending → passed first; if the mint fails it goes back to pending.
 */
async function anchorBbInspection(opts: {
  inspectionId:         string
  drawRequestId:        string
  bbInspectionResultId: number
  passedAt:             string
}): Promise<void> {
  try {
    const { isXrplConfigured, mintInspectorCredentialNFT } = await import('@/lib/xrpl/escrow')
    if (!isXrplConfigured()) {
      console.log('[BB submit] XRPL not configured — BB inspection left pending')
      return
    }
    const supabase = getServiceClient()

    const { data: claimed } = await supabase
      .from('inspections')
      .update({ status: 'passed', submitted_at: opts.passedAt })
      .eq('id', opts.inspectionId)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle()
    if (!claimed) return  // completed through the inspector link meanwhile

    let nft: { nftTokenId: string; txnHash: string }
    try {
      nft = await mintInspectorCredentialNFT({
        drawRequestId:        opts.drawRequestId,
        inspectionId:         opts.inspectionId,
        bbInspectionResultId: opts.bbInspectionResultId,
        passedAt:             opts.passedAt,
      })
    } catch (mintErr) {
      console.warn('[BB submit] Credential NFT mint failed — inspection back to pending:',
        mintErr instanceof Error ? mintErr.message : mintErr)
      await supabase
        .from('inspections')
        .update({ status: 'pending', submitted_at: null })
        .eq('id', opts.inspectionId)
      return
    }

    const { error: saveErr } = await supabase
      .from('inspections')
      .update({
        credential_nft_id:        nft.nftTokenId,
        credential_nft_hash:      nft.txnHash,
        credential_nft_minted_at: new Date().toISOString(),
      })
      .eq('id', opts.inspectionId)
    if (saveErr) {
      // On-ledger but not recorded: needs a hand fix with these values
      console.error(`[BB submit] Credential NFT ${nft.nftTokenId} (tx ${nft.txnHash}) minted but not saved on inspection ${opts.inspectionId}:`, saveErr.message)
      return
    }
    console.log(`[BB submit] Credential NFT minted for BB inspection #${opts.bbInspectionResultId} — ID ${nft.nftTokenId}`)

    const { sendBuildingBlockWebhook } = await import('@/lib/webhooks/building-block')
    await sendBuildingBlockWebhook({
      event:                   'inspector_nft_minted',
      bc_draw_id:              opts.drawRequestId,
      nft_token_id:            nft.nftTokenId,
      nft_txn_hash:            nft.txnHash,
      minted_at:               new Date().toISOString(),
      bb_inspection_result_id: opts.bbInspectionResultId,
      taxon:                   3,
    })

    // A no-op until the draw is approved; releases if this was the last condition
    const { runOrchestrator } = await import('@/lib/xrpl/orchestrator')
    const orchResult = await runOrchestrator(opts.drawRequestId)
    console.log(`[BB submit] Orchestrator for draw ${opts.drawRequestId}:`,
      orchResult.escrowFinished ? `auto-funded! hash=${orchResult.finishHash}` : orchResult.reason)
  } catch (err) {
    console.warn('[BB submit] BB inspection anchoring failed (non-fatal):', err instanceof Error ? err.message : err)
  }
}

export async function POST(req: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get('authorization') || ''
  const token = authHeader.replace('Bearer ', '').trim()
  const validKey = process.env.BUILDINGBLOCK_API_KEY
  if (!validKey) {
    return NextResponse.json({ error: 'BUILDINGBLOCK_API_KEY not configured on server' }, { status: 500 })
  }
  if (!token || token !== validKey) return unauthorized('Invalid or missing API key')

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: any
  try { body = await req.json() } catch { return bad('Invalid JSON body') }

  // Idempotency key from header OR body (header takes precedence)
  const idempotencyKey: string | null =
    req.headers.get('idempotency-key') || body.idempotency_key || null

  const {
    project_id,           // BC project UUID (if BB stored it)
    loan_number,          // fallback join key
    draw_number,          // BB's per-project sequence (can have gaps)
    period_to,
    total_amount,
    description,
    retainage_rate = 0.10,
    // Explicit BB amounts — prefer these over recomputing
    gross_amount,
    retainage_held: bb_retainage_held,
    net_amount: bb_net_amount,
    currency = 'USD',
    idempotency_key: _body_ikey,  // already captured above
    bb_draw_id,           // BB's internal draw id
    line_items = [],
    lien_waivers = [],
    inspection,
    payees = [],
    gc_wallet,
    source = 'building_block',
  } = body

  if (!total_amount && !gross_amount) return bad('total_amount or gross_amount is required')

  const supabase = getServiceClient()

  // ── Idempotency check ─────────────────────────────────────────────────────
  if (idempotencyKey) {
    const { data: existing } = await supabase
      .from('draw_requests')
      .select('id, request_number, status, amount, retainage_held, net_amount, retainage_rate')
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle()

    if (existing) {
      console.log(`[BB submit] Idempotency hit — returning existing draw ${existing.id}`)
      const baseUrl = req.nextUrl.origin
      return NextResponse.json({
        ok: true,
        draw_id: existing.id,
        draw_number: existing.request_number,
        status: existing.status,
        total_amount: existing.amount,
        retainage_held: existing.retainage_held,
        net_amount: existing.net_amount,
        line_items_saved: 0,
        lien_waivers_saved: 0,
        inspection_saved: false,
        status_url: `${baseUrl}/api/draws/${existing.id}`,
        review_url: `${baseUrl}/lender/approvals`,
        idempotent: true,
      })
    }
  }

  // ── Resolve project ───────────────────────────────────────────────────────
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

  // ── Duplicate bb_pay_app_id guard ─────────────────────────────────────────
  // Reject if any bb_pay_app_id in this submission is already in an active draw
  // for this project (submitted/approved/funded — not declined/failed/held).
  const incomingPayAppIds: number[] = line_items
    .map((li: any) => li.bb_pay_app_id)
    .filter((id: any) => id != null && !isNaN(Number(id)))
    .map(Number)

  if (incomingPayAppIds.length > 0) {
    // Find draw_line_items for this project's active draws with matching bb_pay_app_ids
    const { data: activeDupes } = await supabase
      .from('draw_line_items')
      .select('bb_pay_app_id, draw_request_id')
      .in('bb_pay_app_id', incomingPayAppIds)
      .not('bb_pay_app_id', 'is', null)

    if (activeDupes && activeDupes.length > 0) {
      // Check if any of those draws are in a non-terminal state
      const drawIds = [...new Set(activeDupes.map((d: any) => d.draw_request_id))]
      const { data: activeDraws } = await supabase
        .from('draw_requests')
        .select('id, status')
        .in('id', drawIds)
        .not('status', 'in', '("declined","failed")')

      if (activeDraws && activeDraws.length > 0) {
        const conflictPayAppIds = activeDupes
          .filter((d: any) => activeDraws.some((dr: any) => dr.id === d.draw_request_id))
          .map((d: any) => d.bb_pay_app_id)
        const existingDrawId = activeDraws[0].id
        console.warn(`[BB submit] Duplicate bb_pay_app_id guard: pay_app_ids [${conflictPayAppIds.join(',')}] already in draw ${existingDrawId}`)
        return NextResponse.json({
          error: 'duplicate_pay_app',
          detail: `Pay app(s) [${conflictPayAppIds.join(', ')}] already exist in an active draw`,
          existing_draw_id: existingDrawId,
        }, { status: 409 })
      }
    }
  }

  // ── Resolve amounts (honor BB's explicit figures, fall back to computed) ──
  const grossAmt   = parseFloat(gross_amount ?? total_amount) || 0
  let retHeld: number
  let netAmt: number
  if (bb_retainage_held != null && bb_net_amount != null) {
    // BB sent explicit figures — honor them exactly
    retHeld = Math.round(parseFloat(bb_retainage_held) * 100) / 100
    netAmt  = Math.round(parseFloat(bb_net_amount)    * 100) / 100
  } else {
    // Fall back: compute from gross + rate (older BB builds)
    retHeld = Math.round(grossAmt * retainage_rate * 100) / 100
    netAmt  = Math.round((grossAmt - retHeld) * 100) / 100
  }

  // ── BB inspection: can it anchor this draw? ───────────────────────────────
  // BB sends the project's LATEST signed inspection, not necessarily one for
  // this period, so a passed one anchors only if no other active draw
  // (not declined / failed) already used it: one inspection, one draw.
  const bbInspectionId: number | null =
    inspection?.inspection_result_id != null && !isNaN(Number(inspection.inspection_result_id))
      ? Number(inspection.inspection_result_id)
      : null
  const bbInspectionPassed = !!inspection && ['pass', 'pass_with_observations'].includes(inspection.outcome)
  let bbInspectionUsed = false
  if (bbInspectionPassed && bbInspectionId != null) {
    const { data: earlier } = await supabase
      .from('inspections')
      .select('draw_request_id')
      .eq('bb_inspection_result_id', bbInspectionId)
    const earlierDrawIds = (earlier ?? []).map((r: any) => r.draw_request_id).filter(Boolean)
    if (earlierDrawIds.length > 0) {
      const { data: activeEarlier } = await supabase
        .from('draw_requests')
        .select('id')
        .in('id', earlierDrawIds)
        .not('status', 'in', '("declined","failed")')
      bbInspectionUsed = !!activeEarlier && activeEarlier.length > 0
    }
  }
  const canAnchorInspection = bbInspectionPassed && bbInspectionId != null && !bbInspectionUsed

  // ── Create draw_request ───────────────────────────────────────────────────
  const { data: draw, error: drawErr } = await supabase
    .from('draw_requests')
    .insert({
      project_id:          projectId,
      request_number:      draw_number ? `BB-${draw_number}` : undefined,
      amount:              grossAmt,
      gross_amount:        grossAmt,
      net_amount:          netAmt,
      retainage_rate,
      retainage_held:      retHeld,
      currency,
      purpose:             description || `Building Block Draw #${draw_number}`,
      description:         description || `Submitted via Building Block`,
      phase:               period_to ? `Period ending ${period_to}` : 'See G703',
      status:              'submitted',
      submitted_at:        new Date().toISOString(),
      inspection_done:     canAnchorInspection,
      lien_waiver:         lien_waivers.length > 0,
      bb_draw_id:          bb_draw_id ?? null,
      idempotency_key:     idempotencyKey ?? null,
      gc_wallet:           gc_wallet ?? null,
      payees:              payees.length > 0 ? payees : null,
    })
    .select()
    .single()

  if (drawErr) {
    // idempotency_key unique constraint violation — another request landed first
    if (drawErr.code === '23505' && idempotencyKey) {
      const { data: race } = await supabase
        .from('draw_requests')
        .select('id, request_number, status, amount, retainage_held, net_amount')
        .eq('idempotency_key', idempotencyKey)
        .single()
      if (race) {
        const baseUrl = req.nextUrl.origin
        return NextResponse.json({
          ok: true, draw_id: race.id, draw_number: race.request_number,
          status: race.status, total_amount: race.amount,
          retainage_held: race.retainage_held, net_amount: race.net_amount,
          line_items_saved: 0, lien_waivers_saved: 0, inspection_saved: false,
          status_url: `${baseUrl}/api/draws/${race.id}`,
          review_url: `${baseUrl}/lender/approvals`,
          idempotent: true,
        })
      }
    }
    return NextResponse.json({ error: drawErr.message }, { status: 500 })
  }

  // ── Save draw line items (G703) ───────────────────────────────────────────
  const drawLineRows: any[] = []
  for (const item of line_items) {
    let budgetLineId = item.budget_line_item_id

    if (!budgetLineId && item.description && item.scheduled_value != null) {
      const lineNo = String(item.line_no || item.sub_line_no || item.description.slice(0, 6))
      const { data: existing } = await supabase
        .from('budget_line_items')
        .select('id')
        .eq('project_id', projectId)
        .eq('line_no', lineNo)
        .maybeSingle()

      if (existing) {
        budgetLineId = existing.id
      } else {
        const { data: newLine } = await supabase
          .from('budget_line_items')
          .insert({
            project_id:      projectId,
            line_no:         lineNo,
            description:     item.description,
            scheduled_value: item.scheduled_value ?? 0,
            trade:           item.trade || null,
            csi_division:    item.csi_division || null,
            sort_order:      item.sort_order ?? drawLineRows.length,
          })
          .select('id')
          .single()
        budgetLineId = newLine?.id
      }
    }

    if (!budgetLineId) continue

    const prev   = parseFloat(item.work_completed_prev)   || 0
    const period = parseFloat(item.work_completed_period) || 0
    const stored = parseFloat(item.materials_stored)      || 0
    const total  = prev + period + stored
    const sv     = parseFloat(item.scheduled_value)       || 0
    const pct    = sv > 0 ? Math.round((total / sv) * 10000) / 100 : 0
    const balance = sv - total
    const lineRet = Math.round(period * retainage_rate * 100) / 100
    const due     = Math.round((period - lineRet) * 100) / 100

    drawLineRows.push({
      draw_request_id:        draw.id,
      budget_line_item_id:    budgetLineId,
      bb_pay_app_id:          item.bb_pay_app_id ?? null,
      sub_line_no:            item.sub_line_no   ?? null,
      sub_code:               item.sub_code      ?? null,
      csi_division:           item.csi_division  ?? null,
      trade:                  item.trade         ?? null,
      work_completed_prev:    prev,
      work_completed_period:  period,
      materials_stored:       stored,
      total_completed_stored: total,
      percent_complete:       pct,
      balance_to_finish:      balance,
      retainage_amount:       lineRet,
      retainage_cumulative:   item.retainage != null ? parseFloat(item.retainage) : null,
      current_payment_due:    due,
    })
  }

  if (drawLineRows.length > 0) {
    await supabase.from('draw_line_items').insert(drawLineRows)
  }

  // ── Save lien waivers ─────────────────────────────────────────────────────
  let waiversSaved = 0
  if (lien_waivers.length > 0) {
    const waiverRows = lien_waivers.map((w: any) => ({
      project_id:      projectId,
      draw_request_id: draw.id,
      bb_waiver_id:    w.bb_waiver_id    ?? null,
      bb_pay_app_id:   w.bb_pay_app_id   ?? null,
      sub_name:        w.sub_name,
      sub_code:        w.sub_code        || null,
      trade:           w.trade           || null,
      waiver_type:     w.waiver_type     || 'conditional_partial',
      state:           w.state           || 'AZ',   // Treger is AZ; default changed from TX
      statute_ref:     w.statute_ref     || null,
      through_amount:  w.through_amount  || 0,
      payment_amount:  w.payment_amount  || 0,
      status:          w.status          || (w.signed_by ? 'signed' : 'pending'),
      signed_at:       w.signed_by       ? (w.signed_at || new Date().toISOString()) : null,
      signed_by:       w.signed_by       || null,
      source:          'building_block',
    }))
    const { error: wErr } = await supabase.from('lien_waivers').insert(waiverRows)
    if (!wErr) waiversSaved = waiverRows.length
  }

  // ── Save inspection ───────────────────────────────────────────────────────
  // Into the inspector-portal schema (migration 011 replaced the table that
  // had outcome / inspection_date columns). It starts pending; a passed BB
  // inspection is claimed and anchored after the response (anchorBbInspection).
  let inspectionSaved = false
  let inspectionRowId: string | null = null
  if (inspection && inspection.inspector_name && inspection.inspector_email) {
    const bbSummary = [
      `Building Block inspection${bbInspectionId != null ? ` #${bbInspectionId}` : ''}`,
      inspection.outcome || null,
      inspection.inspection_date ? `signed ${inspection.inspection_date}` : null,
      inspection.inspector_company || null,
      bbInspectionUsed ? 'already used by another active draw, so this draw needs a new inspection' : null,
    ].filter(Boolean).join(' · ')
    const { data: inspectionRow, error: iErr } = await supabase
      .from('inspections')
      .insert({
        project_id:              projectId,
        draw_request_id:         draw.id,
        bb_inspection_result_id: bbInspectionId,
        inspector_name:          inspection.inspector_name,
        inspector_email:         inspection.inspector_email,
        scheduled_date:          inspection.inspection_date || null,
        status:                  'pending',
        notes:                   [bbSummary, inspection.notes].filter(Boolean).join('\n'),
      })
      .select('id')
      .single()
    if (iErr) {
      console.warn('[BB submit] inspection not saved:', iErr.message)
    } else {
      inspectionSaved = true
      inspectionRowId = inspectionRow.id
    }
  } else if (inspection) {
    console.warn('[BB submit] inspection not saved: inspector_name and inspector_email are required')
  }

  // ── Notify lender ─────────────────────────────────────────────────────────
  try {
    const { data: proj } = await supabase
      .from('projects')
      .select('lenders(profile_id), name')
      .eq('id', projectId)
      .single()
    const lenderProfileId = (proj?.lenders as any)?.profile_id
    if (lenderProfileId) {
      await supabase.from('notifications').insert({
        user_id: lenderProfileId,
        type:    'draw_submitted',
        title:   'New draw submitted via Building Block',
        body:    `${proj?.name} — Draw #${draw_number || draw.request_number} for ${
          new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(netAmt)
        } (net) is ready for review.`,
        link:    '/lender/approvals',
      })
    }
  } catch (notifErr) {
    console.warn('[BB submit] lender notification failed (non-fatal):', notifErr)
  }

  // ── Anchor BB's passed inspection (Inspector Credential NFT, taxon 3) ─────
  // After the response under waitUntil, so BB's 30 s submit never waits on XRPL
  if (canAnchorInspection && inspectionRowId && bbInspectionId != null) {
    waitUntil(anchorBbInspection({
      inspectionId:         inspectionRowId,
      drawRequestId:        draw.id,
      bbInspectionResultId: bbInspectionId,
      passedAt:             inspection.inspection_date || new Date().toISOString(),
    }))
  }

  // ── Response ──────────────────────────────────────────────────────────────
  const baseUrl = req.nextUrl.origin
  return NextResponse.json({
    ok:                true,
    draw_id:           draw.id,
    draw_number:       draw.request_number,
    status:            'submitted',
    total_amount:      grossAmt,
    gross_amount:      grossAmt,
    retainage_held:    retHeld,
    net_amount:        netAmt,
    currency,
    line_items_saved:  drawLineRows.length,
    lien_waivers_saved: waiversSaved,
    inspection_saved:  inspectionSaved,
    status_url:        `${baseUrl}/api/draws/${draw.id}`,
    review_url:        `${baseUrl}/lender/approvals`,
  })
}
