import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase/service'
import { NextRequest, NextResponse } from 'next/server'
import { feeTerms, INVOICE_DUE_DAYS } from '@/lib/fee-terms'
import { sendEmail } from '@/lib/email/send'
import { appUrl } from '@/lib/app-url'

// One fee invoice.
//   GET             the invoice with its lines (admin; or the lender it belongs to, once issued)
//   PATCH (admin)   { action: 'send' | 'mark_paid' | 'void', payment_reference? }
//
//   send       draft -> sent: stamps the invoice and due dates and emails the lender a link
//   mark_paid  sent -> paid: records when, and the bank or Stripe reference
//   void       draft or sent -> void: frees its fee lines to be invoiced again
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Row-level security decides whether this caller may see it.
  const { data: invoice } = await supabase.from('fee_invoices').select('*, lenders ( company_name )').eq('id', params.id).maybeSingle()
  if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
  const { data: lines } = await supabase.from('fee_accruals')
    .select('id, released_at, release_amount, rate_bps, fee_amount, waived, waiver_reason, projects ( name, loan_number ), draw_requests ( request_number )')
    .eq('invoice_id', params.id).order('released_at')
  return NextResponse.json({ invoice, lines: lines ?? [], terms: feeTerms() })
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if ((profile as any)?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const action = String(body?.action ?? '')
  const admin = serviceClient()
  const { data: inv } = await admin.from('fee_invoices').select('*').eq('id', params.id).maybeSingle()
  if (!inv) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
  const usd = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n))

  if (action === 'send') {
    if (inv.status !== 'draft') return NextResponse.json({ error: `This invoice is already ${inv.status}` }, { status: 409 })
    if (!inv.bill_to_email) return NextResponse.json({ error: 'This lender has no billing email on file. Add one on the lender\'s record, void this draft and build it again.' }, { status: 409 })
    // lib/email/send skips silently when email is not set up; an invoice must
    // never be recorded as sent when nothing went out.
    if (!process.env.RESEND_API_KEY) {
      return NextResponse.json({ error: 'Email is not set up on this site (no RESEND_API_KEY), so the invoice cannot be sent. It is still a draft.' }, { status: 503 })
    }
    const issued = new Date()
    const due = new Date(issued.getTime() + INVOICE_DUE_DAYS * 24 * 3600 * 1000)
    const { error } = await admin.from('fee_invoices').update({
      status: 'sent', issued_at: issued.toISOString(), due_at: due.toISOString(),
    }).eq('id', inv.id).eq('status', 'draft')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    await sendEmail({
      to: inv.bill_to_email,
      subject: `BuildChain invoice ${inv.number}: ${usd(inv.amount_due)} due ${due.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`,
      html: `<div style="font-family:Arial,sans-serif;max-width:600px">
        <h2 style="margin:0 0 8px">Invoice ${esc(inv.number)}</h2>
        <p>To ${esc(inv.bill_to_name)},</p>
        <p>Your BuildChain protocol fee invoice for ${esc(inv.period_start)} to ${esc(inv.period_end)} is ready.</p>
        <p><strong>Amount due: ${esc(usd(inv.amount_due))}</strong>, due ${esc(due.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }))}.</p>
        <p><a href="${appUrl()}/lender/invoices/${esc(inv.id)}">View the invoice</a> (sign in to BuildChain).</p>
        <p style="color:#5b6573;font-size:12px">BuildChain Protocol, Inc.</p>
      </div>`,
    })
    return NextResponse.json({ status: 'sent' })
  }

  if (action === 'mark_paid') {
    if (inv.status !== 'sent') return NextResponse.json({ error: 'Only an invoice that has been sent can be marked paid' }, { status: 409 })
    const reference = typeof body?.payment_reference === 'string' ? body.payment_reference.trim().slice(0, 200) : ''
    if (!reference) return NextResponse.json({ error: 'Enter the payment reference (bank transfer or Stripe id)' }, { status: 400 })
    const { error } = await admin.from('fee_invoices').update({
      status: 'paid', paid_at: new Date().toISOString(), payment_reference: reference,
    }).eq('id', inv.id).eq('status', 'sent')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ status: 'paid' })
  }

  if (action === 'void') {
    if (!['draft', 'sent'].includes(inv.status)) return NextResponse.json({ error: `A ${inv.status} invoice cannot be voided` }, { status: 409 })
    await admin.from('fee_accruals').update({ invoice_id: null }).eq('invoice_id', inv.id)
    const { error } = await admin.from('fee_invoices').update({ status: 'void' }).eq('id', inv.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ status: 'void' })
  }

  return NextResponse.json({ error: 'action must be send, mark_paid or void' }, { status: 400 })
}
