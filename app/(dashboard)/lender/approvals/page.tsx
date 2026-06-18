'use client'

import { useState, useEffect, useCallback } from 'react'
import { formatCurrency, timeAgo } from '@/lib/utils'

type TabKey = 'submitted' | 'approved' | 'declined'

interface DrawLineItem {
  id: string
  work_completed_period: number
  materials_stored: number
  total_completed_stored: number
  percent_complete: number
  retainage_amount: number
  current_payment_due: number
  budget_line_items: { line_no: string; description: string; scheduled_value: number; trade: string | null }
}

interface LienWaiver {
  id: string
  sub_name: string
  sub_code: string | null
  waiver_type: string
  through_amount: number
  status: string
  signed_by: string | null
}

interface Draw {
  id: string
  request_number: string
  amount: number
  phase: string
  purpose: string
  description: string
  inspection_done: boolean
  lien_waiver: boolean
  submitted_at: string
  reviewed_at: string | null
  funded_at: string | null
  status: string
  escrow_txn_hash: string | null
  escrow_finish_hash: string | null
  nft_token_id: string | null
  nft_mint_hash: string | null
  projects: { name: string; loan_number: string; loan_amount: number; amount_drawn: number }
}

const XRPL_EXPLORER = 'https://testnet.xrpl.org'

