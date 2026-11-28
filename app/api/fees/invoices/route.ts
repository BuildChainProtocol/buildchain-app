import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase/service'
import { NextRequest, NextResponse } from 'next/server'
import { INVOICE_DUE_DAYS } from '@/lib/fee-terms'

// Monthly fee invoices.
//   GET                 invoices (an admin sees all; a lender sees their own issued ones)
//   POST (admin)        { lender_id, month: 'YYYY-MM' } build that lender's invoice for the month
//
// An invoice gathers the month's fee lines for one lender. Waived lines are
// shown on it and not charged. Building an invoice makes a draft; sending and
// marking paid are separate steps (PATCH /api/fees/invoices/[id]).
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/* eslint-disable @typescript-eslint/no-explicit-any */

const money = (n: number) => Math.round(n * 100) / 100

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Row-level security: every invoice for an admin, own issued invoices for a lender.
  const { data, error } = await supabase.from('fee_invoices')
    .select('id, number, lender_id, period_start, period_end, released_total, fee_total, waived_total, amount_due, status, issued_at, due_at, paid_at, bill_to_name, lenders ( company_name )')
    .order('period_start', { ascending: false }).limit(200)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ invoices: data ?? [] })
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if ((profile as any)?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const userId = user.id
  const body = await req.json().catch(() => ({}))
  const lenderId = String(body?.lender_id ?? '')
  const month = String(body?.month ?? '')
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return NextResponse.json({ error: 'month must look like 2026-12' }, { status: 400 })
  const [y, m] = month.split('-').map(Number)
  const start = new Date(Date.UTC(y, m - 1, 1))
  const next = new Date(Date.UTC(y, m, 1))
  if (next.getTime() > Date.now()) return NextResponse.json({ error: 'That month is not over yet. Fees are invoiced after the month ends.' }, { status: 409 })

  const admin = serviceClient()
  const { data: lender } = await admin.from('lenders')
    .select('id, company_name, legal_name, billing_email, billing_address, email').eq('id', lenderId).maybeSingle()
  if (!lender) return NextResponse.json({ error: 'Lender not found' }, { status: 404 })

  const { data: existing } = await admin.from('fee_invoices').select('id, number, status')
    .eq('lender_id', lenderId).eq('period_start', start.toISOString().slice(0, 10)).neq('status', 'void').limit(1).maybeSingle()
  if (existing) {
    return NextResponse.json({ error: `Invoice ${existing.number} already covers that month for this lender.`, invoiceId: existing.id }, { status: 409 })
  }

  // This month's lines, and any earlier line not yet on an invoice (one
  // written late, after its own month was invoiced): nothing is left behind.
  const { data: lines } = await admin.from('fee_accruals')
    .select('id, release_amount, fee_amount, waived')
    .eq('lender_id', lenderId).lt('released_at', next.toISOString()).is('invoice_id', null)
  const rows: any[] = lines ?? []
  if (!rows.length) return NextResponse.json({ error: 'No draws were released for this lender in that month and nothing earlier is waiting, so there is nothing to invoice.' }, { status: 409 })

  const feeTotal = money(rows.reduce((t, r) => t + Number(r.fee_amount), 0))
  const waivedTotal = money(rows.filter(r => r.waived).reduce((t, r) => t + Number(r.fee_amount), 0))

  // BC-2026-12-0001: the month, then the next number after the highest one
  // used for that month. Voided invoices stay on file, so a number is never
  // used twice. If someone else takes the number first, take the next.
  const prefix = `BC-${month}-`
  let invoice: any = null
  let error: any = null
  for (let attempt = 0; attempt < 5 && !invoice; attempt++) {
    const { data: used } = await admin.from('fee_invoices').select('number').like('number', `${prefix}%`)
    const highest = ((used ?? []) as any[]).reduce((top, r) => Math.max(top, parseInt(String(r.number).slice(prefix.length), 10) || 0), 0)
    const number = `${prefix}${String(highest + 1).padStart(4, '0')}`
    const made = await insertInvoice(number)
    invoice = made.data; error = made.error
    // 23505 on the number: try the next. On the lender-and-month rule: someone
    // else just built this invoice.
    if (error?.code === '23505' && String(error.message).includes('fee_invoices_lender_period_uniq')) {
      return NextResponse.json({ error: 'An invoice for that month was just created for this lender. Reload the page.' }, { status: 409 })
    }
    if (error && error.code !== '23505') break
  }
  if (error || !invoice) return NextResponse.json({ error: error?.message ?? 'The invoice could not be created' }, { status: 500 })

  // Only lines nobody else has invoiced in the meantime.
  const { data: linked, error: linkErr } = await admin.from('fee_accruals').update({ invoice_id: invoice.id })
    .in('id', rows.map(r => r.id)).is('invoice_id', null).select('id')
  if (linkErr || (linked ?? []).length !== rows.length) {
    await admin.from('fee_accruals').update({ invoice_id: null }).eq('invoice_id', invoice.id)
    await admin.from('fee_invoices').delete().eq('id', invoice.id)
    return NextResponse.json({ error: linkErr?.message ?? 'Some of these fee lines were just put on another invoice. Reload and try again.' }, { status: 409 })
  }
  return NextResponse.json({ invoiceId: invoice.id, number: invoice.number, dueDays: INVOICE_DUE_DAYS }, { status: 201 })

  function insertInvoice(number: string) {
    return admin.from('fee_invoices').insert({
    number, lender_id: lenderId,
    period_start: start.toISOString().slice(0, 10),
    period_end: new Date(next.getTime() - 24 * 3600 * 1000).toISOString().slice(0, 10),
    released_total: money(rows.reduce((t, r) => t + Number(r.release_amount), 0)),
    fee_total: feeTotal, waived_total: waivedTotal, amount_due: money(feeTotal - waivedTotal),
    status: 'draft',
    bill_to_name: lender.legal_name ?? lender.company_name,
    bill_to_email: lender.billing_email ?? lender.email,
    bill_to_address: lender.billing_address,
    created_by: userId,
    }).select('id, number').single()
  }
}
