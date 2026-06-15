'use client'

import { useState, useEffect } from 'react'
import { formatCurrency, timeAgo } from '@/lib/utils'
import type { DrawRequest } from '@/lib/types/database'

type XrplDraw = DrawRequest & {
  escrow_sequence: number | null
  escrow_txn_hash: string | null
  escrow_finish_hash: string | null
  escrow_finish_after: string | null
}

type DrawWithProject = XrplDraw & {
  projects: { name: string; loan_number: string; loan_amount: number; amount_drawn: number }
}

const TESTNET_EXPLORER = 'https://testnet.xrpl.org/transactions'

export default function AdminDrawsPage() {
  const [draws, setDraws] = useState<DrawWithProject[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('pending')
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  const [errorModal, setErrorModal] = useState<string | null>(null)

  useEffect(() => { fetchDraws() }, [filter])

  async function fetchDraws() {
    setLoading(true)
    const params = filter === 'all' ? '' : `?status=${filter}`
    const res = await fetch(`/api/draws${params}`)
    const json = await res.json()
    setDraws(json.data || [])
    setLoading(false)
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

  const statusBadge: Record<string, string> = {
    pending: 'badge-yellow', submitted: 'badge-blue', approved: 'badge-blue',
    funded: 'badge-green', declined: 'badge-red', draft: 'badge-gray',
  }

  const FILTERS = ['pending', 'approved', 'funded', 'declined', 'all']

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

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Draw Requests</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--bc-muted)' }}>
            Review approvals and release XRPL escrow funds
          </p>
        </div>
        <div className="flex gap-2">
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
                  {['Request #', 'Project', 'Amount', 'Phase', '✓', 'LW', 'Submitted', 'Status', 'XRPL', 'Actions'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--bc-muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {draws.map(draw => (
                  <tr key={draw.id} className="border-b last:border-0 hover:bg-white/[0.02]" style={{ borderColor: 'rgba(42,63,87,0.4)' }}>
                    <td className="px-4 py-3 font-bold" style={{ color: 'var(--bc-gold)' }}>{draw.request_number}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{draw.projects?.name}</div>
                      <div className="text-xs" style={{ color: 'var(--bc-muted)' }}>{draw.projects?.loan_number}</div>
                    </td>
                    <td className="px-4 py-3 font-bold">{formatCurrency(draw.amount)}</td>
                    <td className="px-4 py-3 text-xs">{draw.phase || draw.purpose}</td>
                    <td className="px-4 py-3 text-center">{draw.inspection_done ? '✅' : '⏳'}</td>
                    <td className="px-4 py-3 text-center">{draw.lien_waiver ? '✅' : '❌'}</td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--bc-muted)' }}>
                      {draw.submitted_at ? timeAgo(draw.submitted_at) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`badge ${statusBadge[draw.status] || 'badge-gray'}`}>{draw.status}</span>
                    </td>

                    {/* XRPL escrow info */}
                    <td className="px-4 py-3">
                      {draw.escrow_txn_hash ? (
                        <div className="text-xs space-y-0.5">
                          <a href={`${TESTNET_EXPLORER}/${draw.escrow_txn_hash}`} target="_blank" rel="noreferrer"
                            className="block font-mono hover:underline" style={{ color: 'var(--bc-blue)' }}>
                            {draw.escrow_txn_hash.slice(0, 8)}…
                          </a>
                          {draw.escrow_finish_after && (
                            <div style={{ color: 'var(--bc-muted)' }}>
                              Unlocks {timeAgo(draw.escrow_finish_after)}
                            </div>
                          )}
                          {draw.escrow_finish_hash && (
                            <a href={`${TESTNET_EXPLORER}/${draw.escrow_finish_hash}`} target="_blank" rel="noreferrer"
                              className="block font-mono hover:underline" style={{ color: '#2ecc71' }}>
                              Released ↗
                            </a>
                          )}
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

                      {/* Approved: release escrow */}
                      {draw.status === 'approved' && (
                        <button
                          onClick={() => updateDraw(draw.id, 'funded')}
                          disabled={actionLoading === draw.id + 'funded'}
                          title="Finish XRPL escrow and release funds to borrower"
                          className="px-2.5 py-1 rounded-lg text-xs font-bold transition-all"
                          style={{ background: 'var(--bc-gold)', color: 'var(--bc-dark)' }}>
                          {actionLoading === draw.id + 'funded' ? '…' : '↑ Release'}
                        </button>
                      )}

                      {draw.status === 'funded' && draw.funded_at && (
                        <span className="text-xs" style={{ color: 'var(--bc-muted)' }}>
                          Funded {timeAgo(draw.funded_at)}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
