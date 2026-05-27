'use client'

import { useState, useEffect } from 'react'
import { formatCurrency, timeAgo } from '@/lib/utils'
import type { DrawRequest } from '@/lib/types/database'

type DrawWithProject = DrawRequest & { projects: { name: string; loan_number: string } }

export default function AdminDrawsPage() {
  const [draws, setDraws] = useState<DrawWithProject[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('pending')
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [toast, setToast] = useState('')

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
    setActionLoading(id)
    const res = await fetch(`/api/draws/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, decline_reason: reason }),
    })
    if (res.ok) {
      setToast(`Draw ${status} successfully`)
      setTimeout(() => setToast(''), 3000)
      fetchDraws()
    }
    setActionLoading(null)
  }

  const statusBadge: Record<string, string> = {
    pending: 'badge-yellow', submitted: 'badge-blue', approved: 'badge-green',
    funded: 'badge-green', declined: 'badge-red', draft: 'badge-gray',
  }

  return (
    <div>
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl text-sm font-bold shadow-xl"
          style={{ background: 'var(--bc-gold)', color: 'var(--bc-dark)' }}>✓ {toast}</div>
      )}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Draw Requests</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--bc-muted)' }}>Review and approve construction loan disbursements</p>
        </div>
        <div className="flex gap-2">
          {['pending', 'funded', 'declined', 'all'].map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold capitalize border transition-all"
              style={{
                background: filter === f ? 'var(--bc-gold)' : 'transparent',
                color: filter === f ? 'var(--bc-dark)' : 'var(--bc-muted)',
                borderColor: filter === f ? 'var(--bc-gold)' : 'var(--bc-border)',
              }}>
              {f === 'all' ? 'All' : f}
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
                  {['Request #', 'Project', 'Amount', 'Phase', 'Inspection', 'Lien Waiver', 'Submitted', 'Status', 'Actions'].map(h => (
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
                    <td className="px-4 py-3">
                      {['pending', 'submitted'].includes(draw.status) && (
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => updateDraw(draw.id, 'funded')}
                            disabled={actionLoading === draw.id}
                            className="px-2.5 py-1 rounded-lg text-xs font-bold transition-all"
                            style={{ background: 'var(--bc-gold)', color: 'var(--bc-dark)' }}>
                            {actionLoading === draw.id ? '…' : '✓ Fund'}
                          </button>
                          <button
                            onClick={() => updateDraw(draw.id, 'declined', 'Declined by lender')}
                            disabled={actionLoading === draw.id}
                            className="px-2.5 py-1 rounded-lg text-xs font-bold border transition-all"
                            style={{ background: 'rgba(231,76,60,0.1)', color: '#e74c3c', borderColor: 'rgba(231,76,60,0.3)' }}>
                            ✗
                          </button>
                        </div>
                      )}
                      {draw.status === 'funded' && draw.funded_at && (
                        <span className="text-xs" style={{ color: 'var(--bc-muted)' }}>Funded {timeAgo(draw.funded_at)}</span>
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
