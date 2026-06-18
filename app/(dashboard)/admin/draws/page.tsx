'use client'

import { useState, useEffect } from 'react'
import { formatCurrency, timeAgo } from '@/lib/utils'
import type { DrawRequest } from '@/lib/types/database'

type XrplDraw = DrawRequest & {
  escrow_sequence: number | null
  escrow_txn_hash: string | null
  escrow_finish_hash: string | null
  escrow_finish_after: string | null
  // Migration 012 — on-ledger NFT evidence (Patent §IV + §V)
  lien_waiver_nft_id: string | null
  lien_waiver_nft_minted_at: string | null
  verification_receipt: {
    verified_at: string
    inspector_credential_nft: string | null
    lien_waiver_nft: string | null
    escrow_finish_hash: string | null
    trigger: string
    patent_ref: string
  } | null
}

type DrawWithProject = XrplDraw & {
  projects: { id: string; name: string; loan_number: string; loan_amount: number; amount_drawn: number }
}

interface Inspection {
  id: string
  status: 'pending' | 'passed' | 'failed' | 'cancelled'
  inspector_name: string
  inspector_email: string
  scheduled_date: string | null
  submitted_at: string | null
  notes: string | null
  token: string
}

const TESTNET_EXPLORER = 'https://testnet.xrpl.org/transactions'
const BASE_URL = typeof window !== 'undefined' ? window.location.origin : 'https://www.buildchain.finance'

