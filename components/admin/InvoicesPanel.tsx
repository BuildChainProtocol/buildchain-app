'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'

interface Lender { id: string; company_name: string }
interface Invoice {
  id: string
  number: string
  period_start: string
  amount_due: number
  status: string
  due_at: string | null
  bill_to_name: string | null
  lenders: { company_name: string } | null
}

const usd = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n))
const longDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
/** "2026-11-01" is a calendar date, not a moment: read it in UTC so it never slips a month. */
const period = (day: string) => new Date(`${day.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
/** Last month as YYYY-MM: the most recent month that has ended. */
const lastMonth = () => {
  const now = new Date()
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

const STATUS: Record<string, [string, string]> = {
  draft: ['Draft', 'badge-gray'], sent: ['Due', 'badge-gold'], paid: ['Paid', 'badge-green'], void: ['Void', 'badge-red'],
}
const label = 'text-[10px] font-semibold uppercase tracking-[0.12em]'
const fieldStyle = { borderColor: 'var(--bc-border)', background: 'var(--bc-card)', color: 'var(--bc-text)' }

/** Build a lender's monthly fee invoice, and the list of every invoice. Nothing here takes a payment. */
export default function InvoicesPanel() {
  const router = useRouter()
  const [lenders, setLenders] = useState<Lender[] | null>(null)
  const [lendersError, setLendersError] = useState('')
  const [invoices, setInvoices] = useState<Invoice[] | null>(null)
  const [listError, setListError] = useState('')
  const [lenderId, setLenderId] = useState('')
  const [month, setMonth] = useState(lastMonth())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [existingId, setExistingId] = useState('')

  const loadInvoices = useCallback(async () => {
    let res: Response
    try { res = await fetch('/api/fees/invoices') } catch { setListError('The invoices could not be loaded. Check your connection and reload the page.'); return }
    const json = await res.json().catch(() => ({}))
    if (res.ok) { setInvoices(json.invoices ?? []); setListError('') }
    else setListError(json.error || `The invoices could not be loaded (${res.status})`)
  }, [])

  useEffect(() => {
    let live = true
    fetch('/api/lenders').then(async r => {
      const json = await r.json().catch(() => ({}))
      if (!live) return
      if (r.ok) setLenders(json.data ?? []); else setLendersError(json.error || `The lenders could not be loaded (${r.status})`)
    }).catch(() => { if (live) setLendersError('The lenders could not be loaded. Check your connection and reload the page.') })
    loadInvoices()
    return () => { live = false }
  }, [loadInvoices])

  async function build(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setError(''); setExistingId('')
    if (!lenderId) { setError('Choose a lender'); return }
    if (!month) { setError('Choose a month'); return }
    setBusy(true)
    let res: Response
    try {
      res = await fetch('/api/fees/invoices', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lender_id: lenderId, month }),
      })
    } catch { setBusy(false); setError('The invoice was not built. Check your connection and try again.'); return }
    const json = await res.json().catch(() => ({}))
    if (res.status === 201 && json.invoiceId) { router.push(`/admin/fees/invoices/${json.invoiceId}`); return }
    setBusy(false)
    if (!res.ok) {
      setError(json.error || `The invoice was not built (${res.status})`)
      if (json.invoiceId) setExistingId(String(json.invoiceId))
      return
    }
    // A success that is not a new invoice: say what came back rather than assume.
    if (json.invoiceId) { router.push(`/admin/fees/invoices/${json.invoiceId}`); return }
    setError('The server did not return an invoice. Check the list below.')
    loadInvoices()
  }

  return (
    <div className="rounded-lg border mt-6" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
      <div className="px-6 py-4 border-b" style={{ borderColor: 'var(--bc-border)' }}>
        <h3 className="uppercase">Invoices</h3>
        <div className="mt-1 text-sm" style={{ color: 'var(--bc-muted)' }}>
          An invoice is built after the month ends, sent to the lender&apos;s billing email, and marked paid when the money arrives. Nothing is charged automatically.
        </div>
      </div>

      <form onSubmit={build} className="px-6 py-5 border-b" style={{ borderColor: 'var(--bc-border)' }}>
        <div className={`${label} mb-3`} style={{ color: 'var(--bc-muted)' }}>Build an invoice</div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px] max-w-sm">
            <label htmlFor="invoice-lender" className="text-xs" style={{ color: 'var(--bc-muted)' }}>Lender</label>
            <select id="invoice-lender" value={lenderId} onChange={e => setLenderId(e.target.value)} disabled={!lenders}
              className="mt-1 w-full rounded-lg px-3 py-1.5 text-sm border" style={fieldStyle}>
              <option value="">{lenders ? (lenders.length ? 'Choose a lender' : 'No lenders yet') : lendersError ? 'Not loaded' : 'Loading…'}</option>
              {(lenders ?? []).map(l => <option key={l.id} value={l.id}>{l.company_name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="invoice-month" className="text-xs block" style={{ color: 'var(--bc-muted)' }}>Month</label>
            <input id="invoice-month" type="month" value={month} max={lastMonth()} placeholder="YYYY-MM" onChange={e => setMonth(e.target.value)}
              className="mt-1 rounded-lg px-3 py-1.5 text-sm border" style={fieldStyle} />
          </div>
          <button type="submit" disabled={busy || !lenders}
            className="px-4 py-1.5 rounded-lg text-sm font-bold disabled:opacity-50" style={{ background: 'var(--bc-gold)', color: 'var(--bc-dark)' }}>
            {busy ? 'Building…' : 'Build invoice'}
          </button>
        </div>
        {lendersError && <div className="mt-3 text-sm" role="alert" style={{ color: '#c0392b' }}>{lendersError}</div>}
        {error && (
          <div className="mt-3 text-sm" role="alert" style={{ color: '#c0392b' }}>
            {error}
            {existingId && (
              <> <Link href={`/admin/fees/invoices/${existingId}`} className="underline font-semibold" style={{ color: 'var(--bc-blue)' }}>Open that invoice</Link></>
            )}
          </div>
        )}
      </form>

      {listError && <div className="px-6 py-4 text-sm" role="alert" style={{ color: '#c0392b' }}>{listError}</div>}
      {!invoices && !listError && <div className="px-6 py-6 text-sm" style={{ color: 'var(--bc-muted)' }}>Loading invoices…</div>}
      {invoices && invoices.length === 0 && (
        <div className="px-6 py-8 text-sm" style={{ color: 'var(--bc-muted)' }}>No invoices have been built yet.</div>
      )}
      {invoices && invoices.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--bc-muted)' }}>
                <th className="px-6 py-2.5">Number</th>
                <th className="px-3 py-2.5">Lender</th>
                <th className="px-3 py-2.5">Period</th>
                <th className="px-3 py-2.5 text-right">Amount due</th>
                <th className="px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5">Due date</th>
                <th className="px-6 py-2.5"><span className="sr-only">Open</span></th>
              </tr>
            </thead>
            <tbody>
              {invoices.map(inv => {
                const [text, badge] = STATUS[inv.status] ?? [inv.status, 'badge-gray']
                return (
                  <tr key={inv.id} className="border-t" style={{ borderColor: 'var(--bc-border)' }}>
                    <td className="px-6 py-2.5 whitespace-nowrap font-mono text-xs">{inv.number}</td>
                    <td className="px-3 py-2.5">{inv.lenders?.company_name ?? inv.bill_to_name ?? '—'}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{period(inv.period_start)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{usd(inv.amount_due)}</td>
                    <td className="px-3 py-2.5"><span className={`badge ${badge}`}>{text}</span></td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{inv.due_at ? longDate(inv.due_at) : '—'}</td>
                    <td className="px-6 py-2.5 text-right">
                      <Link href={`/admin/fees/invoices/${inv.id}`} className="underline whitespace-nowrap" style={{ color: 'var(--bc-blue)' }}>Open</Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
