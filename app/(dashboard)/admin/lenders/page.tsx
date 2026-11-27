'use client'

import { useState, useEffect, useCallback } from 'react'

interface Lender {
  id: string; company_name: string; contact_name: string | null; email: string | null
  phone: string | null; loan_types: string[] | null; max_ltv: number | null; active: boolean
  profile_id: string | null
  // Email of the linked sign-in account (returned to admins only)
  account_email?: string | null
}

const LOAN_TYPES = ['Construction', 'Bridge', 'Permanent', 'Hard Money', 'Fix & Flip', 'Ground Up']

const inputClass = "w-full rounded-lg px-3 py-2 text-sm outline-none"
const inputStyle = { background: 'rgba(13,27,42,0.05)', border: '1px solid var(--bc-border)', color: 'var(--bc-text)' }
const labelClass = "block text-xs font-semibold uppercase tracking-wide mb-1.5"

/** Add a lender, or edit one when `lender` is given. */
function LenderModal({ lender, note, onClose, onSaved }: {
  lender?: Lender; note?: string; onClose: () => void; onSaved: (msg: string) => void
}) {
  const editing = !!lender
  const [form, setForm] = useState({
    company_name: lender?.company_name ?? '',
    contact_name: lender?.contact_name ?? '',
    email: lender?.email ?? '',
    phone: lender?.phone ?? '',
    max_ltv: lender?.max_ltv != null ? String(lender.max_ltv) : '',
    loan_types: lender?.loan_types ?? [] as string[],
    active: lender?.active ?? true,
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))
  const toggleType = (t: string) => setForm(f => ({
    ...f, loan_types: f.loan_types.includes(t) ? f.loan_types.filter(x => x !== t) : [...f.loan_types, t]
  }))

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(''); setLoading(true)
    try {
      const res = editing
        ? await fetch(`/api/lenders/${lender!.id}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              company_name: form.company_name, contact_name: form.contact_name, email: form.email,
              phone: form.phone, max_ltv: form.max_ltv === '' ? null : form.max_ltv,
              loan_types: form.loan_types, active: form.active,
            }),
          })
        : await fetch('/api/lenders', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form)
          })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setError(json.error || `The lender could not be saved (${res.status})`); return }
      onSaved(editing ? 'Lender saved' : 'Lender added')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The lender could not be saved')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40" onClick={onClose}>
      <div className="rounded-xl border w-full max-w-lg mx-4" onClick={e => e.stopPropagation()}
        style={{ background: 'var(--bc-navy)', borderColor: 'var(--bc-border)' }}>
        <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: 'var(--bc-border)' }}>
          <h2 className="font-bold text-base">{editing ? 'Edit Lender' : 'Add Lender'}</h2>
          <button onClick={onClose} className="text-xl leading-none hover:opacity-70" style={{ color: 'var(--bc-muted)' }}>×</button>
        </div>
        <form onSubmit={submit} className="px-6 py-5 space-y-4">
          {note && <div className="text-sm p-3 rounded-lg" style={{ background: 'rgba(201,164,87,0.12)', color: 'var(--bc-gold-ink)' }}>{note}</div>}
          <div>
            <label className={labelClass} style={{ color: 'var(--bc-muted)' }}>Company Name *</label>
            <input required value={form.company_name} onChange={e => set('company_name', e.target.value)}
              placeholder="First Capital Lending" className={inputClass} style={inputStyle} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass} style={{ color: 'var(--bc-muted)' }}>Contact Name</label>
              <input value={form.contact_name} onChange={e => set('contact_name', e.target.value)}
                placeholder="Jane Smith" className={inputClass} style={inputStyle} />
            </div>
            <div>
              <label className={labelClass} style={{ color: 'var(--bc-muted)' }}>Email</label>
              <input type="email" value={form.email} onChange={e => set('email', e.target.value)}
                placeholder="jane@lender.com" className={inputClass} style={inputStyle} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass} style={{ color: 'var(--bc-muted)' }}>Phone</label>
              <input value={form.phone} onChange={e => set('phone', e.target.value)}
                placeholder="(602) 555-0100" className={inputClass} style={inputStyle} />
            </div>
            <div>
              <label className={labelClass} style={{ color: 'var(--bc-muted)' }}>Max LTV (%)</label>
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
          {editing && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.active} onChange={e => setForm(f => ({ ...f, active: e.target.checked }))} />
              Active
            </label>
          )}
          {editing && (
            <p className="text-xs" style={{ color: 'var(--bc-muted)' }}>
              The lender's wallet address is not edited here. The lender sets it by connecting their wallet.
            </p>
          )}
          {error && <div className="text-sm p-3 rounded-lg" style={{ background: 'rgba(231,76,60,0.1)', color: '#c0392b' }}>{error}</div>}
          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={loading}
              className="px-5 py-2 rounded-lg text-sm font-bold"
              style={{ background: 'var(--bc-gold)', color: 'var(--bc-dark)', opacity: loading ? 0.7 : 1 }}>
              {loading ? 'Saving…' : editing ? 'Save' : 'Add Lender'}
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
function LinkAccountModal({ lender, onClose, onLinked }: { lender: Lender; onClose: () => void; onLinked: (msg: string) => void }) {
  const [email, setEmail] = useState(lender.email ?? '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(''); setLoading(true)
    try {
      const res = await fetch(`/api/lenders/${lender.id}`, {
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
            Enter the email the person signs in with. The account must already exist and be a lender account.
            It will sign in as {lender.company_name}.
          </p>
          <div>
            <label className={labelClass} style={{ color: 'var(--bc-muted)' }}>Account email *</label>
            <input required type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="jane@lender.com" className={inputClass} style={inputStyle} autoFocus />
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

export default function AdminLendersPage() {
  const [lenders, setLenders] = useState<Lender[]>([])
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<{ lender: Lender; note?: string } | null>(null)
  const [linking, setLinking] = useState<Lender | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  function showToast(msg: string, ok = true) { setToast({ msg, ok }); setTimeout(() => setToast(null), ok ? 4000 : 9000) }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/lenders')
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setLoadError(json.error || `The lenders could not be loaded (${res.status})`); return }
      setLoadError('')
      setLenders(json.data || [])
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'The lenders could not be loaded')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function sendInvite(lender: Lender) {
    // An invitation needs an address: open Edit so it can be added there.
    if (!lender.email) {
      setEditing({ lender, note: 'Add an email address for this lender, save, then send the invitation.' })
      return
    }
    setBusy(lender.id + 'invite')
    try {
      const res = await fetch('/api/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: lender.email, role: 'lender', name: lender.contact_name, company: lender.company_name }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || json.error) showToast(json.error || `The invitation could not be sent (${res.status})`, false)
      else if (json.warning) showToast(`${lender.email} already has an account, so no invitation was sent. Use "Link an existing account".`, false)
      else showToast(`Invitation sent to ${lender.email}`)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'The invitation could not be sent', false)
    } finally {
      setBusy(null)
    }
    await load()
  }

  async function unlink(lender: Lender) {
    const who = lender.account_email || 'the linked account'
    if (!window.confirm(`Unlink ${who} from ${lender.company_name}? That account will no longer see this lender's loans.`)) return
    setBusy(lender.id + 'unlink')
    try {
      const res = await fetch(`/api/lenders/${lender.id}`, {
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

  const activeLenders = lenders.filter(l => l.active)
  const linkBtn = "text-xs font-bold px-2.5 py-1 rounded-lg transition-all whitespace-nowrap"

  return (
    <div>
      {toast && (
        <div className="fixed bottom-6 right-6 z-[60] px-4 py-3 rounded-xl text-sm font-bold shadow-xl max-w-sm"
          style={{ background: toast.ok ? 'var(--bc-gold)' : '#c0392b', color: toast.ok ? 'var(--bc-dark)' : '#fff' }}>
          {toast.msg}
        </div>
      )}
      {showModal && <LenderModal onClose={() => setShowModal(false)} onSaved={msg => { setShowModal(false); showToast(msg); load() }} />}
      {editing && (
        <LenderModal lender={editing.lender} note={editing.note} onClose={() => setEditing(null)}
          onSaved={msg => { setEditing(null); showToast(msg); load() }} />
      )}
      {linking && (
        <LinkAccountModal lender={linking} onClose={() => setLinking(null)}
          onLinked={msg => { setLinking(null); showToast(msg); load() }} />
      )}

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

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Total Lenders', value: lenders.length, sub: `${activeLenders.length} active` },
          { label: 'Platform Status', value: 'Pilot', sub: 'on the XRP Ledger test network', color: 'var(--bc-gold-ink)' },
          { label: 'Loan Types', value: new Set(lenders.flatMap(l => l.loan_types || [])).size, sub: 'types offered' },
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
        ) : loadError ? (
          <div className="p-8 text-center text-sm" style={{ color: '#c0392b' }}>{loadError}</div>
        ) : lenders.length === 0 ? (
          <div className="px-5 py-16 text-center">
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
                  {['Lender', 'Contact', 'Loan Types', 'Max LTV', 'Status', 'Account', ''].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--bc-muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lenders.map(l => (
                  <tr key={l.id} className="border-b last:border-0 hover:bg-slate-900/[0.02] align-top" style={{ borderColor: '#edf0f4' }}>
                    <td className="px-4 py-3">
                      <div className="font-semibold">{l.company_name}</div>
                      <div className="text-xs mt-0.5" style={{ color: 'var(--bc-muted)' }}>{l.email || 'No email on record'}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div>{l.contact_name || '—'}</div>
                      <div className="text-xs mt-0.5" style={{ color: 'var(--bc-muted)' }}>{l.phone || ''}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {l.loan_types && l.loan_types.length > 0 ? l.loan_types.map(t => (
                          <span key={t} className="text-xs px-2 py-0.5 rounded" style={{ background: 'rgba(45,125,210,0.15)', color: 'var(--bc-blue)' }}>{t}</span>
                        )) : <span style={{ color: 'var(--bc-muted)' }}>—</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3">{l.max_ltv ? `${l.max_ltv}%` : '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`badge ${l.active ? 'badge-green' : 'badge-gray'}`}>{l.active ? 'Active' : 'Inactive'}</span>
                    </td>
                    <td className="px-4 py-3">
                      {l.profile_id ? (
                        <div>
                          <div className="text-xs font-semibold" style={{ color: '#15803d' }}>
                            Linked to {l.account_email || 'an account'}
                          </div>
                          <button onClick={() => unlink(l)} disabled={busy === l.id + 'unlink'}
                            className="text-xs font-semibold hover:underline mt-1" style={{ color: '#c0392b' }}>
                            {busy === l.id + 'unlink' ? 'Unlinking…' : 'Unlink'}
                          </button>
                        </div>
                      ) : (
                        <div>
                          <div className="text-xs font-semibold mb-1.5" style={{ color: 'var(--bc-muted)' }}>No account linked</div>
                          <div className="flex flex-wrap gap-1.5">
                            <button onClick={() => sendInvite(l)} disabled={busy === l.id + 'invite'}
                              className={linkBtn}
                              style={{ background: 'rgba(201,164,87,0.15)', color: 'var(--bc-gold-ink)' }}>
                              {busy === l.id + 'invite' ? 'Sending…' : 'Send invitation'}
                            </button>
                            <button onClick={() => setLinking(l)}
                              className={`${linkBtn} border`}
                              style={{ borderColor: 'var(--bc-border)', color: 'var(--bc-text)' }}>
                              Link an existing account
                            </button>
                          </div>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <button onClick={() => setEditing({ lender: l })}
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
