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

// Sentinel values Building Block sends when lender/borrower is unknown.
// Skip DB upsert for these — inserting "N/A" as a company name pollutes the table.
const SKIP_NAMES = new Set(['n/a', 'na', 'unknown', 'none', ''])

function isSkipName(name: string | null | undefined): boolean {
  return !name || SKIP_NAMES.has(name.trim().toLowerCase())
}

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

export async function POST(req: NextRequest) {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const auth = req.headers.get('authorization') || ''
  const token = auth.replace('Bearer ', '').trim()
  const validKey = process.env.BUILDINGBLOCK_API_KEY
  if (!validKey) return NextResponse.json({ error: 'BUILDINGBLOCK_API_KEY not configured' }, { status: 500 })
  if (!token || token !== validKey) return unauthorized('Invalid API key')

  // ── Parse body ──────────────────────────────────────────────────────────────
  let body: any
  try { body = await req.json() } catch { return bad('Invalid JSON') }

  const {
    name, address, city, state = 'AZ',
    loan_amount = 0,
    loan_number,
    property_type = 'multifamily',
    borrower_name, lender_name,
  } = body

  if (!name) return bad('name is required')
  if (!loan_number) return bad('loan_number is required')

  // ── Supabase client (service role — bypasses RLS) ───────────────────────────
  let supabase: any
  try {
    supabase = getServiceClient()
  } catch (e: any) {
    return NextResponse.json({ error: `Supabase config error: ${e.message}` }, { status: 500 })
  }

  // ── Idempotency: return existing project if loan_number already registered ──
  try {
    const { data: existing, error: lookupErr } = await (supabase as any)
      .from('projects')
      .select('id, borrower_id, lender_id')
      .eq('loan_number', loan_number)
      .maybeSingle()

    if (lookupErr) {
      return NextResponse.json({ error: `Project lookup failed: ${lookupErr.message}` }, { status: 500 })
    }

    if (existing) {
      return NextResponse.json({
        ok: true,
        bc_project_id: (existing as any).id,
        loan_number,
        created: false,
        borrower_id: (existing as any).borrower_id,
        lender_id: (existing as any).lender_id,
      })
    }
  } catch (e: any) {
    return NextResponse.json({ error: `Project lookup error: ${e.message}` }, { status: 500 })
  }

  // ── Upsert borrower ─────────────────────────────────────────────────────────
  let borrowerId: string | null = null
  if (!isSkipName(borrower_name)) {
    try {
      const { data: b, error: bLookupErr } = await (supabase as any)
        .from('borrowers')
        .select('id')
        .eq('company_name', borrower_name)
        .maybeSingle()

      if (bLookupErr) {
        return NextResponse.json({ error: `Borrower lookup failed: ${bLookupErr.message}` }, { status: 500 })
      }

      if (b) {
        borrowerId = (b as any).id
      } else {
        const safeSlug = (borrower_name as string).toLowerCase().replace(/[^a-z0-9]/g, '')
        const { data: newB, error: bInsertErr } = await (supabase as any)
          .from('borrowers')
          .insert({
            company_name: borrower_name,
            contact_name: 'GC-provisioned',
            email: `contact@${safeSlug || 'unknown'}.example`,
            license_state: state,
            rating: 'new',
          })
          .select('id')
          .single()

        if (bInsertErr) {
          return NextResponse.json({ error: `Borrower creation failed: ${bInsertErr.message}` }, { status: 500 })
        }
        borrowerId = (newB as any)?.id ?? null
      }
    } catch (e: any) {
      return NextResponse.json({ error: `Borrower upsert error: ${e.message}` }, { status: 500 })
    }
  }

  // ── Upsert lender ───────────────────────────────────────────────────────────
  // Skip sentinel values like "N/A" — not a real lender name
  let lenderId: string | null = null
  if (!isSkipName(lender_name)) {
    try {
      const { data: l, error: lLookupErr } = await (supabase as any)
        .from('lenders')
        .select('id')
        .eq('company_name', lender_name)
        .maybeSingle()

      if (lLookupErr) {
        return NextResponse.json({ error: `Lender lookup failed: ${lLookupErr.message}` }, { status: 500 })
      }

      if (l) {
        lenderId = (l as any).id
      } else {
        const safeSlug = (lender_name as string).toLowerCase().replace(/[^a-z0-9]/g, '')
        const { data: newL, error: lInsertErr } = await (supabase as any)
          .from('lenders')
          .insert({
            company_name: lender_name,
            contact_name: 'GC-provisioned',
            email: `contact@${safeSlug || 'unknown'}.example`,
            loan_types: ['residential', 'multifamily', 'commercial'],
            max_ltv: 75.00,
          })
          .select('id')
          .single()

        if (lInsertErr) {
          return NextResponse.json({ error: `Lender creation failed: ${lInsertErr.message}` }, { status: 500 })
        }
        lenderId = (newL as any)?.id ?? null
      }
    } catch (e: any) {
      return NextResponse.json({ error: `Lender upsert error: ${e.message}` }, { status: 500 })
    }
  }

  // ── Create project ──────────────────────────────────────────────────────────
  try {
    const { data: newP, error: pErr } = await (supabase as any)
      .from('projects')
      .insert({
        name,
        address,
        city: city || null,
        state,
        zip: null,
        property_type,
        borrower_id: borrowerId,
        lender_id: lenderId,
        loan_amount,
        loan_number,
        amount_drawn: 0,
        interest_rate: null,
        stage: 'active',
        appraised_value: null,
        notes: `Provisioned by Building Block on ${new Date().toISOString().split('T')[0]}`,
      })
      .select('id')
      .single()

    if (pErr) return NextResponse.json({ error: `Project creation failed: ${pErr.message}` }, { status: 500 })

    return NextResponse.json({
      ok: true,
      bc_project_id: (newP as any).id,
      loan_number,
      created: true,
      borrower_id: borrowerId,
      lender_id: lenderId,
    })
  } catch (e: any) {
    return NextResponse.json({ error: `Project creation error: ${e.message}` }, { status: 500 })
  }
}
