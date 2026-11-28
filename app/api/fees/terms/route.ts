import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase/service'
import { NextRequest, NextResponse } from 'next/server'
import { FEE_TERMS_VERSION, feeTerms } from '@/lib/fee-terms'

// The fee terms, and a lender's agreement to them.
//   GET   the terms, and (for a lender) whether they have accepted this version
//   POST  the lender accepts: { accept: true, legal_name, billing_email, billing_address }
//
// A lender's record can be written only by an admin, so the acceptance is
// saved with the service key after checking that the caller is that lender.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/* eslint-disable @typescript-eslint/no-explicit-any */

async function caller() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const admin = serviceClient()
  const { data: lender } = await admin.from('lenders')
    .select('id, company_name, legal_name, billing_email, billing_address, email, fee_terms_version, fee_terms_accepted_at')
    .eq('profile_id', user.id).maybeSingle()
  return { user, admin, lender: lender as any }
}

export async function GET() {
  const c = await caller()
  if (c.error) return c.error
  const l = c.lender
  return NextResponse.json({
    terms: feeTerms(),
    lender: l ? {
      companyName: l.company_name,
      legalName: l.legal_name ?? l.company_name ?? '',
      billingEmail: l.billing_email ?? l.email ?? '',
      billingAddress: l.billing_address ?? '',
      accepted: l.fee_terms_version === FEE_TERMS_VERSION && !!l.fee_terms_accepted_at,
      acceptedAt: l.fee_terms_version === FEE_TERMS_VERSION ? l.fee_terms_accepted_at : null,
      // Accepted an older version: say so, the current one still needs accepting.
      acceptedOlderVersion: !!l.fee_terms_accepted_at && l.fee_terms_version !== FEE_TERMS_VERSION ? l.fee_terms_version : null,
    } : null,
  })
}

export async function POST(req: NextRequest) {
  const c = await caller()
  if (c.error) return c.error
  if (!c.lender) return NextResponse.json({ error: 'This account is not linked to a lender record' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
  const legalName = text(body?.legal_name, 200)
  const billingEmail = text(body?.billing_email, 200)
  const billingAddress = text(body?.billing_address, 600)

  if (body?.accept !== true) return NextResponse.json({ error: 'Tick the box to accept the fee terms' }, { status: 400 })
  if (legalName.length < 2) return NextResponse.json({ error: 'Enter the legal name invoices should be made out to' }, { status: 400 })
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(billingEmail)) return NextResponse.json({ error: 'Enter the email address invoices should be sent to' }, { status: 400 })
  if (billingAddress.length < 8) return NextResponse.json({ error: 'Enter the billing address' }, { status: 400 })

  const acceptedAt = new Date().toISOString()
  const { error } = await c.admin.from('lenders').update({
    legal_name: legalName, billing_email: billingEmail, billing_address: billingAddress,
    fee_terms_version: FEE_TERMS_VERSION, fee_terms_accepted_at: acceptedAt, fee_terms_accepted_by: c.user!.id,
  }).eq('id', c.lender.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // The record of what was agreed to: the exact text, the version, who and when.
  await c.admin.from('activity_log').insert({
    project_id: null, user_id: c.user!.id, action: 'fee_terms_accepted', entity_type: 'lender', entity_id: c.lender.id,
    details: { version: FEE_TERMS_VERSION, terms: feeTerms().points, legal_name: legalName, billing_email: billingEmail, accepted_at: acceptedAt },
  })
  return NextResponse.json({ accepted: true, acceptedAt, version: FEE_TERMS_VERSION })
}
