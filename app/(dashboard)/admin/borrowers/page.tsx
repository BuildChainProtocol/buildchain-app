'use client'

import { useState, useEffect, useCallback } from 'react'

interface Borrower {
  id: string; company_name: string; contact_name: string | null; email: string | null
  phone: string | null; license_number: string | null; license_state: string | null
  rating: string | null; active: boolean; profile_id: string | null
  xrp_address?: string | null
  // Email of the linked sign-in account (returned to admins only)
  account_email?: string | null
}

const US_STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY']

const RATINGS = [
  { value: 'preferred', label: 'A', color: '#15803d' },
  { value: 'standard',  label: 'B', color: 'var(--bc-blue)' },
  { value: 'new',       label: 'C', color: 'var(--bc-gold-ink)' },
  { value: 'probation', label: 'D', color: '#c0392b' },
]
const ratingColor: Record<string, string> = {
  preferred: '#15803d', standard: 'var(--bc-blue)', new: 'var(--bc-gold-ink)', probation: '#c0392b'
}
const ratingLabel: Record<string, string> = {
  preferred: 'A', standard: 'B', new: 'C', probation: 'D'
}
// For the average: A = 4 … D = 1
const ratingScore: Record<string, number> = { preferred: 4, standard: 3, new: 2, probation: 1 }
const scoreLabel: Record<number, string> = { 4: 'A', 3: 'B', 2: 'C', 1: 'D' }

const inputClass = "w-full rounded-lg px-3 py-2 text-sm outline-none"
const inputStyle = { background: 'rgba(13,27,42,0.05)', border: '1px solid var(--bc-border)', color: 'var(--bc-text)' }
const labelClass = "block text-xs font-semibold uppercase tracking-wide mb-1.5"

