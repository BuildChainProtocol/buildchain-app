'use client'

import { useState, useEffect } from 'react'
import { formatCurrency, timeAgo } from '@/lib/utils'

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
  status: string
  projects: { name: string; loan_number: string; loan_amount: number; amount_drawn: number }
}

export default function LenderApprovalsPage() {
  const [draws, setDraws] = useState<Draw[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => { fetchDraws() }, [])

  async function fetchDraws() {
    setLoading(true)
    const res = await fetch('/api/draws?status=submitted')
    const json = await res.json()
    setDraws(json.data || [])
    setLoading(false)
  }

  async function act(id: string, status: string) {
    setActionLoading(id + status)
    setErrorMsg('')
    const res = await fetch(`/api/draws/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    const json = await res.json()
    if (res.ok) {
      setToast({ msg: status === 'approved' ? 'Escrow created on XRPL ⬡' : `Draw ${status}`, ok: true })
      setTimeout(() => setToast(null), 4000)
      fetchDraws()
    } else {
      setErrorMsg(json.error || `Request failed (${res.status})`)
    }
    setActionLoading(null)
  }

  return (
    <div>
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl text-sm font-bold shadow-xl"
          style={{ background: toast.ok ? 'var(--bc-gold)' : '#e74c3c', color: '#fff' }}>
          {toast.ok ? '✓' : '✗'} {toast.msg}
        </div>
      )}
      {errorMsg && (
        <div className="mb-4 p-4 rounded-xl border text-sm" style={{ background: 'rgba(231,76,60,0.1)', borderColor: 'rgba(231,76,60,0.3)', color: '#e74c3c' }}>
          <strong>Error:</strong> {errorMsg}
        </div>
      )}

      <div className="mb-6">
        <h1 className="text-2xl font-bold">Pending Approvals</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--bc-muted)' }}>Draw requests awaiting your review and funding decision</p>
      </div>

      {loading ? (
        <div className="p-8 text-center" style={{ color: 'var(--bc-muted)' }}>Loading…</div>
      ) : draws.length === 0 ? (
        <div className="rounded-xl border p-12 text-center" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
          <div className="text-4xl mb-3">✅</div>
          <p className="font-semibold mb-1">All caught up!</p>
          <p className="text-sm" style={{ color: 'var(--bc-muted)' }}>No pending draw requests.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {draws.map(draw => {
            const ltv = draw.projects ? Math.round((draw.projects.amount_drawn + draw.amount) / draw.projects.loan_amount * 100) : 0
            return (
              <div key={draw.id} className="rounded-xl border overflow-hidden" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
                <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--bc-border)' }}>
                  <div>
                    <div className="font-bold text-base">{draw.request_number} — <span style={{ color: 'var(--bc-gold)' }}>{formatCurrency(draw.amount)}</span></div>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--bc-muted)' }}>
                      {draw.projects?.name} · {draw.projects?.loan_number} · Submitted {draw.submitted_at ? timeAgo(draw.submitted_at) : 'recently'}
                    </div>
                  </div>
                  <span className="badge badge-yellow">Awaiting Review</span>
                </div>

                <div className="px-5 py-4">
                  <div className="grid grid-cols-2 gap-6 mb-4">
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span style={{ color: 'var(--bc-muted)' }}>Phase</span>
                        <span className="font-semibold">{draw.phase || draw.purpose}</span>
                      </div>
                      <div className="flex justify-between">
                        <span style={{ color: 'var(--bc-muted)' }}>Amount Requested</span>
                        <span className="font-bold" style={{ color: 'var(--bc-gold)' }}>{formatCurrency(draw.amount)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span style={{ color: 'var(--bc-muted)' }}>Inspection Done</span>
                        <span>{draw.inspection_done ? '✅ Yes' : '⏳ Pending'}</span>
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
                    </div>
                  </div>

                  {draw.description && (
                    <div className="text-sm p-3 rounded-lg mb-4" style={{ background: 'rgba(255,255,255,0.03)', color: 'var(--bc-muted)' }}>
                      &ldquo;{draw.description}&rdquo;
                    </div>
                  )}

                  <div className="flex gap-3 items-center">
                    <button onClick={() => act(draw.id, 'approved')}
                      disabled={actionLoading === draw.id + 'approved'}
                      className="px-5 py-2 rounded-lg text-sm font-bold transition-all"
                      style={{ background: 'var(--bc-gold)', color: 'var(--bc-dark)' }}>
                      {actionLoading === draw.id + 'approved' ? 'Creating escrow…' : '⬡ Approve & Lock Escrow'}
                    </button>
                    <button onClick={() => act(draw.id, 'declined')}
                      disabled={actionLoading === draw.id + 'declined'}
                      className="px-4 py-2 rounded-lg text-sm font-bold border transition-all"
                      style={{ background: 'rgba(231,76,60,0.1)', color: '#e74c3c', borderColor: 'rgba(231,76,60,0.3)' }}>
                      ✗ Decline
                    </button>
                    <span className="text-xs" style={{ color: 'var(--bc-muted)' }}>
                      Admin releases funds after escrow review
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