export default function LenderApprovalsPage() {
  const [tab, setTab] = useState<TabKey>('submitted')
  const [draws, setDraws] = useState<Record<TabKey, Draw[]>>({ submitted: [], approved: [], declined: [] })
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [expandedDrawId, setExpandedDrawId] = useState<string | null>(null)
  const [drawLines, setDrawLines] = useState<Record<string, DrawLineItem[]>>({})
  const [drawWaivers, setDrawWaivers] = useState<Record<string, LienWaiver[]>>({})
  const [detailLoading, setDetailLoading] = useState<string | null>(null)
  const [declineModal, setDeclineModal] = useState<Draw | null>(null)
  const [declineReason, setDeclineReason] = useState('')

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    const [sub, app, dec] = await Promise.all([
      fetch('/api/draws?status=submitted').then(r => r.json()),
      fetch('/api/draws?status=approved').then(r => r.json()),
      fetch('/api/draws?status=declined').then(r => r.json()),
    ])
    setDraws({
      submitted: sub.data || [],
      approved: app.data || [],
      declined: dec.data || [],
    })
    setLoading(false)
  }

  async function toggleDrawDetail(drawId: string) {
    if (expandedDrawId === drawId) { setExpandedDrawId(null); return }
    setExpandedDrawId(drawId)
    if (drawLines[drawId]) return  // already loaded
    setDetailLoading(drawId)
    const [linesRes, waiversRes] = await Promise.all([
      fetch(`/api/draw-lines?draw_request_id=${drawId}`).then(r => r.json()),
      fetch(`/api/lien-waivers?draw_request_id=${drawId}`).then(r => r.json()),
    ])
    setDrawLines(prev => ({ ...prev, [drawId]: linesRes.data || [] }))
    setDrawWaivers(prev => ({ ...prev, [drawId]: waiversRes.data || [] }))
    setDetailLoading(null)
  }

  async function act(id: string, status: string, decline_reason?: string) {
    setActionLoading(id + status)
    setErrorMsg('')
    const res = await fetch(`/api/draws/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, ...(decline_reason ? { decline_reason } : {}) }),
    })
    const json = await res.json()
    if (res.ok) {
      setToast({ msg: status === 'approved' ? '⬡ Draw approved — XRPL record created' : `Draw ${status}`, ok: true })
      setTimeout(() => setToast(null), 4000)
      fetchAll()
    } else {
      setErrorMsg(json.error || `Request failed (${res.status})`)
    }
    setActionLoading(null)
  }

  const tabs: { key: TabKey; label: string; emptyIcon: string; emptyMsg: string }[] = [
    { key: 'submitted', label: 'Pending Review', emptyIcon: '✅', emptyMsg: 'No pending draw requests.' },
    { key: 'approved', label: 'Approved', emptyIcon: '⬡', emptyMsg: 'Approved draws will appear here with their XRPL records.' },
    { key: 'declined', label: 'Declined', emptyIcon: '—', emptyMsg: 'No declined draws.' },
  ]

  const current = draws[tab]
  const activeTab = tabs.find(t => t.key === tab)!

  return (
    <div>
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl text-sm font-bold shadow-xl"
          style={{ background: toast.ok ? 'var(--bc-gold)' : '#e74c3c', color: '#fff' }}>
          {toast.ok ? '✓' : '✗'} {toast.msg}
        </div>
      )}

      {/* Decline reason modal */}
      {declineModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => { setDeclineModal(null); setDeclineReason('') }}>
          <div className="rounded-xl border w-full max-w-md" onClick={e => e.stopPropagation()}
            style={{ background: 'var(--bc-navy)', borderColor: 'var(--bc-border)' }}>
            <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--bc-border)' }}>
              <div>
                <div className="font-bold">Decline Draw Request</div>
                <div className="text-xs mt-0.5" style={{ color: 'var(--bc-muted)' }}>
                  {declineModal.request_number} · {formatCurrency(declineModal.amount)}
                </div>
              </div>
              <button onClick={() => { setDeclineModal(null); setDeclineReason('') }}
                className="text-lg" style={{ color: 'var(--bc-muted)' }}>✕</button>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm" style={{ color: 'var(--bc-muted)' }}>
                The borrower will receive an email with this reason. Be specific — they need to know what to correct.
              </p>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--bc-muted)' }}>
                  Decline Reason *
                </label>
                <textarea
                  value={declineReason}
                  onChange={e => setDeclineReason(e.target.value)}
                  rows={3}
                  placeholder="e.g. Inspection not yet completed. Please schedule and submit inspector report before resubmitting."
                  className="w-full rounded-lg px-3 py-2.5 text-sm outline-none resize-none"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--bc-border)', color: 'var(--bc-text)' }}
                />
              </div>
              <div className="flex gap-3 pt-1">
                <button
                  onClick={async () => {
                    const reason = declineReason.trim() || 'Draw request did not meet approval requirements.'
                    setDeclineModal(null)
                    setDeclineReason('')
                    await act(declineModal.id, 'declined', reason)
                  }}
                  disabled={actionLoading === declineModal.id + 'declined'}
                  className="flex-1 py-2.5 rounded-lg text-sm font-bold"
                  style={{ background: 'rgba(231,76,60,0.15)', color: '#e74c3c', border: '1px solid rgba(231,76,60,0.3)' }}>
                  {actionLoading === declineModal.id + 'declined' ? 'Declining…' : '✗ Confirm Decline'}
                </button>
                <button onClick={() => { setDeclineModal(null); setDeclineReason('') }}
                  className="px-4 py-2.5 rounded-lg text-sm font-semibold border"
                  style={{ borderColor: 'var(--bc-border)', color: 'var(--bc-muted)' }}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="mb-6">
        <h1 className="text-2xl font-bold">Draw Requests</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--bc-muted)' }}>
          Review pending draws and track your full approval history
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex flex-wrap gap-1 mb-6 p-1 rounded-xl" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bc-border)' }}>
        {tabs.map(t => {
          const count = draws[t.key].length
          const isActive = tab === t.key
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className="px-4 py-2 rounded-lg text-sm font-semibold transition-all flex items-center gap-2"
              style={{
                background: isActive ? 'rgba(243,156,18,0.12)' : 'transparent',
                color: isActive ? 'var(--bc-gold)' : 'var(--bc-muted)',
                border: isActive ? '1px solid rgba(243,156,18,0.25)' : '1px solid transparent',
              }}>
              {t.label}
              {count > 0 && (
                <span className="text-xs px-1.5 py-0.5 rounded-full font-bold"
                  style={{
                    background: t.key === 'submitted' ? 'rgba(243,156,18,0.25)' : 'rgba(255,255,255,0.08)',
                    color: t.key === 'submitted' ? 'var(--bc-gold)' : 'var(--bc-muted)',
                  }}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {errorMsg && (
        <div className="mb-4 p-4 rounded-xl border text-sm" style={{ background: 'rgba(231,76,60,0.1)', borderColor: 'rgba(231,76,60,0.3)', color: '#e74c3c' }}>
          <strong>Error:</strong> {errorMsg}
        </div>
      )}

      {loading ? (
        <div className="p-8 text-center" style={{ color: 'var(--bc-muted)' }}>Loading…</div>
      ) : current.length === 0 ? (
        <div className="rounded-xl border p-12 text-center" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
          <div className="text-4xl mb-3">{activeTab.emptyIcon}</div>
          <p className="font-semibold mb-1">
            {tab === 'submitted' ? 'All caught up!' : tab === 'approved' ? 'No approved draws yet' : 'No declined draws'}
          </p>
          <p className="text-sm" style={{ color: 'var(--bc-muted)' }}>{activeTab.emptyMsg}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {current.map(draw => {
            const ltv = draw.projects
              ? Math.round((draw.projects.amount_drawn + draw.amount) / draw.projects.loan_amount * 100)
              : 0
            const hasXrplRecords = draw.escrow_txn_hash || draw.nft_token_id

            return (
              <div key={draw.id} className="rounded-xl border overflow-hidden" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>

                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-5 py-4 border-b" style={{ borderColor: 'var(--bc-border)' }}>
                  <div>
                    <div className="font-bold text-base">
                      {draw.request_number} — <span style={{ color: 'var(--bc-gold)' }}>{formatCurrency(draw.amount)}</span>
                    </div>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--bc-muted)' }}>
                      {draw.projects?.name} · {draw.projects?.loan_number} ·{' '}
                      {tab === 'submitted'
                        ? `Submitted ${draw.submitted_at ? timeAgo(draw.submitted_at) : 'recently'}`
                        : `Reviewed ${draw.reviewed_at ? timeAgo(draw.reviewed_at) : 'recently'}`
                      }
                    </div>
                  </div>
                  <span className={`badge self-start sm:self-auto ${tab === 'submitted' ? 'badge-yellow' : tab === 'approved' ? 'badge-green' : 'badge-red'}`}>
                    {tab === 'submitted' ? 'Awaiting Review' : tab === 'approved' ? 'Approved' : 'Declined'}
                  </span>
                </div>

                <div className="px-5 py-4">
                  {/* Draw details grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 mb-4">
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span style={{ color: 'var(--bc-muted)' }}>Phase</span>
                        <span className="font-semibold">{draw.phase || draw.purpose}</span>
                      </div>
                      <div className="flex justify-between">
                        <span style={{ color: 'var(--bc-muted)' }}>Amount</span>
                        <span className="font-bold" style={{ color: 'var(--bc-gold)' }}>{formatCurrency(draw.amount)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span style={{ color: 'var(--bc-muted)' }}>Inspection</span>
                        <span>{draw.inspection_done ? '✅ Done' : '⏳ Pending'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span style={{ color: 'var(--bc-muted)' }}>Lien Waiver</span>
                        <span>{draw.lien_waiver ? '✅ Attached' : '❌ Missing'}</span>
                      </div>
                    </div>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span style={{ color: 'var(--bc-muted)' }}>LTV After Draw</span>
                        <span className={`font-bold ${ltv > 80 ? 'text-red-400' : 'text-green-400'}`}>{ltv}%</span>
                      </div>
                      <div className="flex justify-between">
                        <span style={{ color: 'var(--bc-muted)' }}>Remaining After</span>
                        <span className="font-semibold text-green-400">
                          {draw.projects ? formatCurrency(draw.projects.loan_amount - draw.projects.amount_drawn - draw.amount) : '—'}
                        </span>
                      </div>
                      {tab === 'approved' && (
                        <div className="flex justify-between">
                          <span style={{ color: 'var(--bc-muted)' }}>Status</span>
                          <span className="text-yellow-400 font-semibold">
                            {draw.funded_at ? '✅ Funded' : '⏳ Pending release'}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* XRPL Records — shown on Approved tab */}
                  {tab === 'approved' && hasXrplRecords && (
                    <div className="rounded-lg p-3 mb-4" style={{ background: 'rgba(243,156,18,0.05)', border: '1px solid rgba(243,156,18,0.15)' }}>
                      <p className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--bc-gold)' }}>
                        ⬡ On-chain records
                      </p>
                      <div className="space-y-1.5">
                        {draw.escrow_txn_hash && (
                          <div className="flex items-center justify-between text-xs">
                            <span style={{ color: 'var(--bc-muted)' }}>Escrow transaction</span>
                            <a href={`${XRPL_EXPLORER}/transactions/${draw.escrow_txn_hash}`}
                              target="_blank" rel="noopener noreferrer"
                              className="font-mono hover:underline" style={{ color: 'var(--bc-gold)' }}>
                              {draw.escrow_txn_hash.slice(0, 10)}…{draw.escrow_txn_hash.slice(-6)} ↗
                            </a>
                          </div>
                        )}
                        {draw.nft_token_id && (
                          <div className="flex items-center justify-between text-xs">
                            <span style={{ color: 'var(--bc-muted)' }}>Approval NFT</span>
                            <a href={`${XRPL_EXPLORER}/nft/${draw.nft_token_id}`}
                              target="_blank" rel="noopener noreferrer"
                              className="font-mono hover:underline" style={{ color: 'var(--bc-gold)' }}>
                              {draw.nft_token_id.slice(0, 10)}…{draw.nft_token_id.slice(-6)} ↗
                            </a>
                          </div>
                        )}
                        {draw.escrow_finish_hash && (
                          <div className="flex items-center justify-between text-xs">
                            <span style={{ color: 'var(--bc-muted)' }}>Release transaction</span>
                            <a href={`${XRPL_EXPLORER}/transactions/${draw.escrow_finish_hash}`}
                              target="_blank" rel="noopener noreferrer"
                              className="font-mono hover:underline" style={{ color: '#4ade80' }}>
                              {draw.escrow_finish_hash.slice(0, 10)}…{draw.escrow_finish_hash.slice(-6)} ↗
                            </a>
                          </div>
                        )}
                        {!draw.escrow_txn_hash && !draw.nft_token_id && (
                          <p className="text-xs" style={{ color: 'var(--bc-muted)' }}>
                            XRPL integration pending configuration
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Description */}
                  {draw.description && (
                    <div className="text-sm p-3 rounded-lg mb-4" style={{ background: 'rgba(255,255,255,0.03)', color: 'var(--bc-muted)' }}>
                      &ldquo;{draw.description}&rdquo;
                    </div>
                  )}

                  {/* G703 / Lien Waiver detail toggle */}
                  <div className="mb-4">
                    <button onClick={() => toggleDrawDetail(draw.id)}
                      className="text-xs font-semibold flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all"
                      style={{ background: 'rgba(255,255,255,0.04)', color: 'var(--bc-muted)', border: '1px solid var(--bc-border)' }}>
                      {expandedDrawId === draw.id ? '▲' : '▼'} G703 Line Items &amp; Lien Waivers
                    </button>

                    {expandedDrawId === draw.id && (
                      <div className="mt-3 rounded-xl border overflow-hidden" style={{ borderColor: 'var(--bc-border)' }}>
                        {detailLoading === draw.id ? (
                          <div className="p-4 text-xs text-center" style={{ color: 'var(--bc-muted)' }}>Loading…</div>
                        ) : (
                          <>
                            {/* G703 Line Items */}
                            {drawLines[draw.id]?.length > 0 ? (
                              <div className="overflow-x-auto">
                                <table className="w-full text-xs">
                                  <thead style={{ background: 'rgba(255,255,255,0.03)' }}>
                                    <tr style={{ borderBottom: '1px solid var(--bc-border)', color: 'var(--bc-muted)' }}>
                                      <th className="text-left px-4 py-2 font-semibold">#</th>
                                      <th className="text-left px-2 py-2 font-semibold">Description</th>
                                      <th className="text-right px-2 py-2 font-semibold">Scheduled</th>
                                      <th className="text-right px-2 py-2 font-semibold">This Period</th>
                                      <th className="text-right px-2 py-2 font-semibold">% Done</th>
                                      <th className="text-right px-4 py-2 font-semibold">Net Due</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {drawLines[draw.id].map(dl => (
                                      <tr key={dl.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                                        <td className="px-4 py-2 font-mono" style={{ color: 'var(--bc-muted)' }}>{dl.budget_line_items.line_no}</td>
                                        <td className="px-2 py-2">{dl.budget_line_items.description}</td>
                                        <td className="px-2 py-2 text-right" style={{ color: 'var(--bc-muted)' }}>{formatCurrency(dl.budget_line_items.scheduled_value)}</td>
                                        <td className="px-2 py-2 text-right font-semibold" style={{ color: 'var(--bc-gold)' }}>{formatCurrency(dl.work_completed_period)}</td>
                                        <td className="px-2 py-2 text-right" style={{ color: dl.percent_complete >= 100 ? '#2ecc71' : 'var(--bc-muted)' }}>{dl.percent_complete.toFixed(1)}%</td>
                                        <td className="px-4 py-2 text-right font-bold">{formatCurrency(dl.current_payment_due)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                  <tfoot style={{ background: 'rgba(255,255,255,0.03)', borderTop: '1px solid var(--bc-border)' }}>
                                    <tr>
                                      <td colSpan={3} className="px-4 py-2 font-bold" style={{ color: 'var(--bc-muted)' }}>TOTALS</td>
                                      <td className="px-2 py-2 text-right font-bold" style={{ color: 'var(--bc-gold)' }}>
                                        {formatCurrency(drawLines[draw.id].reduce((s, l) => s + l.work_completed_period, 0))}
                                      </td>
                                      <td />
                                      <td className="px-4 py-2 text-right font-bold" style={{ color: '#e8edf2' }}>
                                        {formatCurrency(drawLines[draw.id].reduce((s, l) => s + l.current_payment_due, 0))}
                                      </td>
                                    </tr>
                                  </tfoot>
                                </table>
                              </div>
                            ) : (
                              <div className="px-4 py-3 text-xs" style={{ color: 'var(--bc-muted)' }}>No G703 line items — single-amount draw.</div>
                            )}

                            {/* Lien Waivers */}
                            <div className="border-t px-4 py-3" style={{ borderColor: 'var(--bc-border)' }}>
                              <p className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--bc-muted)' }}>Lien Waivers</p>
                              {drawWaivers[draw.id]?.length > 0 ? (
                                <div className="space-y-1.5">
                                  {drawWaivers[draw.id].map(wv => (
                                    <div key={wv.id} className="flex items-center justify-between text-xs py-1">
                                      <div>
                                        <span className="font-semibold">{wv.sub_name}</span>
                                        {wv.sub_code && <span className="ml-1.5" style={{ color: 'var(--bc-muted)' }}>{wv.sub_code}</span>}
                                        <span className="ml-2 px-1.5 py-0.5 rounded text-xs" style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--bc-muted)' }}>
                                          {wv.waiver_type.replace(/_/g, ' ')}
                                        </span>
                                      </div>
                                      <div className="flex items-center gap-3">
                                        <span style={{ color: 'var(--bc-muted)' }}>{formatCurrency(wv.through_amount)}</span>
                                        <span style={{ color: wv.status === 'signed' || wv.status === 'issued' ? '#2ecc71' : '#e74c3c' }}>
                                          {wv.status === 'signed' || wv.status === 'issued' ? '✅ Signed' : '⏳ Pending'}
                                        </span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-xs" style={{ color: '#e74c3c' }}>⚠️ No lien waivers on file — required before approval.</p>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Pending action buttons */}
                  {tab === 'submitted' && (() => {
                    const waivers = drawWaivers[draw.id] || []
                    const allWaiversSigned = waivers.length > 0 && waivers.every(w => w.status === 'signed' || w.status === 'issued')
                    const blockApprove = !draw.inspection_done || !draw.lien_waiver
                    return (
                    <div className="space-y-3">
                      {blockApprove && (
                        <div className="flex gap-3 text-xs px-3 py-2 rounded-lg" style={{ background: 'rgba(231,76,60,0.08)', border: '1px solid rgba(231,76,60,0.2)' }}>
                          {!draw.inspection_done && <span style={{ color: '#e74c3c' }}>⚠️ Inspection not confirmed</span>}
                          {!draw.lien_waiver && <span style={{ color: '#e74c3c' }}>⚠️ Lien waiver missing</span>}
                          <span style={{ color: 'var(--bc-muted)' }}>— You can still approve with override</span>
                        </div>
                      )}
                      <div className="flex flex-wrap gap-3 items-center">
                        <button onClick={() => act(draw.id, 'approved')}
                          disabled={actionLoading === draw.id + 'approved'}
                          className="px-5 py-2 rounded-lg text-sm font-bold transition-all"
                          style={{ background: blockApprove ? 'rgba(201,168,76,0.4)' : 'var(--bc-gold)', color: 'var(--bc-dark)', opacity: actionLoading ? 0.7 : 1 }}>
                          {actionLoading === draw.id + 'approved' ? '⬡ Creating XRPL record…' : '⬡ Approve & Create XRPL Record'}
                        </button>
                        <button onClick={() => { setDeclineModal(draw); setDeclineReason('') }}
                          disabled={!!actionLoading}
                          className="px-4 py-2 rounded-lg text-sm font-bold border transition-all"
                          style={{ background: 'rgba(231,76,60,0.1)', color: '#e74c3c', borderColor: 'rgba(231,76,60,0.3)' }}>
                          ✗ Decline
                        </button>
                        <span className="text-xs" style={{ color: 'var(--bc-muted)' }}>
                          Admin releases funds after escrow review
                        </span>
                      </div>
                    </div>
                    )
                  })()}

                  {/* Approved status footer */}
                  {tab === 'approved' && !draw.funded_at && (
                    <div className="flex items-center gap-2 text-xs pt-1" style={{ color: 'var(--bc-muted)' }}>
                      <span className="inline-block w-2 h-2 rounded-full" style={{ background: 'var(--bc-gold)' }}></span>
                      Approved — admin release pending in Draws dashboard
                    </div>
                  )}

                  {tab === 'approved' && draw.funded_at && (
                    <div className="flex items-center gap-2 text-xs pt-1" style={{ color: '#4ade80' }}>
                      <span className="inline-block w-2 h-2 rounded-full" style={{ background: '#4ade80' }}></span>
                      Funded {timeAgo(draw.funded_at)}
                    </div>
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
