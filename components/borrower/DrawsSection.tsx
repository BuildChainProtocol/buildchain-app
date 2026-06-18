'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { formatCurrency } from '@/lib/utils'

interface Draw {
  id: string
  request_number: string
  amount: number
  net_amount: number | null
  retainage_held: number | null
  retainage_rate: number | null
  phase: string | null
  purpose: string | null
  description: string | null
  status: string
  decline_reason: string | null
  submitted_at: string | null
  inspection_done: boolean
  lien_waiver: boolean
  projects: {
    name: string
    loan_number: string | null
  } | null
}

// Status values must match the draw_requests.status CHECK constraint in the DB:
// ('draft','submitted','pending','approved','funded','declined')
// 'pending' and 'submitted' are both shown as "Submitted" to the borrower.
const STATUS: Record<string, { label: string; color: string; bg: string; step: number }> = {
  draft:     { label: 'Draft',      color: '#6b8198',  bg: 'rgba(107,129,152,0.12)', step: 0 },
  pending:   { label: 'Submitted',  color: '#f39c12',  bg: 'rgba(243,156,18,0.12)',  step: 1 },
  submitted: { label: 'Submitted',  color: '#f39c12',  bg: 'rgba(243,156,18,0.12)',  step: 1 },
  approved:  { label: 'Approved',   color: '#2ecc71',  bg: 'rgba(46,204,113,0.12)',  step: 2 },
  funded:    { label: 'Funded',     color: '#27ae60',  bg: 'rgba(39,174,96,0.18)',   step: 3 },
  declined:  { label: 'Declined',   color: '#e74c3c',  bg: 'rgba(231,76,60,0.12)',   step: -1 },
}

// 3-step real pipeline: Submitted (step 1) → Approved (step 2) → Funded (step 3)
const PIPELINE = ['Submitted', 'Approved', 'Funded']
const FILTERS  = ['All', 'Submitted', 'Approved', 'Funded', 'Declined']
const POLL_MS  = 30_000

