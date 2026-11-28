'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

interface Invoice {
  id: string
  number: string
  period_start: string
  amount_due: number
  status: string
  due_at: string | null
}

const usd = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n))
const longDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
/** "2026-11-01" is a calendar date, not a moment: read it in UTC so it never slips a month. */
const period = (day: string) => new Date(`${day.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })

const STATUS: Record<string, [string, string]> = {
  draft: ['Draft', 'badge-gray'], sent: ['Due', 'badge-gold'], paid: ['Paid', 'badge-green'], void: ['Void', 'badge-gray'],
}

/** The lender's own fee invoices. Shows nothing until there is one. */
export default function LenderInvoices() {
  const [invoices, setInvoices] = useState<Invoice[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    fetch('/api/fees/invoices').then(async r => {
      const json = await r.json().catch(() => ({}))
      if (!live) return
      if (r.ok) setInvoices(json.invoices ?? []); else setError(json.error || `Your invoices could not be loaded (${r.status})`)
    }).catch(() => { if (live) setError('Your invoices could not be loaded. Check your connection and reload the page.') })
    return () => { live = false }
  }, [])

  if (error) {
    return (
      <div className="rounded-lg border px-4 py-3 mb-5 text-sm" style={{ borderColor: 'rgba(192,57,43,0.3)', background: 'rgba(192,57,43,0.06)', color: '#c0392b' }}>
        {error}
      </div>
    )
  }
  if (!invoices || invoices.length === 0) return null

  return (
    <div className="rounded-lg border mb-5" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
      <div className="px-6 py-4 border-b" style={{ borderColor: 'var(--bc-border)' }}>
        <h3 className="uppercase">Invoices</h3>
        <div className="mt-1 text-sm" style={{ color: 'var(--bc-muted)' }}>
          Protocol fees are invoiced monthly, after the month ends. Nothing is charged from this page.
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--bc-muted)' }}>
              <th className="px-6 py-2.5">Number</th>
              <th className="px-3 py-2.5">Period</th>
              <th className="px-3 py-2.5 text-right">Amount due</th>
              <th className="px-3 py-2.5">Due date</th>
              <th className="px-3 py-2.5">Status</th>
              <th className="px-6 py-2.5"><span className="sr-only">Open</span></th>
            </tr>
          </thead>
          <tbody>
            {invoices.map(inv => {
              const [text, badge] = STATUS[inv.status] ?? [inv.status, 'badge-gray']
              return (
                <tr key={inv.id} className="border-t" style={{ borderColor: 'var(--bc-border)' }}>
                  <td className="px-6 py-2.5 whitespace-nowrap font-mono text-xs">{inv.number}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">{period(inv.period_start)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{usd(inv.amount_due)}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">{inv.due_at ? longDate(inv.due_at) : '—'}</td>
                  <td className="px-3 py-2.5"><span className={`badge ${badge}`}>{text}</span></td>
                  <td className="px-6 py-2.5 text-right">
                    <Link href={`/lender/invoices/${inv.id}`} className="underline whitespace-nowrap" style={{ color: 'var(--bc-blue)' }}>View</Link>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
