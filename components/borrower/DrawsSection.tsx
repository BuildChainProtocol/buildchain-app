'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { formatCurrency } from '@/lib/utils'

interface VerificationReceipt {
  verified_at: string
  inspector_credential_nft: string | null
  lien_waiver_nft: string | null
  escrow_finish_hash: string | null
  trigger: string
  patent_ref: string
}

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
  hold_reason: string | null
  submitted_at: string | null
  funded_at: string | null
  // Set when an inspection passes
  inspection_done: boolean
  // The contractor's own statement that its lien waivers are signed.
  // It is not the lender's confirmation: that is lien_waiver_nft_id.
  lien_waiver: boolean
  // Present once the lender has confirmed the waivers and the ledger record exists
  lien_waiver_nft_id: string | null
  lien_waiver_nft_minted_at: string | null
  escrow_txn_hash: string | null
  escrow_finish_hash: string | null
  verification_receipt: VerificationReceipt | null
  projects: {
    name: string
    loan_number: string | null
  } | null
}

function timeAgo(iso: string): string {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (secs < 60)   return 'just now'
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  return `${Math.floor(secs / 86400)}d ago`
}

// Status values must match the draw_requests.status CHECK constraint in the DB:
// ('draft','submitted','pending','approved','held','funded','declined', ...)
// 'pending' and 'submitted' are both shown as "Submitted" to the borrower.
// A held draw is still with the lender (step 1) but is shown as "On hold".
const STATUS: Record<string, { label: string; color: string; bg: string; step: number }> = {
  draft:     { label: 'Draft',      color: 'var(--bc-muted)',  bg: 'rgba(107,129,152,0.12)', step: 0 },
  pending:   { label: 'Submitted',  color: '#b45309',  bg: 'rgba(243,156,18,0.12)',  step: 1 },
  submitted: { label: 'Submitted',  color: '#b45309',  bg: 'rgba(243,156,18,0.12)',  step: 1 },
  held:      { label: 'On hold',    color: '#b45309',  bg: 'rgba(107,129,152,0.14)', step: 1 },
  approved:  { label: 'Approved',   color: '#15803d',  bg: 'rgba(46,204,113,0.12)',  step: 2 },
  funded:    { label: 'Funded',     color: '#15803d',  bg: 'rgba(39,174,96,0.18)',   step: 3 },
  declined:  { label: 'Declined',   color: '#c0392b',  bg: 'rgba(231,76,60,0.12)',   step: -1 },
}

// 3-step real pipeline: Submitted (step 1) → Approved (step 2) → Funded (step 3)
const PIPELINE = ['Submitted', 'Approved', 'Funded']
const FILTERS  = ['All', 'Submitted', 'On hold', 'Approved', 'Funded', 'Declined']
const POLL_MS  = 30_000
// The pilot runs on the XRP Ledger test network. Every explorer link in this file starts here.
const XRPL_EXPLORER = 'https://testnet.xrpl.org'

