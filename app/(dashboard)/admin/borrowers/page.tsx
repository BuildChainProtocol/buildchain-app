'use client'

import { useState, useEffect, useCallback } from 'react'
import { formatCurrency } from '@/lib/utils'

interface Borrower {
  id: string; company_name: string; contact_name: string | null; email: string | null
  phone: string | null; license_number: string | null; license_state: string | null
  rating: string; active: boolean; profile_id: string | null
}

const US_STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY']

const RATINGS = [
  { value: 'preferred', label: 'A', color: '#2ecc71' },
  { value: 'standard',  label: 'B', color: 'var(--bc-blue)' },
  { value: 'new',       label: 'C', color: 'var(--bc-gold)' },
  { value: 'probation', label: 'D', color: '#e74c3c' },
]
const ratingColor: Record<string, string> = {
  preferred: '#2ecc71', standard: 'var(--bc-blue)', new: 'var(--bc-gold)', probation: '#e74c3c'
}
const ratingLabel: Record<string, string> = {
  preferred: 'A', standard: 'B', new: 'C', probation: 'D'
}

function AddBorrowerModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ company_name: '', contact_name: '', email: '', phone: '', license_number: '', license_state: 'TX', rating: 'standard' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(''); setLoading(true)
    const res = await fetch('/api/borrowers', {
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
          <h2 className="font-bold text-base">Add Borrower</h2>
          <button onClick={onClose} className="text-xl leading-none hover:opacity-70" style={{ color: 'var(--bc-muted)' }}>×</button>
        </div>
        <form onSubmit={submit} className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--bc-muted)' }}>Company Name *</label>
            <input required value={form.company_name} onChange={e => set('company_name', e.target.value)}
              placeholder="Apex Construction LLC" className={inputClass} style={inputStyle} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--bc-muted)' }}>Contact Name</label>
              <input value={form.contact_name} onChange={e => set('contact_name', e.target.value)}
                placeholder="John Builder" className={inputClass} style={inputStyle} />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--bc-muted)' }}>Email</label>
              <input type="email" value={form.email} onChange={e => set('email', e.target.value)}
                placeholder="john@apex.com" className={inputClass} style={inputStyle} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--bc-muted)' }}>Phone</label>
              <input value={form.phone} onChange={e => set('phone', e.target.value)}
                placeholder="(512) 555-0200" className={inputClass} style={inputStyle} />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--bc-muted)' }}>Credit Rating</label>
              <div className="flex gap-2">
                {RATINGS.map(r => (
                  <button type="button" key={r.value} onClick={() => set('rating', r.value)}
                    className="flex-1 py-1.5 rounded-lg text-sm font-black transition-all border"
                    style={{
                      background: form.rating === r.value ? r.color : 'transparent',
                      color: form.rating === r.value ? '#fff' : r.color,
                      borderColor: r.color,
                    }}>{r.label}</button>
                ))}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--bc-muted)' }}>Contractor License #</label>
              <input value={form.license_number} onChange={e => set('license_number', e.target.value)}
                placeholder="LIC-12345" className={inputClass} style={inputStyle} />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--bc-muted)' }}>License State</label>
              <select value={form.license_state} onChange={e => set('license_state', e.target.value)}
                className={inputClass} style={inputStyle}>
                {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          {error && <div className="text-sm p-3 rounded-lg" style={{ background: 'rgba(231,76,60,0.1)', color: '#e74c3c' }}>{error}</div>}
          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={loading}
              className="px-5 py-2 rounded-lg text-sm font-bold"
              style={{ background: 'var(--bc-gold)', color: 'var(--bc-dark)', opacity: loading ? 0.7 : 1 }}>
              {loading ? 'Saving…' : 'Add Borrower'}
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

export default function AdminBorrowersPage() {
  const [borrowers, setBorrowers] = useState<Borrower[]>([])
  const [showModal, setShowModal] = useState(false)
  const [loading, setLoading] = useState(true)
  const [inviting, setInviting] = useState<string | null>(null)
  const [toast, setToast] = useState('')

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(''), 4000) }

  async function sendInvite(b: Borrower) {
    if (!b.email) { showToast('No email on this borrower record — add one first'); return }
    setInviting(b.id)
    const res = await fetch('/api/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: b.email, role: 'borrower', name: b.contact_name, company: b.company_name }),
    })
    const json = await res.json()
    setInviting(null)
    if (json.warning) showToast('⚠️ ' + json.warning)
    else if (json.error) showToast('Error: ' + json.error)
    else showToast(`✓ Invite sent to ${b.email}`)
    await load()
  }

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/borrowers')
    const json = await res.json()
    setBorrowers(json.data || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const activeBorrowers = borrowers.filter(b => b.active)

  return (
    <div>
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl text-sm font-bold shadow-xl"
          style={{ background: toast.startsWith('Error') ? '#e74c3c' : 'var(--bc-gold)', color: toast.startsWith('Error') ? '#fff' : 'var(--bc-dark)' }}>
          {toast}
        </div>
      )}
      {showModal && <AddBorrowerModal onClose={() => setShowModal(false)} onSaved={() => { setShowModal(false); load() }} />}

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Borrowers</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--bc-muted)' }}>{activeBorrowers.length} active borrowers on the platform</p>
        </div>
        <button onClick={() => setShowModal(true)}
          className="px-4 py-2 rounded-lg text-sm font-bold"
          style={{ background: 'var(--bc-gold)', color: 'var(--bc-dark)' }}>
          + Add Borrower
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Total Borrowers', value: borrowers.length, sub: `${activeBorrowers.length} active` },
          { label: 'Preferred', value: borrowers.filter(b => b.rating === 'preferred').length, sub: 'top credit quality', color: '#2ecc71' },
          { label: 'Avg Rating', value: borrowers.length ? (['A','B','C','D'].includes(borrowers[0]?.rating) ? borrowers[0].rating : '—') : '—', sub: 'most recent borrower' },
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
          <h2 className="text-sm font-bold">All Borrowers</h2>
        </div>
        {loading ? (
          <div className="p-8 text-center" style={{ color: 'var(--bc-muted)' }}>Loading…</div>
        ) : borrowers.length === 0 ? (
          <div className="px-5 py-16 text-center">
            <div className="text-4xl mb-3">👥</div>
            <div className="font-semibold mb-1">No borrowers yet</div>
            <div className="text-sm mb-4" style={{ color: 'var(--bc-muted)' }}>Add your first borrower to start onboarding projects.</div>
            <button onClick={() => setShowModal(true)}
              className="px-4 py-2 rounded-lg text-sm font-bold"
              style={{ background: 'var(--bc-gold)', color: 'var(--bc-dark)' }}>
              + Add First Borrower
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b" style={{ borderColor: 'var(--bc-border)' }}>
                  {['Borrower', 'Contact', 'License', 'Rating', 'Status', 'Portal Access'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--bc-muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {borrowers.map(b => (
                  <tr key={b.id} className="border-b last:border-0 hover:bg-white/[0.02]" style={{ borderColor: 'rgba(42,63,87,0.4)' }}>
                    <td className="px-4 py-3">
                      <div className="font-semibold">{b.company_name}</div>
                      <div className="text-xs mt-0.5" style={{ color: 'var(--bc-muted)' }}>{b.email}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div>{b.contact_name || '—'}</div>
                      <div className="text-xs mt-0.5" style={{ color: 'var(--bc-muted)' }}>{b.phone || ''}</div>
                    </td>
                    <td className="px-4 py-3">
                      {b.license_number
                        ? <><div className="text-xs font-mono">{b.license_number}</div><div className="text-xs" style={{ color: 'var(--bc-muted)' }}>{b.license_state}</div></>
                        : <span style={{ color: 'var(--bc-muted)' }}>—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-lg font-black" style={{ color: ratingColor[b.rating] || 'var(--bc-muted)' }}>
                        {ratingLabel[b.rating] || b.rating || '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`badge ${b.active ? 'badge-green' : 'badge-gray'}`}>{b.active ? 'Active' : 'Inactive'}</span>
                    </td>
                    <td className="px-4 py-3">
                      {b.profile_id ? (
                        <span className="text-xs font-semibold" style={{ color: '#2ecc71' }}>✓ Linked</span>
                      ) : (
                        <button
                          onClick={() => sendInvite(b)}
                          disabled={inviting === b.id}
                          className="text-xs font-bold px-3 py-1.5 rounded-lg transition-all"
                          style={{ background: 'rgba(243,156,18,0.15)', color: 'var(--bc-gold)' }}>
                          {inviting === b.id ? 'Sending…' : '✉ Send Invite'}
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
