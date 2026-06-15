'use client'

import { useState, useEffect, useCallback } from 'react'

interface Lender {
  id: string; company_name: string; contact_name: string | null; email: string | null
  phone: string | null; loan_types: string[] | null; max_ltv: number | null; active: boolean
  profile_id: string | null
}

const LOAN_TYPES = ['Construction', 'Bridge', 'Permanent', 'Hard Money', 'Fix & Flip', 'Ground Up']

function AddLenderModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ company_name: '', contact_name: '', email: '', phone: '', max_ltv: '', loan_types: [] as string[] })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))
  const toggleType = (t: string) => setForm(f => ({
    ...f, loan_types: f.loan_types.includes(t) ? f.loan_types.filter(x => x !== t) : [...f.loan_types, t]
  }))

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(''); setLoading(true)
    const res = await fetch('/api/lenders', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form)
    })
    const json = await res.json()
    if (!res.ok) { setError(json.error || 'Failed to save'); setLoading(false); return }
    onSaved()
  }

  const inputClass = "w-full rounded-lg px-3 py-2 text-sm outline-none"
  const inputStyle = { background: 'rgba(255,255,255,0.05)', border: '1px solid var(--bc-border)', color: '#e8edf2' }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div className="rounded-xl border w-full max-w-lg mx-4" onClick={e => e.stopPropagation()}
        style={{ background: 'var(--bc-navy)', borderColor: 'var(--bc-border)' }}>
        <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: 'var(--bc-border)' }}>
          <h2 className="font-bold text-base">Add Lender</h2>
          <button onClick={onClose} className="text-xl leading-none hover:opacity-70" style={{ color: 'var(--bc-muted)' }}>×</button>
        </div>
        <form onSubmit={submit} className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--bc-muted)' }}>Company Name *</label>
            <input required value={form.company_name} onChange={e => set('company_name', e.target.value)}
              placeholder="First Capital Lending" className={inputClass} style={inputStyle} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--bc-muted)' }}>Contact Name</label>
              <input value={form.contact_name} onChange={e => set('contact_name', e.target.value)}
                placeholder="Jane Smith" className={inputClass} style={inputStyle} />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--bc-muted)' }}>Email</label>
              <input type="email" value={form.email} onChange={e => set('email', e.target.value)}
                placeholder="jane@lender.com" className={inputClass} style={inputStyle} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--bc-muted)' }}>Phone</label>
              <input value={form.phone} onChange={e => set('phone', e.target.value)}
                placeholder="(512) 555-0100" className={inputClass} style={inputStyle} />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--bc-muted)' }}>Max LTV (%)</label>
              <input type="number" min="0" max="100" step="0.1" value={form.max_ltv}
                onChange={e => set('max_ltv', e.target.value)} placeholder="80" className={inputClass} style={inputStyle} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--bc-muted)' }}>Loan Types</label>
            <div className="flex flex-wrap gap-2">
              {LOAN_TYPES.map(t => (
                <button type="button" key={t} onClick={() => toggleType(t)}
                  className="px-3 py-1 rounded-full text-xs font-semibold transition-all border"
                  style={{
                    background: form.loan_types.includes(t) ? 'var(--bc-gold)' : 'transparent',
                    color: form.loan_types.includes(t) ? 'var(--bc-dark)' : 'var(--bc-muted)',
                    borderColor: form.loan_types.includes(t) ? 'var(--bc-gold)' : 'var(--bc-border)',
                  }}>{t}</button>
              ))}
            </div>
          </div>
          {error && <div className="text-sm p-3 rounded-lg" style={{ background: 'rgba(231,76,60,0.1)', color: '#e74c3c' }}>{error}</div>}
          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={loading}
              className="px-5 py-2 rounded-lg text-sm font-bold"
              style={{ background: 'var(--bc-gold)', color: 'var(--bc-dark)', opacity: loading ? 0.7 : 1 }}>
              {loading ? 'Saving…' : 'Add Lender'}
            </button>
            <button type="button" onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm font-semibold border"
              style={{ borderColor: 'var(--bc-border)', color: 'var(--bc-muted)' }}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function AdminLendersPage() {
  const [lenders, setLenders] = useState<Lender[]>([])
  const [showModal, setShowModal] = useState(false)
  const [loading, setLoading] = useState(true)
  const [inviting, setInviting] = useState<string | null>(null)
  const [toast, setToast] = useState('')

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(''), 4000) }

  async function sendInvite(lender: Lender) {
    if (!lender.email) { showToast('No email on this lender record — add one first'); return }
    setInviting(lender.id)
    const res = await fetch('/api/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: lender.email, role: 'lender', name: lender.contact_name, company: lender.company_name }),
    })
    const json = await res.json()
    setInviting(null)
    if (json.warning) showToast('⚠️ ' + json.warning)
    else if (json.error) showToast('Error: ' + json.error)
    else showToast(`✓ Invite sent to ${lender.email}`)
    await load()
  }

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/lenders')
    const json = await res.json()
    setLenders(json.data || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const activeLenders = lenders.filter(l => l.active)

  return (
    <div>
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl text-sm font-bold shadow-xl"
          style={{ background: toast.startsWith('Error') ? '#e74c3c' : 'var(--bc-gold)', color: toast.startsWith('Error') ? '#fff' : 'var(--bc-dark)' }}>
          {toast}
        </div>
      )}
      {showModal && <AddLenderModal onClose={() => setShowModal(false)} onSaved={() => { setShowModal(false); load() }} />}

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Lenders</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--bc-muted)' }}>{activeLenders.length} active lenders on the platform</p>
        </div>
        <button onClick={() => setShowModal(true)}
          className="px-4 py-2 rounded-lg text-sm font-bold"
          style={{ background: 'var(--bc-gold)', color: 'var(--bc-dark)' }}>
          + Add Lender
        </button>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Total Lenders', value: lenders.length, sub: `${activeLenders.length} active` },
          { label: 'Platform Status', value: 'Live', sub: 'XRPL escrow enabled', color: '#2ecc71' },
          { label: 'Loan Types', value: [...new Set(lenders.flatMap(l => l.loan_types || []))].length, sub: 'types offered' },
        ].map(s => (
          <div key={s.label} className="rounded-xl border p-5" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
            <div className="text-xs font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--bc-muted)' }}>{s.label}</div>
            <div className="text-2xl font-bold" style={{ color: s.color }}>{s.value}</div>
            <div className="text-xs mt-1" style={{ color: 'var(--bc-muted)' }}>{s.sub}</div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border overflow-hidden" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
        <div className="px-5 py-4 border-b" style={{ borderColor: 'var(--bc-border)' }}>
          <h2 className="text-sm font-bold">All Lenders</h2>
        </div>
        {loading ? (
          <div className="p-8 text-center" style={{ color: 'var(--bc-muted)' }}>Loading…</div>
        ) : lenders.length === 0 ? (
          <div className="px-5 py-16 text-center">
            <div className="text-4xl mb-3">🏦</div>
            <div className="font-semibold mb-1">No lenders yet</div>
            <div className="text-sm mb-4" style={{ color: 'var(--bc-muted)' }}>Add your first lender to start creating projects.</div>
            <button onClick={() => setShowModal(true)}
              className="px-4 py-2 rounded-lg text-sm font-bold"
              style={{ background: 'var(--bc-gold)', color: 'var(--bc-dark)' }}>
              + Add First Lender
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b" style={{ borderColor: 'var(--bc-border)' }}>
                  {['Lender', 'Contact', 'Loan Types', 'Max LTV', 'Status', 'Portal Access'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--bc-muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lenders.map(l => (
                  <tr key={l.id} className="border-b last:border-0 hover:bg-white/[0.02]" style={{ borderColor: 'rgba(42,63,87,0.4)' }}>
                    <td className="px-4 py-3">
                      <div className="font-semibold">{l.company_name}</div>
                      <div className="text-xs mt-0.5" style={{ color: 'var(--bc-muted)' }}>{l.email}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div>{l.contact_name || '—'}</div>
                      <div className="text-xs mt-0.5" style={{ color: 'var(--bc-muted)' }}>{l.phone || ''}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {l.loan_types?.map(t => (
                          <span key={t} className="text-xs px-2 py-0.5 rounded" style={{ background: 'rgba(45,125,210,0.15)', color: 'var(--bc-blue)' }}>{t}</span>
                        )) || <span style={{ color: 'var(--bc-muted)' }}>—</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3">{l.max_ltv ? `${l.max_ltv}%` : '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`badge ${l.active ? 'badge-green' : 'badge-gray'}`}>{l.active ? 'Active' : 'Inactive'}</span>
                    </td>
                    <td className="px-4 py-3">
                      {l.profile_id ? (
                        <span className="text-xs font-semibold" style={{ color: '#2ecc71' }}>✓ Linked</span>
                      ) : (
                        <button
                          onClick={() => sendInvite(l)}
                          disabled={inviting === l.id}
                          className="text-xs font-bold px-3 py-1.5 rounded-lg transition-all"
                          style={{ background: 'rgba(243,156,18,0.15)', color: 'var(--bc-gold)' }}>
                          {inviting === l.id ? 'Sending…' : '✉ Send Invite'}
                        </button>
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
