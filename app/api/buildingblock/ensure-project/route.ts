/**
 * POST /api/buildingblock/ensure-project
 *
 * Called by Building Block when a GC creates a project locally. If a project
 * with the same loan_number already exists on BC, returns its id. Otherwise
 * creates the project (and its borrower + lender if names provided but rows
 * don't yet exist) and returns the new id.
 *
 * Auth: same BUILDINGBLOCK_API_KEY as /api/buildingblock/submit.
 *
 * Body: {
 *   name, address, city, state, loan_amount, loan_number,
 *   property_type, borrower_name?, lender_name?, source
 * }
 * Returns: { ok, bc_project_id, loan_number, created:bool, borrower_id, lender_id }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

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
  const auth = req.headers.get('authorization') || ''
  const token = auth.replace('Bearer ', '').trim()
  const validKey = process.env.BUILDINGBLOCK_API_KEY
  if (!validKey) return NextResponse.json({ error: 'BUILDINGBLOCK_API_KEY not configured' }, { status: 500 })
  if (!token || token !== validKey) return unauthorized('Invalid API key')

  let body: any
  try { body = await req.json() } catch { return bad('Invalid JSON') }

  const {
    name, address, city, state = 'TX',
    loan_amount = 0,
    loan_number,
    property_type = 'multifamily',
    borrower_name, lender_name,
  } = body

  if (!name || !loan_number) return bad('name and loan_number required')

  const supabase = getServiceClient()

  // Idempotency: return existing project if loan_number matches
  const { data: existing } = await supabase
    .from('projects')
    .select('id, borrower_id, lender_id')
    .eq('loan_number', loan_number)
    .maybeSingle()

  if (existing) {
    return NextResponse.json({
      ok: true, bc_project_id: existing.id,
      loan_number, created: false,
      borrower_id: existing.borrower_id,
      lender_id: existing.lender_id,
    })
  }

  // Upsert borrower by company_name
  let borrowerId: string | null = null
  if (borrower_name) {
    const { data: b } = await supabase
      .from('borrowers')
      .select('id').eq('company_name', borrower_name).maybeSingle()
    if (b) borrowerId = b.id
    else {
      const { data: newB } = await supabase.from('borrowers')
        .insert({ company_name: borrower_name, contact_name: 'GC-provisioned',
                  email: `contact@${borrower_name.toLowerCase().replace(/[^a-z0-9]/g, '')}.example`,
                  license_state: state, rating: 'new' })
        .select('id').single()
      borrowerId = newB?.id ?? null
    }
  }

  // Upsert lender by company_name
  let lenderId: string | null = null
  if (lender_name) {
    const { data: l } = await supabase
      .from('lenders')
      .select('id').eq('company_name', lender_name).maybeSingle()
    if (l) lenderId = l.id
    else {
      const { data: newL } = await supabase.from('lenders')
        .insert({ company_name: lender_name, contact_name: 'GC-provisioned',
                  email: `contact@${lender_name.toLowerCase().replace(/[^a-z0-9]/g, '')}.example`,
                  loan_types: ['residential', 'multifamily', 'commercial'],
                  max_ltv: 75.00 })
        .select('id').single()
      lenderId = newL?.id ?? null
    }
  }

  // Create the project
  const { data: newP, error: pErr } = await supabase.from('projects')
    .insert({
      name, address, city, state, zip: null,
      property_type,
      borrower_id: borrowerId, lender_id: lenderId,
      loan_amount, loan_number,
      amount_drawn: 0,
      interest_rate: null,
      stage: 'active',
      appraised_value: null,
      notes: `Provisioned by Building Block on ${new Date().toISOString().split('T')[0]}`,
    })
    .select('id').single()

  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 })

  return NextResponse.json({
    ok: true,
    bc_project_id: newP!.id,
    loan_number, created: true,
    borrower_id: borrowerId,
    lender_id: lenderId,
  })
}