export default function AdminDrawsPage() {
  const [draws, setDraws] = useState<DrawWithProject[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('submitted')
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [lienWaiverLoading, setLienWaiverLoading] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  const [errorModal, setErrorModal] = useState<string | null>(null)

  // Inspection state
  const [inspections, setInspections] = useState<Record<string, Inspection[]>>({})
  const [inspectModal, setInspectModal] = useState<DrawWithProject | null>(null)
  const [inspectForm, setInspectForm] = useState({ inspector_name: '', inspector_email: '', scheduled_date: '' })
  const [inspectSubmitting, setInspectSubmitting] = useState(false)

  useEffect(() => { fetchDraws() }, [filter])

  async function fetchDraws() {
    setLoading(true)
    const params = filter === 'all' ? '' : `?status=${filter}`
    const res = await fetch(`/api/draws${params}`)
    const json = await res.json()
    const drawList: DrawWithProject[] = json.data || []
    setDraws(drawList)
    setLoading(false)
    // Load inspections for all draws in the background
    drawList.forEach(d => loadInspections(d.id))
  }

  async function loadInspections(drawId: string) {
    try {
      const res = await fetch(`/api/inspections?draw_request_id=${drawId}`)
      const json = await res.json()
      if (json.data) {
        setInspections(prev => ({ ...prev, [drawId]: json.data }))
      }
    } catch { /* silent */ }
  }

  // Confirm lien waiver — mints XLS-20 NFT (taxon 2) and runs Verification Orchestrator (Patent §IV + §V)
  async function confirmLienWaiver(id: string) {
    setLienWaiverLoading(id)
    const res = await fetch(`/api/draws/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lien_waiver: true }),
    })
    if (res.ok) {
      setToast({ msg: '⬡ Lien waiver confirmed — NFT minting on XRPL…', ok: true })
      setTimeout(() => setToast(null), 5000)
      fetchDraws()
    } else {
      const json = await res.json().catch(() => ({}))
      setErrorModal(json.error ?? 'Lien waiver confirmation failed')
    }
    setLienWaiverLoading(null)
  }

  async function updateDraw(id: string, status: string, reason?: string) {
    setActionLoading(id + status)
    const res = await fetch(`/api/draws/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, decline_reason: reason }),
    })

    if (res.ok) {
      const verb = status === 'approved' ? 'Approved — escrow created on XRPL'
        : status === 'funded' ? 'Released — escrow finished on XRPL'
        : `Draw ${status}`
      setToast({ msg: verb, ok: true })
      setTimeout(() => setToast(null), 4000)
      fetchDraws()
    } else {
      const json = await res.json().catch(() => ({}))
      setErrorModal(json.error ?? 'Something went wrong')
    }
    setActionLoading(null)
  }

  async function submitInspection(draw: DrawWithProject) {
    if (!inspectForm.inspector_name.trim() || !inspectForm.inspector_email.trim()) return
    setInspectSubmitting(true)
    try {
      const res = await fetch('/api/inspections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          draw_request_id: draw.id,
          project_id: (draw.projects as any)?.id ?? undefined,
          inspector_name: inspectForm.inspector_name.trim(),
          inspector_email: inspectForm.inspector_email.trim(),
          scheduled_date: inspectForm.scheduled_date || null,
        }),
      })
      const json = await res.json()
      if (res.ok) {
        setToast({ msg: `Inspection assigned to ${inspectForm.inspector_name} — email sent`, ok: true })
        setTimeout(() => setToast(null), 4000)
        setInspectModal(null)
        setInspectForm({ inspector_name: '', inspector_email: '', scheduled_date: '' })
        loadInspections(draw.id)
      } else {
        setErrorModal(json.error ?? 'Failed to assign inspection')
      }
    } finally {
      setInspectSubmitting(false)
    }
  }

  const statusBadge: Record<string, string> = {
    pending: 'badge-yellow', submitted: 'badge-blue', approved: 'badge-blue',
    funded: 'badge-green', declined: 'badge-red', draft: 'badge-gray',
  }
  const inspectStatusColor: Record<string, string> = {
    pending: 'var(--bc-gold)', passed: '#2ecc71', failed: '#e74c3c', cancelled: 'var(--bc-muted)'
  }
  const inspectStatusIcon: Record<string, string> = {
    pending: '⏳', passed: '✅', failed: '❌', cancelled: '—'
  }

  const FILTERS = ['submitted', 'approved', 'funded', 'declined', 'all']

  return (
    <div>
      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl text-sm font-bold shadow-xl"
          style={{ background: toast.ok ? 'var(--bc-gold)' : '#e74c3c', color: 'var(--bc-dark)' }}>
          {toast.ok ? '✓' : '✗'} {toast.msg}
        </div>
      )}

      {/* Error modal */}
      {errorModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setErrorModal(null)}>
          <div className="rounded-xl border p-6 max-w-md w-full mx-4" onClick={e => e.stopPropagation()}
            style={{ background: 'var(--bc-navy)', borderColor: 'var(--bc-border)' }}>
            <div className="text-lg font-bold mb-2 text-red-400">Action Failed</div>
            <div className="text-sm mb-4" style={{ color: 'var(--bc-muted)' }}>{errorModal}</div>
            <button onClick={() => setErrorModal(null)}
              className="px-4 py-2 rounded-lg text-sm font-bold"
              style={{ background: 'var(--bc-gold)', color: 'var(--bc-dark)' }}>
              OK
            </button>
          </div>
        </div>
      )}

      {/* Assign Inspection Modal */}
      {inspectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setInspectModal(null)}>
          <div className="rounded-xl border w-full max-w-md" onClick={e => e.stopPropagation()}
            style={{ background: 'var(--bc-navy)', borderColor: 'var(--bc-border)' }}>
            <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--bc-border)' }}>
              <div>
                <div className="font-bold">Assign Inspection</div>
                <div className="text-xs mt-0.5" style={{ color: 'var(--bc-muted)' }}>
                  {inspectModal.request_number} · {(inspectModal.projects as any)?.name}
                </div>
              </div>
              <button onClick={() => setInspectModal(null)} className="text-lg" style={{ color: 'var(--bc-muted)' }}>✕</button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--bc-muted)' }}>
                  Inspector Name *
                </label>
                <input
                  value={inspectForm.inspector_name}
                  onChange={e => setInspectForm(f => ({ ...f, inspector_name: e.target.value }))}
                  placeholder="John Smith"
                  className="w-full rounded-lg px-3 py-2.5 text-sm outline-none"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--bc-border)', color: 'var(--bc-text)' }}
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--bc-muted)' }}>
                  Inspector Email *
                </label>
                <input
                  type="email"
                  value={inspectForm.inspector_email}
                  onChange={e => setInspectForm(f => ({ ...f, inspector_email: e.target.value }))}
                  placeholder="inspector@company.com"
                  className="w-full rounded-lg px-3 py-2.5 text-sm outline-none"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--bc-border)', color: 'var(--bc-text)' }}
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--bc-muted)' }}>
                  Scheduled Date (optional)
                </label>
                <input
                  type="date"
                  value={inspectForm.scheduled_date}
                  onChange={e => setInspectForm(f => ({ ...f, scheduled_date: e.target.value }))}
                  className="w-full rounded-lg px-3 py-2.5 text-sm outline-none"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--bc-border)', color: 'var(--bc-text)', colorScheme: 'dark' }}
                />
              </div>
              <div className="pt-1 flex gap-3">
                <button
                  onClick={() => submitInspection(inspectModal)}
                  disabled={inspectSubmitting || !inspectForm.inspector_name || !inspectForm.inspector_email}
                  className="flex-1 py-2.5 rounded-lg text-sm font-bold"
                  style={{
                    background: inspectSubmitting || !inspectForm.inspector_name || !inspectForm.inspector_email
                      ? 'rgba(201,168,76,0.4)' : 'var(--bc-gold)',
                    color: 'var(--bc-dark)',
                    cursor: !inspectForm.inspector_name || !inspectForm.inspector_email ? 'not-allowed' : 'pointer',
                  }}>
                  {inspectSubmitting ? 'Sending…' : '📧 Assign & Send Email'}
                </button>
                <button onClick={() => setInspectModal(null)}
                  className="px-4 py-2.5 rounded-lg text-sm font-semibold border"
                  style={{ borderColor: 'var(--bc-border)', color: 'var(--bc-muted)' }}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold">Draw Requests</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--bc-muted)' }}>
            Review approvals and release XRPL escrow funds
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {FILTERS.map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold capitalize border transition-all"
              style={{
                background: filter === f ? 'var(--bc-gold)' : 'transparent',
                color: filter === f ? 'var(--bc-dark)' : 'var(--bc-muted)',
                borderColor: filter === f ? 'var(--bc-gold)' : 'var(--bc-border)',
              }}>
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border overflow-hidden" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
        {loading ? (
          <div className="p-8 text-center" style={{ color: 'var(--bc-muted)' }}>Loading…</div>
        ) : draws.length === 0 ? (
          <div className="p-8 text-center" style={{ color: 'var(--bc-muted)' }}>No {filter} draw requests</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b" style={{ borderColor: 'var(--bc-border)' }}>
                  {['Request #', 'Project', 'Amount', 'Phase', 'Inspection', 'LW', 'Submitted', 'Status', 'XRPL', 'Actions'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--bc-muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {draws.map(draw => {
                  const drawInspections = inspections[draw.id] || []
                  const latestInspection = drawInspections[0]

                  return (
                    <tr key={draw.id} className="border-b last:border-0 hover:bg-white/[0.02]" style={{ borderColor: 'rgba(42,63,87,0.4)' }}>
                      <td className="px-4 py-3 font-bold" style={{ color: 'var(--bc-gold)' }}>{draw.request_number}</td>
                      <td className="px-4 py-3">
                        <div className="font-medium">{draw.projects?.name}</div>
                        <div className="text-xs" style={{ color: 'var(--bc-muted)' }}>{draw.projects?.loan_number}</div>
                      </td>
                      <td className="px-4 py-3 font-bold">{formatCurrency(draw.amount)}</td>
                      <td className="px-4 py-3 text-xs">{draw.phase || draw.purpose}</td>

                      {/* Inspection column */}
                      <td className="px-4 py-3">
                        {latestInspection ? (
                          <div className="space-y-1">
                            <div className="text-xs font-semibold" style={{ color: inspectStatusColor[latestInspection.status] }}>
                              {inspectStatusIcon[latestInspection.status]} {latestInspection.status}
                            </div>
                            <div className="text-xs" style={{ color: 'var(--bc-muted)' }}>
                              {latestInspection.inspector_name.split(' ')[0]}
                            </div>
                            {latestInspection.status === 'pending' && (
                              <button
                                onClick={() => {
                                  const url = `${BASE_URL}/inspect/${latestInspection.token}`
                                  navigator.clipboard.writeText(url).then(() => setToast({ msg: 'Link copied', ok: true }))
                                  setTimeout(() => setToast(null), 2500)
                                }}
                                className="text-xs font-semibold hover:underline"
                                style={{ color: 'var(--bc-blue)' }}>
                                Copy link
                              </button>
                            )}
                          </div>
                        ) : (
                          <button
                            onClick={() => setInspectModal(draw)}
                            className="text-xs font-semibold px-2 py-1 rounded border transition-all hover:bg-white/5"
                            style={{ color: 'var(--bc-gold)', borderColor: 'rgba(201,168,76,0.3)' }}>
                            + Assign
                          </button>
                        )}
                      </td>

                      <td className="px-4 py-3 text-center text-xs">
                        {draw.lien_waiver_nft_id
                          ? <span className="font-bold" style={{ color: '#4ade80' }}>⬡ NFT</span>
                          : draw.lien_waiver
                          ? <span>✅</span>
                          : <span style={{ color: '#e74c3c' }}>❌</span>}
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--bc-muted)' }}>
                        {draw.submitted_at ? timeAgo(draw.submitted_at) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`badge ${statusBadge[draw.status] || 'badge-gray'}`}>{draw.status}</span>
                      </td>

                      {/* XRPL escrow + NFT info */}
                      <td className="px-4 py-3">
                        {draw.escrow_txn_hash || draw.lien_waiver_nft_id || draw.verification_receipt ? (
                          <div className="text-xs space-y-0.5">
                            {draw.escrow_txn_hash && (
                              <a href={`${TESTNET_EXPLORER}/${draw.escrow_txn_hash}`} target="_blank" rel="noreferrer"
                                className="block font-mono hover:underline" style={{ color: 'var(--bc-blue)' }}>
                                {draw.escrow_txn_hash.slice(0, 8)}…
                              </a>
                            )}
                            {draw.escrow_finish_after && !draw.escrow_finish_hash && (
                              <div style={{ color: 'var(--bc-muted)' }}>
                                Unlocks {timeAgo(draw.escrow_finish_after)}
                              </div>
                            )}
                            {draw.lien_waiver_nft_id && (
                              <div className="font-mono" style={{ color: '#4ade80' }}>
                                LW⬡ {draw.lien_waiver_nft_id.slice(0, 6)}…
                              </div>
                            )}
                            {draw.verification_receipt ? (
                              <div className="font-bold" style={{ color: '#4ade80' }}>⬡ Auto-released</div>
                            ) : draw.escrow_finish_hash ? (
                              <a href={`${TESTNET_EXPLORER}/${draw.escrow_finish_hash}`} target="_blank" rel="noreferrer"
                                className="block font-mono hover:underline" style={{ color: '#2ecc71' }}>
                                Released ↗
                              </a>
                            ) : null}
                          </div>
                        ) : <span style={{ color: 'var(--bc-muted)' }}>—</span>}
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3">
                        {/* Pending / submitted: approve or decline */}
                        {['pending', 'submitted'].includes(draw.status) && (
                          <div className="flex gap-1.5">
                            <button
                              onClick={() => updateDraw(draw.id, 'approved')}
                              disabled={actionLoading === draw.id + 'approved'}
                              title="Approve draw and create XRPL escrow"
                              className="px-2.5 py-1 rounded-lg text-xs font-bold transition-all"
                              style={{ background: 'var(--bc-blue)', color: '#fff' }}>
                              {actionLoading === draw.id + 'approved' ? '…' : '⬡ Approve'}
                            </button>
                            <button
                              onClick={() => updateDraw(draw.id, 'declined', 'Declined by admin')}
                              disabled={actionLoading === draw.id + 'declined'}
                              className="px-2.5 py-1 rounded-lg text-xs font-bold border transition-all"
                              style={{ background: 'rgba(231,76,60,0.1)', color: '#e74c3c', borderColor: 'rgba(231,76,60,0.3)' }}>
                              ✗
                            </button>
                          </div>
                        )}

                        {/* Approved: confirm lien waiver + manual release */}
                        {draw.status === 'approved' && (
                          <div className="space-y-1.5">
                            {!draw.lien_waiver && (
                              <button
                                onClick={() => confirmLienWaiver(draw.id)}
                                disabled={lienWaiverLoading === draw.id}
                                title="Confirm lien waiver received — mints XLS-20 NFT + runs dual-condition check"
                                className="px-2.5 py-1 rounded-lg text-xs font-bold transition-all w-full"
                                style={{ background: 'rgba(74,222,128,0.12)', color: '#4ade80', border: '1px solid rgba(74,222,128,0.3)' }}>
                                {lienWaiverLoading === draw.id ? '⬡ …' : '✓ Lien Waiver'}
                              </button>
                            )}
                            <button
                              onClick={() => updateDraw(draw.id, 'funded')}
                              disabled={actionLoading === draw.id + 'funded'}
                              title="Manually release XRPL escrow — bypasses dual-condition check"
                              className="px-2.5 py-1 rounded-lg text-xs font-bold transition-all w-full"
                              style={{ background: 'var(--bc-gold)', color: 'var(--bc-dark)' }}>
                              {actionLoading === draw.id + 'funded' ? '…' : '↑ Release'}
                            </button>
                          </div>
                        )}

                        {draw.status === 'funded' && draw.funded_at && (
                          <div className="text-xs space-y-0.5">
                            {draw.verification_receipt ? (
                              <div className="font-semibold" style={{ color: '#4ade80' }}>⬡ Auto-released</div>
                            ) : (
                              <div style={{ color: 'var(--bc-muted)' }}>↑ Manual release</div>
                            )}
                            <div style={{ color: 'var(--bc-muted)' }}>{timeAgo(draw.funded_at)}</div>
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
