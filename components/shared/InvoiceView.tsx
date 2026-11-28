'use client'

import { useCallback, useEffect, useState } from 'react'
import { Printer } from 'lucide-react'

interface Invoice {
  id: string
  number: string
  period_start: string
  period_end: string
  released_total: number
  fee_total: number
  waived_total: number
  amount_due: number
  status: string
  issued_at: string | null
  due_at: string | null
  paid_at: string | null
  payment_reference: string | null
  bill_to_name: string | null
  bill_to_email: string | null
  bill_to_address: string | null
}
interface Line {
  id: string
  released_at: string
  release_amount: number
  rate_bps: number
  fee_amount: number
  waived: boolean
  waiver_reason: string | null
  projects: { name: string; loan_number: string | null } | null
  draw_requests: { request_number: string } | null
}
interface Terms { version: string; rate: string; points: string[] }
type Action = 'send' | 'mark_paid' | 'void'

const usd = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n))
const longDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
/** "2026-11-01" is a calendar date, not a moment: read it in UTC so it never slips a day. */
const calendarDay = (day: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(`${day.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' })
const percent = (bps: number) => `${(Number(bps) / 100).toFixed(2)}%`
const label = 'text-[10px] font-semibold uppercase tracking-[0.12em]'

// Print only the invoice: everything else on the page is hidden, and the
// invoice sits at the top of a plain white sheet.
const PRINT_CSS = `
@media print {
  html, body { background: #fff !important; }
  body * { visibility: hidden !important; background: transparent !important; box-shadow: none !important; }
  [data-invoice], [data-invoice] * { visibility: visible !important; }
  [data-invoice] { position: absolute !important; left: 0; top: 0; width: 100% !important; max-width: none !important; margin: 0 !important; border: 0 !important; background: #fff !important; }
  [data-invoice] [data-scroll] { overflow: visible !important; }
  [data-noprint], [data-noprint] * { display: none !important; }
}
`

/** One fee invoice, laid out to be read and printed. Nothing here takes a payment. */
export default function InvoiceView({ id, admin = false }: { id: string; admin?: boolean }) {
  const [data, setData] = useState<{ invoice: Invoice; lines: Line[]; terms: Terms } | null>(null)
  const [missing, setMissing] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [pending, setPending] = useState<Action | null>(null)
  const [reference, setReference] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')

  const load = useCallback(async () => {
    let res: Response
    try { res = await fetch(`/api/fees/invoices/${encodeURIComponent(id)}`) } catch { setLoadError('The invoice could not be loaded. Check your connection and reload the page.'); return }
    const json = await res.json().catch(() => ({}))
    if (res.status === 404) { setMissing(true); return }
    if (!res.ok || !json.invoice) { setLoadError(json.error || `The invoice could not be loaded (${res.status})`); return }
    setMissing(false); setLoadError('')
    setData({ invoice: json.invoice, lines: json.lines ?? [], terms: json.terms })
  }, [id])
  useEffect(() => { load() }, [load])

  async function run(action: Action) {
    if (busy) return
    setBusy(true); setActionError('')
    let res: Response
    try {
      res = await fetch(`/api/fees/invoices/${encodeURIComponent(id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'mark_paid' ? { action, payment_reference: reference } : { action }),
      })
    } catch { setBusy(false); setActionError('Nothing was changed. Check your connection and try again.'); return }
    const json = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setActionError(json.error || `Nothing was changed (${res.status})`); return }
    setPending(null); setReference('')
    await load()
  }

  if (missing) {
    return (
      <div className="rounded-lg border px-6 py-8 text-sm" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)', color: 'var(--bc-muted)' }}>
        This invoice could not be found.
      </div>
    )
  }
  if (loadError) {
    return (
      <div className="rounded-lg border px-4 py-3 text-sm" role="alert" style={{ borderColor: 'rgba(192,57,43,0.3)', background: 'rgba(192,57,43,0.06)', color: '#c0392b' }}>
        {loadError}
      </div>
    )
  }
  if (!data) return <div className="text-sm" style={{ color: 'var(--bc-muted)' }}>Loading the invoice…</div>

  const { invoice: inv, lines, terms } = data
  const draft = inv.status === 'draft'
  const sent = inv.status === 'sent'

  const statusText =
    draft ? 'Draft'
    : sent ? (inv.due_at ? `Due by ${longDate(inv.due_at)}` : 'Due')
    : inv.status === 'paid' ? `Paid${inv.paid_at ? ` on ${longDate(inv.paid_at)}` : ''}`
    : inv.status === 'void' ? 'Void'
    : inv.status
  const statusBadge = draft ? 'badge-gray' : sent ? 'badge-gold' : inv.status === 'paid' ? 'badge-green' : inv.status === 'void' ? 'badge-red' : 'badge-gray'

  const button = 'px-4 py-2 rounded-lg text-sm font-bold disabled:opacity-50'
  const gold = { background: 'var(--bc-gold)', color: 'var(--bc-dark)' }
  const plain = { borderColor: 'var(--bc-border)', color: 'var(--bc-text)' }

  return (
    <div className="max-w-4xl">
      <style>{PRINT_CSS}</style>

      <div data-noprint className="mb-4 flex flex-wrap items-center justify-end gap-2">
        <button type="button" onClick={() => window.print()} className={`${button} border inline-flex items-center gap-2`} style={plain}>
          <Printer size={15} /> Print
        </button>
      </div>

      {admin && (draft || sent) && (
        <div data-noprint className="rounded-lg border mb-4" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
          <div className="px-5 py-4 flex flex-wrap items-center gap-2">
            <div className={`${label} mr-auto`} style={{ color: 'var(--bc-muted)' }}>Actions</div>
            {draft && (
              <button type="button" disabled={busy} onClick={() => { setPending('send'); setActionError('') }} className={button} style={gold}>Send to lender</button>
            )}
            {sent && (
              <button type="button" disabled={busy} onClick={() => { setPending('mark_paid'); setActionError('') }} className={button} style={gold}>Mark paid</button>
            )}
            <button type="button" disabled={busy} onClick={() => { setPending('void'); setActionError('') }} className={`${button} border`} style={plain}>Void</button>
          </div>

          {pending && (
            <form onSubmit={e => { e.preventDefault(); run(pending) }} className="px-5 py-4 border-t" style={{ borderColor: 'var(--bc-border)', background: 'var(--bc-page)' }}>
              {pending === 'send' && (
                <div className="text-sm break-words" style={{ color: 'var(--bc-text)' }}>
                  {inv.bill_to_email
                    ? <>This emails the invoice to {inv.bill_to_email}.</>
                    : 'This invoice has no billing email on it, so it cannot be sent.'}
                  <span style={{ color: 'var(--bc-muted)' }}> It is dated today and falls due 30 days from today.</span>
                </div>
              )}
              {pending === 'void' && (
                <div className="text-sm" style={{ color: 'var(--bc-text)' }}>
                  Void invoice {inv.number}? Its fee lines are freed and can be put on a new invoice.
                  {sent && ' The lender has already been sent this invoice; voiding it does not notify them.'}
                </div>
              )}
              {pending === 'mark_paid' && (
                <div>
                  <label htmlFor="payment-reference" className="text-sm block" style={{ color: 'var(--bc-text)' }}>
                    Payment reference (bank transfer or Stripe id)
                  </label>
                  <input id="payment-reference" type="text" value={reference} maxLength={200} onChange={e => setReference(e.target.value)} autoFocus
                    className="mt-1 w-full max-w-sm rounded-lg px-3 py-2 text-sm border" style={{ borderColor: 'var(--bc-border)', background: 'var(--bc-card)', color: 'var(--bc-text)' }} />
                  <div className="mt-1 text-xs" style={{ color: 'var(--bc-muted)' }}>Mark it paid only once the money has arrived. This records the payment; it does not take one.</div>
                </div>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="submit" disabled={busy || (pending === 'mark_paid' && !reference.trim())} className={button} style={gold}>
                  {busy ? 'Working…' : pending === 'send' ? 'Send invoice' : pending === 'void' ? 'Void invoice' : 'Mark paid'}
                </button>
                <button type="button" disabled={busy} onClick={() => { setPending(null); setActionError('') }} className={`${button} border`} style={plain}>Cancel</button>
              </div>
            </form>
          )}
          {actionError && <div className="px-5 py-3 border-t text-sm" role="alert" style={{ borderColor: 'var(--bc-border)', color: '#c0392b' }}>{actionError}</div>}
        </div>
      )}

      <div data-invoice className="rounded-lg border" style={{ background: '#fff', borderColor: 'var(--bc-border)', color: 'var(--bc-text)' }}>
        <div className="px-6 py-6 border-b flex flex-wrap items-start justify-between gap-4" style={{ borderColor: 'var(--bc-border)' }}>
          <div className="min-w-0">
            <div className="text-lg font-bold" style={{ color: 'var(--bc-dark)' }}>BuildChain Protocol, Inc.</div>
            <div className="mt-1 text-sm break-words" style={{ color: 'var(--bc-muted)' }}>Invoice {inv.number}</div>
          </div>
          <span className={`badge ${statusBadge}`}>{statusText}</span>
        </div>

        <div className="px-6 py-5 border-b grid gap-5 sm:grid-cols-2" style={{ borderColor: 'var(--bc-border)' }}>
          <div className="min-w-0">
            <div className={label} style={{ color: 'var(--bc-muted)' }}>Bill to</div>
            <div className="mt-1 text-sm font-semibold break-words">{inv.bill_to_name || '—'}</div>
            {inv.bill_to_address && <div className="text-sm whitespace-pre-line break-words">{inv.bill_to_address}</div>}
            {inv.bill_to_email && <div className="text-sm break-all" style={{ color: 'var(--bc-muted)' }}>{inv.bill_to_email}</div>}
          </div>
          <div className="grid grid-cols-2 gap-4 content-start">
            <div className="col-span-2">
              <div className={label} style={{ color: 'var(--bc-muted)' }}>Period</div>
              <div className="mt-1 text-sm">
                {calendarDay(inv.period_start, { month: 'long', year: 'numeric' })}
                <span style={{ color: 'var(--bc-muted)' }}>
                  {' '}({calendarDay(inv.period_start, { month: 'long', day: 'numeric' })} to {calendarDay(inv.period_end, { month: 'long', day: 'numeric', year: 'numeric' })})
                </span>
              </div>
            </div>
            {draft || !inv.issued_at ? (
              <div className="col-span-2">
                <div className={label} style={{ color: 'var(--bc-muted)' }}>Issued</div>
                <div className="mt-1 text-sm">{draft ? 'Draft: not yet issued' : '—'}</div>
              </div>
            ) : (
              <>
                <div>
                  <div className={label} style={{ color: 'var(--bc-muted)' }}>Issued</div>
                  <div className="mt-1 text-sm">{longDate(inv.issued_at)}</div>
                </div>
                <div>
                  <div className={label} style={{ color: 'var(--bc-muted)' }}>Due</div>
                  <div className="mt-1 text-sm">{inv.due_at ? longDate(inv.due_at) : '—'}</div>
                </div>
              </>
            )}
          </div>
        </div>

        {lines.length === 0 ? (
          <div className="px-6 py-6 border-b text-sm" style={{ borderColor: 'var(--bc-border)', color: 'var(--bc-muted)' }}>
            {inv.status === 'void' ? 'This invoice is void. Its fee lines were taken off it.' : 'This invoice has no lines.'}
          </div>
        ) : (
          <div data-scroll className="overflow-x-auto border-b" style={{ borderColor: 'var(--bc-border)' }}>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--bc-muted)' }}>
                  <th className="px-6 py-2.5">Released</th>
                  <th className="px-3 py-2.5">Loan</th>
                  <th className="px-3 py-2.5">Draw</th>
                  <th className="px-3 py-2.5 text-right">Amount released</th>
                  <th className="px-3 py-2.5 text-right">Rate</th>
                  <th className="px-6 py-2.5 text-right">Fee</th>
                </tr>
              </thead>
              <tbody>
                {lines.map(l => (
                  <tr key={l.id} className="border-t align-top" style={{ borderColor: 'var(--bc-border)' }}>
                    <td className="px-6 py-2.5 whitespace-nowrap">{longDate(l.released_at)}</td>
                    <td className="px-3 py-2.5">
                      {l.projects?.name ?? '—'}
                      {l.projects?.loan_number && <span className="ml-1.5 text-xs font-mono" style={{ color: 'var(--bc-muted)' }}>#{l.projects.loan_number}</span>}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{l.draw_requests?.request_number ?? '—'}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">{usd(l.release_amount)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">{percent(l.rate_bps)}</td>
                    <td className="px-6 py-2.5 text-right tabular-nums">
                      {l.waived ? (
                        <>
                          <span className="line-through whitespace-nowrap" style={{ color: 'var(--bc-muted)' }}>{usd(l.fee_amount)}</span>
                          <div className="text-xs" style={{ color: 'var(--bc-muted)' }}>Waived{l.waiver_reason ? `: ${l.waiver_reason}` : ''}</div>
                        </>
                      ) : <span className="whitespace-nowrap">{usd(l.fee_amount)}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="px-6 py-5 border-b flex justify-end" style={{ borderColor: 'var(--bc-border)' }}>
          <dl className="w-full sm:w-80 text-sm">
            <div className="flex justify-between gap-4 py-1">
              <dt style={{ color: 'var(--bc-muted)' }}>Released</dt>
              <dd className="tabular-nums">{usd(inv.released_total)}</dd>
            </div>
            <div className="flex justify-between gap-4 py-1">
              <dt style={{ color: 'var(--bc-muted)' }}>Fees</dt>
              <dd className="tabular-nums">{usd(inv.fee_total)}</dd>
            </div>
            <div className="flex justify-between gap-4 py-1">
              <dt style={{ color: 'var(--bc-muted)' }}>Less waived</dt>
              <dd className="tabular-nums">{Number(inv.waived_total) > 0 ? `-${usd(inv.waived_total)}` : usd(0)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 pt-3 mt-2 border-t" style={{ borderColor: 'var(--bc-border)' }}>
              <dt className={label} style={{ color: 'var(--bc-muted)' }}>Amount due</dt>
              <dd className="bc-figure text-[30px] leading-none tabular-nums">{usd(inv.amount_due)}</dd>
            </div>
          </dl>
        </div>

        <div className="px-6 py-5 border-b" style={{ borderColor: 'var(--bc-border)' }}>
          <div className={label} style={{ color: 'var(--bc-muted)' }}>Status</div>
          <div className="mt-1 text-sm font-semibold">{statusText}</div>
          {inv.status === 'paid' && inv.payment_reference && (
            <div className="text-sm break-words" style={{ color: 'var(--bc-muted)' }}>Payment reference: {inv.payment_reference}</div>
          )}
          {inv.status === 'void' && <div className="text-sm" style={{ color: 'var(--bc-muted)' }}>Nothing is due on this invoice.</div>}

          {inv.status !== 'void' && inv.status !== 'paid' && (
            <>
              <div className={`${label} mt-4`} style={{ color: 'var(--bc-muted)' }}>How to pay</div>
              <div className="mt-1 text-sm">Pay by bank transfer using the invoice number as the reference. Payment details are sent with the invoice.</div>
            </>
          )}
        </div>

        <div className="px-6 py-4 text-xs" style={{ color: 'var(--bc-muted)' }}>
          Fees are {terms?.rate ?? '0.30%'} of each amount released, invoiced monthly. The first draw released for you is free.
        </div>
      </div>
    </div>
  )
}