export default function BorrowerDrawsSection() {
  const [draws, setDraws]         = useState<Draw[]>([])
  const [loading, setLoading]     = useState(true)
  const [filter, setFilter]       = useState('All')
  const [lastAt, setLastAt]       = useState<Date | null>(null)
  const [refreshing, setRefresh]  = useState(false)
  const [loadError, setLoadError] = useState('')
  const timerRef                  = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchDraws = useCallback(async (silent = false) => {
    if (!silent) setRefresh(true)
    try {
      const res  = await fetch('/api/draws?mine=true', { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (res.ok && json.data) { setDraws(json.data); setLastAt(new Date()); setLoadError('') }
      else setLoadError(json.error || `Your draws could not be loaded (${res.status})`)
    } catch {
      setLoadError('Your draws could not be loaded: the server could not be reached')
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
                  style={{ background: '#15803d' }} />
                <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: '#15803d' }} />
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
              background: filter === tab ? 'var(--bc-gold)' : 'rgba(13,27,42,0.05)',
              color: filter === tab ? 'var(--bc-dark)' : 'var(--bc-muted)',
            }}>
            {tab}
            {counts[tab] > 0 && (
              <span className="ml-1.5 text-xs opacity-70">{counts[tab]}</span>
            )}
          </button>
        ))}
      </div>

      {loadError && (
        <div role="alert" className="rounded-xl border p-3 mb-4 text-sm"
          style={{ background: 'rgba(231,76,60,0.08)', borderColor: 'rgba(231,76,60,0.3)', color: '#c0392b' }}>
          {loadError}
        </div>
      )}

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
            const isHeld      = draw.status === 'held'
            const showPipeline = !isDeclined && !isDraft && step > 0
            const waiverRecorded = !!draw.lien_waiver_nft_id
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
                    <div className="font-bold" style={{ color: 'var(--bc-gold-ink)' }}>
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
                      const dotColor = isDone || isActive ? cfg.color : 'rgba(13,27,42,0.12)'
                      const lineColor = isDone ? cfg.color : 'rgba(13,27,42,0.1)'
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
                                color: isActive ? cfg.color : isDone ? 'var(--bc-muted)' : 'rgba(13,27,42,0.2)',
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
                    style={{ background: 'rgba(107,129,152,0.08)', color: 'var(--bc-muted)', border: '1px solid rgba(107,129,152,0.2)' }}>
                    📝 Saved as draft — not yet submitted to your lender.
                  </div>
                )}

                {/* On hold banner */}
                {isHeld && (
                  <div className="mb-3 px-3 py-2 rounded-lg text-xs font-medium"
                    style={{ background: 'rgba(243,156,18,0.08)', color: '#b45309', border: '1px solid rgba(243,156,18,0.25)' }}>
                    {draw.hold_reason
                      ? <><span className="opacity-70">Your lender put this draw on hold: </span>{draw.hold_reason}</>
                      : 'Your lender put this draw on hold and gave no reason. Contact your lender for details.'}
                  </div>
                )}

                {/* Declined banner */}
                {isDeclined && (
                  <div className="mb-3 px-3 py-2 rounded-lg text-xs font-medium"
                    style={{ background: 'rgba(231,76,60,0.08)', color: '#c0392b', border: '1px solid rgba(231,76,60,0.2)' }}>
                    ❌{' '}
                    {draw.decline_reason
                      ? <><span className="opacity-70">Not approved — </span>{draw.decline_reason}</>
                      : 'This draw request was not approved. Contact your lender for details.'
                    }
                  </div>
                )}

                {/* Meta row */}
                <div className="flex items-center gap-3 flex-wrap mb-3" style={{ color: 'var(--bc-muted)', fontSize: 11 }}>
                  {draw.phase && <span>📍 {draw.phase}</span>}
                  {draw.submitted_at && (
                    <span>
                      📅 {new Date(draw.submitted_at).toLocaleDateString('en-US', {
                        month: 'short', day: 'numeric', year: 'numeric',
                      })}
                    </span>
                  )}
                  {draw.retainage_rate != null && (
                    <span>{Math.round(draw.retainage_rate * 100)}% retainage</span>
                  )}
                </div>

                {/* XRPL Dual-Condition Panel — shown on approved draws */}
                {draw.status === 'approved' && (
                  <div className="rounded-lg border p-3"
                    style={{ background: 'rgba(45,125,210,0.04)', borderColor: 'rgba(45,125,210,0.2)' }}>
                    <div className="text-xs font-bold mb-2" style={{ color: 'var(--bc-blue)' }}>
                      Release conditions (patent pending)
                    </div>
                    <div className="space-y-1.5">
                      {/* Condition 1: inspection */}
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span style={{ color: 'var(--bc-muted)' }}>1. Inspection</span>
                        {draw.inspection_done ? (
                          <span style={{ color: '#15803d' }}>Passed</span>
                        ) : (
                          <span style={{ color: 'var(--bc-muted)' }}>Not yet passed</span>
                        )}
                      </div>
                      {/* Condition 2: the lender's confirmation of the lien waivers */}
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span style={{ color: 'var(--bc-muted)' }}>2. Lien waivers</span>
                        {waiverRecorded ? (
                          <span style={{ color: '#15803d' }}>Confirmed by your lender and recorded</span>
                        ) : draw.lien_waiver ? (
                          <span className="text-right" style={{ color: '#b45309' }}>Reported signed; waiting for your lender to confirm</span>
                        ) : (
                          <span className="text-right" style={{ color: 'var(--bc-muted)' }}>Not confirmed by your lender</span>
                        )}
                      </div>
                    </div>
                    {draw.inspection_done && waiverRecorded ? (
                      <div className="mt-2 text-xs font-semibold" style={{ color: '#15803d' }}>
                        Both conditions are recorded. Processing release.
                      </div>
                    ) : (
                      <div className="mt-2 text-xs" style={{ color: 'var(--bc-muted)' }}>
                        The draw is released once the inspection has passed and your lender has confirmed the lien waivers.
                      </div>
                    )}
                    {draw.escrow_txn_hash && (
                      <div className="mt-2 text-xs" style={{ color: 'var(--bc-muted)' }}>
                        Escrow:{' '}
                        <a
                          href={`${XRPL_EXPLORER}/transactions/${draw.escrow_txn_hash}`}
                          target="_blank" rel="noopener noreferrer"
                          className="font-mono" style={{ color: 'var(--bc-blue)' }}>
                          {draw.escrow_txn_hash.slice(0, 10)}…
                        </a>
                      </div>
                    )}
                  </div>
                )}

                {/* Funded: show auto-release badge or plain funded line */}
                {draw.status === 'funded' && (
                  <div className="mt-1">
                    {draw.verification_receipt ? (
                      <div className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-semibold"
                        style={{ background: 'rgba(46,204,113,0.12)', color: '#15803d', border: '1px solid rgba(46,204,113,0.25)' }}>
                        ⬡ Dual-condition auto-released
                        {draw.funded_at ? ` · ${timeAgo(draw.funded_at)}` : ''}
                      </div>
                    ) : (
                      <div className="text-xs" style={{ color: 'var(--bc-muted)' }}>
                        Funded{draw.funded_at ? ` · ${timeAgo(draw.funded_at)}` : ''}
                      </div>
                    )}
                  </div>
                )}

              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
