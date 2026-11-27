'use client'

import { useEffect, useState } from 'react'

interface Line {
  id: string
  released_at: string
  release_amount: number
  rate_bps: number
  fee_amount: number
  waived: boolean
  waiver_reason: string | null
  network: string | null
  projects: { name: string; loan_number: string | null } | null
  lenders: { company_name: string } | null
  draw_requests: { request_number: string } | null
}
interface Statement {
  month: string
  rateBps: number
  lines: Line[]
  totals: { released: number; fees: number; waived: number; due: number }
}

const usd = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n))
const thisMonth = () => { const d = new Date(); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}` }

/** The protocol fee statement for a month: one line per released draw. A record; nothing is charged from here. */
export default function FeeStatement({ showLender = false }: { showLender?: boolean }) {
  const [month, setMonth] = useState(thisMonth())
  const [data, setData] = useState<Statement | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    setData(null); setError('')
    fetch(`/api/fees?month=${month}`).then(async r => {
      const json = await r.json().catch(() => ({}))
      if (!live) return
      if (r.ok) setData(json); else setError(json.error || 'The statement could not be loaded')
    })
    return () => { live = false }
  }, [month])

  const rate = data ? `${(data.rateBps / 100).toFixed(2)}%` : ''
  return (
    <div className="rounded-lg border" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
      <div className="px-6 py-4 border-b flex flex-wrap items-center justify-between gap-3" style={{ borderColor: 'var(--bc-border)' }}>
        <div>
          <h3 className="uppercase">Protocol fee statement</h3>
          <div className="mt-1 text-sm" style={{ color: 'var(--bc-muted)' }}>
            {rate && `${rate} of each draw released. `}A record of fees; nothing is charged from this page.
          </div>
        </div>
        <input type="month" value={month} onChange={e => e.target.value && setMonth(e.target.value)} aria-label="Statement month"
          className="rounded-lg px-3 py-1.5 text-sm border" style={{ borderColor: 'var(--bc-border)', background: 'var(--bc-card)' }} />
      </div>

      {error && <div className="px-6 py-4 text-sm" style={{ color: '#c0392b' }}>{error}</div>}
      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 border-b" style={{ borderColor: 'var(--bc-border)' }}>
            {[
              ['Released', usd(data.totals.released)],
              ['Fees at ' + rate, usd(data.totals.fees)],
              ['Waived', usd(data.totals.waived)],
              ['Due', usd(data.totals.due)],
            ].map(([label, value]) => (
              <div key={label} className="px-6 py-4">
                <div className="bc-figure text-[22px] tabular-nums">{value}</div>
                <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--bc-muted)' }}>{label}</div>
              </div>
            ))}
          </div>
          {data.lines.length === 0 ? (
            <div className="px-6 py-8 text-sm" style={{ color: 'var(--bc-muted)' }}>No draws were released in this month.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--bc-muted)' }}>
                    <th className="px-6 py-2.5">Released</th>
                    <th className="px-3 py-2.5">Loan</th>
                    {showLender && <th className="px-3 py-2.5">Lender</th>}
                    <th className="px-3 py-2.5">Draw</th>
                    <th className="px-3 py-2.5 text-right">Amount</th>
                    <th className="px-3 py-2.5 text-right">Fee</th>
                    <th className="px-6 py-2.5">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.lines.map(l => (
                    <tr key={l.id} className="border-t" style={{ borderColor: 'var(--bc-border)' }}>
                      <td className="px-6 py-2.5 whitespace-nowrap">{new Date(l.released_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                      <td className="px-3 py-2.5">{l.projects?.name ?? '—'}</td>
                      {showLender && <td className="px-3 py-2.5">{l.lenders?.company_name ?? '—'}</td>}
                      <td className="px-3 py-2.5">{l.draw_requests?.request_number ?? '—'}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{usd(l.release_amount)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{usd(l.fee_amount)}</td>
                      <td className="px-6 py-2.5">
                        {l.waived
                          ? <span className="badge badge-gray" title={l.waiver_reason ?? ''}>Waived</span>
                          : <span className="badge badge-gold">Due</span>}
                        {l.waived && l.waiver_reason && <span className="ml-2 text-xs" style={{ color: 'var(--bc-muted)' }}>{l.waiver_reason}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