/** Add a borrower, or edit one when `borrower` is given. */
function BorrowerModal({ borrower, note, onClose, onSaved }: {
  borrower?: Borrower; note?: string; onClose: () => void; onSaved: (msg: string) => void
}) {
  const editing = !!borrower
  const [form, setForm] = useState({
    company_name: borrower?.company_name ?? '',
    contact_name: borrower?.contact_name ?? '',
    email: borrower?.email ?? '',
    phone: borrower?.phone ?? '',
    license_number: borrower?.license_number ?? '',
    license_state: borrower?.license_state ?? 'AZ',
    rating: borrower ? (borrower.rating ?? '') : 'standard',
    xrp_address: borrower?.xrp_address ?? '',
    active: borrower?.active ?? true,
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(''); setLoading(true)
    try {
      const res = editing
        ? await fetch(`/api/borrowers/${borrower!.id}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              company_name: form.company_name, contact_name: form.contact_name, email: form.email,
              phone: form.phone, license_number: form.license_number, license_state: form.license_state,
              rating: form.rating || null, active: form.active,
              // Only sent when it changed, so an untouched address is never rewritten.
              ...(form.xrp_address.trim() !== (borrower!.xrp_address ?? '')
                ? { xrp_address: form.xrp_address.trim() || null } : {}),
            }),
          })
        : await fetch('/api/borrowers', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              company_name: form.company_name, contact_name: form.contact_name, email: form.email,
              phone: form.phone, license_number: form.license_number, license_state: form.license_state,
              rating: form.rating,
            }),
          })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setError(json.error || `The borrower could not be saved (${res.status})`); return }
      onSaved(editing ? 'Borrower saved' : 'Borrower added')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The borrower could not be saved')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40" onClick={onClose}>
      <div className="rounded-xl border w-full max-w-lg mx-4 max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}
        style={{ background: 'var(--bc-navy)', borderColor: 'var(--bc-border)' }}>
        <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: 'var(--bc-border)' }}>
          <h2 className="font-bold text-base">{editing ? 'Edit Borrower' : 'Add Borrower'}</h2>
          <button onClick={onClose} className="text-xl leading-none hover:opacity-70" style={{ color: 'var(--bc-muted)' }}>×</button>
        </div>
        <form onSubmit={submit} className="px-6 py-5 space-y-4">
          {note && <div className="text-sm p-3 rounded-lg" style={{ background: 'rgba(201,164,87,0.12)', color: 'var(--bc-gold-ink)' }}>{note}</div>}
          <div>
            <label className={labelClass} style={{ color: 'var(--bc-muted)' }}>Company Name *</label>
            <input required value={form.company_name} onChange={e => set('company_name', e.target.value)}
              placeholder="Apex Construction LLC" className={inputClass} style={inputStyle} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass} style={{ color: 'var(--bc-muted)' }}>Contact Name</label>
              <input value={form.contact_name} onChange={e => set('contact_name', e.target.value)}
                placeholder="John Builder" className={inputClass} style={inputStyle} />
            </div>
            <div>
              <label className={labelClass} style={{ color: 'var(--bc-muted)' }}>Email</label>
              <input type="email" value={form.email} onChange={e => set('email', e.target.value)}
                placeholder="john@apex.com" className={inputClass} style={inputStyle} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass} style={{ color: 'var(--bc-muted)' }}>Phone</label>
              <input value={form.phone} onChange={e => set('phone', e.target.value)}
                placeholder="(602) 555-0200" className={inputClass} style={inputStyle} />
            </div>
            <div>
              <label className={labelClass} style={{ color: 'var(--bc-muted)' }}>Credit Rating</label>
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
              <label className={labelClass} style={{ color: 'var(--bc-muted)' }}>Contractor License #</label>
              <input value={form.license_number} onChange={e => set('license_number', e.target.value)}
                placeholder="ROC 123456" className={inputClass} style={inputStyle} />
            </div>
            <div>
              <label className={labelClass} style={{ color: 'var(--bc-muted)' }}>License State</label>
              <select value={form.license_state} onChange={e => set('license_state', e.target.value)}
                className={inputClass} style={inputStyle}>
                {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          {editing && (
            <div>
              <label className={labelClass} style={{ color: 'var(--bc-muted)' }}>XRP Ledger address (optional)</label>
              <input value={form.xrp_address} onChange={e => set('xrp_address', e.target.value)}
                placeholder="r…" className={`${inputClass} font-mono`} style={inputStyle} />
              <p className="text-xs mt-1" style={{ color: 'var(--bc-muted)' }}>
                Where this contractor's draws are released to. Leave empty to clear it.
              </p>
            </div>
          )}
          {editing && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.active} onChange={e => setForm(f => ({ ...f, active: e.target.checked }))} />
              Active
            </label>
          )}
          {error && <div className="text-sm p-3 rounded-lg" style={{ background: 'rgba(231,76,60,0.1)', color: '#c0392b' }}>{error}</div>}
          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={loading}
              className="px-5 py-2 rounded-lg text-sm font-bold"
              style={{ background: 'var(--bc-gold)', color: 'var(--bc-dark)', opacity: loading ? 0.7 : 1 }}>
              {loading ? 'Saving…' : editing ? 'Save' : 'Add Borrower'}
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

/** Asks for the email of an account that already exists, and links it. */
function LinkAccountModal({ borrower, onClose, onLinked }: { borrower: Borrower; onClose: () => void; onLinked: (msg: string) => void }) {
  const [email, setEmail] = useState(borrower.email ?? '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(''); setLoading(true)
    try {
      const res = await fetch(`/api/borrowers/${borrower.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ link_email: email.trim() }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setError(json.error || `The account could not be linked (${res.status})`); return }
      onLinked(`Linked to ${json.data?.account_email ?? email.trim()}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The account could not be linked')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40" onClick={onClose}>
      <div className="rounded-xl border w-full max-w-md mx-4" onClick={e => e.stopPropagation()}
        style={{ background: 'var(--bc-navy)', borderColor: 'var(--bc-border)' }}>
        <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: 'var(--bc-border)' }}>
          <h2 className="font-bold text-base">Link an existing account</h2>
          <button onClick={onClose} className="text-xl leading-none hover:opacity-70" style={{ color: 'var(--bc-muted)' }}>×</button>
        </div>
        <form onSubmit={submit} className="px-6 py-5 space-y-4">
          <p className="text-sm" style={{ color: 'var(--bc-muted)' }}>
            Enter the email the person signs in with. The account must already exist and be a borrower account.
            It will sign in as {borrower.company_name}.
          </p>
          <div>
            <label className={labelClass} style={{ color: 'var(--bc-muted)' }}>Account email *</label>
            <input required type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="john@apex.com" className={inputClass} style={inputStyle} autoFocus />
          </div>
          {error && <div className="text-sm p-3 rounded-lg" style={{ background: 'rgba(231,76,60,0.1)', color: '#c0392b' }}>{error}</div>}
          <div className="flex gap-3 pt-1">
            <button type="submit" disabled={loading || !email.trim()}
              className="px-5 py-2 rounded-lg text-sm font-bold"
              style={{ background: 'var(--bc-gold)', color: 'var(--bc-dark)', opacity: loading ? 0.7 : 1 }}>
              {loading ? 'Linking…' : 'Link account'}
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
  const [editing, setEditing] = useState<{ borrower: Borrower; note?: string } | null>(null)
  const [linking, setLinking] = useState<Borrower | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  function showToast(msg: string, ok = true) { setToast({ msg, ok }); setTimeout(() => setToast(null), ok ? 4000 : 9000) }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/borrowers')
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setLoadError(json.error || `The borrowers could not be loaded (${res.status})`); return }
      setLoadError('')
      setBorrowers(json.data || [])
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'The borrowers could not be loaded')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function sendInvite(b: Borrower) {
    // An invitation needs an address: open Edit so it can be added there.
    if (!b.email) {
      setEditing({ borrower: b, note: 'Add an email address for this borrower, save, then send the invitation.' })
      return
    }
    setBusy(b.id + 'invite')
    try {
      const res = await fetch('/api/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: b.email, role: 'borrower', name: b.contact_name, company: b.company_name }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || json.error) showToast(json.error || `The invitation could not be sent (${res.status})`, false)
      else if (json.warning) showToast(`${b.email} already has an account, so no invitation was sent. Use "Link an existing account".`, false)
      else showToast(`Invitation sent to ${b.email}`)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'The invitation could not be sent', false)
    } finally {
      setBusy(null)
    }
    await load()
  }

  async function unlink(b: Borrower) {
    const who = b.account_email || 'the linked account'
    if (!window.confirm(`Unlink ${who} from ${b.company_name}? That account will no longer see this borrower's projects.`)) return
    setBusy(b.id + 'unlink')
    try {
      const res = await fetch(`/api/borrowers/${b.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unlink: true }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) showToast(json.error || `The account could not be unlinked (${res.status})`, false)
      else showToast(`Unlinked ${who}`)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'The account could not be unlinked', false)
    } finally {
      setBusy(null)
    }
    await load()
  }

  const activeBorrowers = borrowers.filter(b => b.active)
  // Average of the ratings that are actually set (A = 4 … D = 1)
  const scores = borrowers.map(b => (b.rating ? ratingScore[b.rating] : undefined)).filter((n): n is number => typeof n === 'number')
  const avgRating = scores.length ? scoreLabel[Math.round(scores.reduce((s, n) => s + n, 0) / scores.length)] : '—'
  const linkBtn = "text-xs font-bold px-2.5 py-1 rounded-lg transition-all whitespace-nowrap"

  return (
    <div>
      {toast && (
        <div className="fixed bottom-6 right-6 z-[60] px-4 py-3 rounded-xl text-sm font-bold shadow-xl max-w-sm"
          style={{ background: toast.ok ? 'var(--bc-gold)' : '#c0392b', color: toast.ok ? 'var(--bc-dark)' : '#fff' }}>
          {toast.msg}
        </div>
      )}
      {showModal && <BorrowerModal onClose={() => setShowModal(false)} onSaved={msg => { setShowModal(false); showToast(msg); load() }} />}
      {editing && (
        <BorrowerModal borrower={editing.borrower} note={editing.note} onClose={() => setEditing(null)}
          onSaved={msg => { setEditing(null); showToast(msg); load() }} />
      )}
      {linking && (
        <LinkAccountModal borrower={linking} onClose={() => setLinking(null)}
          onLinked={msg => { setLinking(null); showToast(msg); load() }} />
      )}

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
          { label: 'Preferred', value: borrowers.filter(b => b.rating === 'preferred').length, sub: 'rated A', color: '#15803d' },
          { label: 'Avg Rating', value: avgRating, sub: scores.length ? `average of ${scores.length} rated borrower${scores.length === 1 ? '' : 's'}` : 'no ratings yet' },
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
        ) : loadError ? (
          <div className="p-8 text-center text-sm" style={{ color: '#c0392b' }}>{loadError}</div>
        ) : borrowers.length === 0 ? (
          <div className="px-5 py-16 text-center">
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
                  {['Borrower', 'Contact', 'License', 'Rating', 'Status', 'Account', ''].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--bc-muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {borrowers.map(b => (
                  <tr key={b.id} className="border-b last:border-0 hover:bg-slate-900/[0.02] align-top" style={{ borderColor: '#edf0f4' }}>
                    <td className="px-4 py-3">
                      <div className="font-semibold">{b.company_name}</div>
                      <div className="text-xs mt-0.5" style={{ color: 'var(--bc-muted)' }}>{b.email || 'No email on record'}</div>
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
                      <span className="text-lg font-black" style={{ color: (b.rating && ratingColor[b.rating]) || 'var(--bc-muted)' }}>
                        {(b.rating && ratingLabel[b.rating]) || b.rating || '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`badge ${b.active ? 'badge-green' : 'badge-gray'}`}>{b.active ? 'Active' : 'Inactive'}</span>
                    </td>
                    <td className="px-4 py-3">
                      {b.profile_id ? (
                        <div>
                          <div className="text-xs font-semibold" style={{ color: '#15803d' }}>
                            Linked to {b.account_email || 'an account'}
                          </div>
                          <button onClick={() => unlink(b)} disabled={busy === b.id + 'unlink'}
                            className="text-xs font-semibold hover:underline mt-1" style={{ color: '#c0392b' }}>
                            {busy === b.id + 'unlink' ? 'Unlinking…' : 'Unlink'}
                          </button>
                        </div>
                      ) : (
                        <div>
                          <div className="text-xs font-semibold mb-1.5" style={{ color: 'var(--bc-muted)' }}>No account linked</div>
                          <div className="flex flex-wrap gap-1.5">
                            <button onClick={() => sendInvite(b)} disabled={busy === b.id + 'invite'}
                              className={linkBtn}
                              style={{ background: 'rgba(201,164,87,0.15)', color: 'var(--bc-gold-ink)' }}>
                              {busy === b.id + 'invite' ? 'Sending…' : 'Send invitation'}
                            </button>
                            <button onClick={() => setLinking(b)}
                              className={`${linkBtn} border`}
                              style={{ borderColor: 'var(--bc-border)', color: 'var(--bc-text)' }}>
                              Link an existing account
                            </button>
                          </div>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <button onClick={() => setEditing({ borrower: b })}
                        className="text-xs font-semibold hover:underline" style={{ color: 'var(--bc-gold-ink)' }}>
                        Edit
                      </button>
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