export default function BorrowerDrawsSection() {
  const [draws, setDraws]         = useState<Draw[]>([])
  const [loading, setLoading]     = useState(true)
  const [filter, setFilter]       = useState('All')
  const [lastAt, setLastAt]       = useState<Date | null>(null)
  const [refreshing, setRefresh]  = useState(false)
  const timerRef                  = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchDraws = useCallback(async (silent = false) => {
    if (!silent) setRefresh(true)
    try {
      const res  = await fetch('/api/draws?mine=true', { cache: 'no-store' })
      const json = await res.json()
      if (json.data) { setDraws(json.data); setLastAt(new Date()) }
    } finally {
      setLoading(false)
      setRefresh(false)
    }
  }, [])

  useEffect(() => {
    fetchDraws()
    timerRef.current = setInterval(() => fetchDraws(true), POLL_MS)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [fetchDraws])

  const counts = FILTERS.reduce<Record<string, number>>((acc, tab) => {
    acc[tab] = tab === 'All'
      ? draws.length
      : draws.filter(d => STATUS[d.status]?.label === tab).length
    return acc
  }, {})

  const filtered = filter === 'All'
    ? draws
    : draws.filter(d => STATUS[d.status]?.label === filter)

  const activeTabs = FILTERS.filter(t => t === 'All' || counts[t] > 0)

  return (
    <div className="mt-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold">Draw Requests</h2>
          <div className="flex items-center gap-2 mt-0.5">
            {/* Live pulse */}
            <span className="flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-50"
                  style={{ background: '#2ecc71' }} />
                <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: '#2ecc71' }} />
              </span>
              <span className="text-xs" style={{ color: 'var(--bc-muted)' }}>
                {refreshing ? 'Updating…' : lastAt
                  ? `Live · updated ${lastAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
                  : 'Live'}
              </span>
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchDraws()}
            disabled={refreshing}
            className="text-xs px-2.5 py-1.5 rounded-lg border transition-colors disabled:opacity-40"
            style={{ borderColor: 'var(--bc-border)', color: 'var(--bc-muted)' }}>
            ↻ Refresh
          </button>
          <Link href="/borrower/draw"
            className="text-xs font-bold px-3 py-1.5 rounded-lg"
            style={{ background: 'var(--bc-gold)', color: 'var(--bc-dark)' }}>
            + New Draw
          </Link>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex overflow-x-auto scrollbar-none gap-1 mb-4 pb-0.5">
        {activeTabs.map(tab => (
          <button key={tab}
            onClick={() => setFilter(tab)}
            className="flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
            style={{
              background: filter === tab ? 'var(--bc-gold)' : 'rgba(255,255,255,0.05)',
              color: filter === tab ? 'var(--bc-dark)' : 'var(--bc-muted)',
            }}>
            {tab}
            {counts[tab] > 0 && (
              <span className="ml-1.5 text-xs opacity-70">{counts[tab]}</span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className="rounded-xl border p-10 text-center text-sm"
          style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)', color: 'var(--bc-muted)' }}>
          Loading draw requests…
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border p-10 text-center"
          style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
          <div className="text-3xl mb-2">📋</div>
          <p className="font-semibold mb-1">No draw requests yet</p>
          <p className="text-sm" style={{ color: 'var(--bc-muted)' }}>
            Submit your first draw request once your project is active.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(draw => {
            const cfg         = STATUS[draw.status] ?? STATUS.submitted
            const step        = cfg.step
            const isDeclined  = draw.status === 'declined'
            const isDraft     = draw.status === 'draft'
            const showPipeline = !isDeclined && !isDraft && step > 0
            const displayAmt  = draw.net_amount ?? draw.amount

            return (
              <div key={draw.id}
                className="rounded-xl border p-4 transition-colors"
                style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>

                {/* Top row: draw info + amount */}
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <span className="font-bold text-sm">Draw #{draw.request_number}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
                        style={{ background: cfg.bg, color: cfg.color }}>
                        {cfg.label}
                      </span>
                    </div>
                    <div className="text-xs truncate" style={{ color: 'var(--bc-muted)' }}>
                      {draw.projects?.name}
                      {draw.projects?.loan_number ? ` · ${draw.projects.loan_number}` : ''}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="font-bold" style={{ color: 'var(--bc-gold)' }}>
                      {formatCurrency(displayAmt)}
                    </div>
                    {draw.retainage_held ? (
                      <div className="text-xs mt-0.5" style={{ color: 'var(--bc-muted)' }}>
                        +{formatCurrency(draw.retainage_held)} held
                      </div>
                    ) : null}
                  </div>
                </div>

                {/* Status pipeline */}
                {showPipeline && (
                  <div className="flex items-start mb-3">
                    {PIPELINE.map((label, i) => {
                      const isDone   = step > i + 1
                      const isActive = step === i + 1
                      const dotColor = isDone || isActive ? cfg.color : 'rgba(255,255,255,0.12)'
                      const lineColor = isDone ? cfg.color : 'rgba(255,255,255,0.1)'
                      return (
                        <div key={label} className="flex items-center" style={{ flex: i < PIPELINE.length - 1 ? '1 1 0' : 'none' }}>
                          <div className="flex flex-col items-center" style={{ minWidth: 0 }}>
                            <div className="w-2.5 h-2.5 rounded-full flex-shrink-0 border-2 transition-colors"
                              style={{
                                borderColor: dotColor,
                                background: isDone || isActive ? dotColor : 'var(--bc-navy)',
                              }} />
                            <span className="mt-1 text-center leading-tight"
                              style={{
                                fontSize: 9,
                                color: isActive ? cfg.color : isDone ? '#8ea5b8' : 'rgba(255,255,255,0.2)',
                                fontWeight: isActive ? 700 : 400,
                                whiteSpace: 'nowrap',
                              }}>
                              {label}
                            </span>
                          </div>
                          {i < PIPELINE.length - 1 && (
                            <div className="flex-1 h-px mx-1.5" style={{ background: lineColor, marginTop: '-10px' }} />
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Draft banner */}
                {isDraft && (
                  <div className="mb-3 px-3 py-2 rounded-lg text-xs font-medium"
                    style={{ background: 'rgba(107,129,152,0.08)', color: '#6b8198', border: '1px solid rgba(107,129,152,0.2)' }}>
                    📝 Saved as draft — not yet submitted to your lender.
                  </div>
                )}

                {/* Declined banner */}
                {isDeclined && (
                  <div className="mb-3 px-3 py-2 rounded-lg text-xs font-medium"
                    style={{ background: 'rgba(231,76,60,0.08)', color: '#e74c3c', border: '1px solid rgba(231,76,60,0.2)' }}>
                    ❌{' '}
                    {draw.decline_reason
                      ? <><span className="opacity-70">Not approved — </span>{draw.decline_reason}</>
                      : 'This draw request was not approved. Contact your lender for details.'
                    }
                  </div>
                )}

                {/* Meta row */}
                <div className="flex items-center gap-3 flex-wrap" style={{ color: 'var(--bc-muted)', fontSize: 11 }}>
                  {draw.phase && <span>📍 {draw.phase}</span>}
                  {draw.submitted_at && (
                    <span>
                      📅 {new Date(draw.submitted_at).toLocaleDateString('en-US', {
                        month: 'short', day: 'numeric', year: 'numeric',
                      })}
                    </span>
                  )}
                  {draw.inspection_done && (
                    <span style={{ color: '#2ecc71' }}>✓ Inspection</span>
                  )}
                  {draw.lien_waiver && (
                    <span style={{ color: '#2ecc71' }}>✓ Lien waivers</span>
                  )}
                  {draw.retainage_rate != null && (
                    <span>{Math.round(draw.retainage_rate * 100)}% retainage</span>
                  )}
                </div>

              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
