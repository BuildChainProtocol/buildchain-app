'use client'

import { useCallback, useEffect, useState } from 'react'
import { FileText } from 'lucide-react'

interface Terms { version: string; rate: string; points: string[] }
interface LenderTerms {
  companyName: string | null
  legalName: string
  billingEmail: string
  billingAddress: string
  accepted: boolean
  acceptedAt: string | null
  acceptedOlderVersion: string | null
}

const longDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
const label = 'text-[10px] font-semibold uppercase tracking-[0.12em]'
const field = 'mt-1 w-full rounded-lg px-3 py-2 text-sm border'
const fieldStyle = { borderColor: 'var(--bc-border)', background: 'var(--bc-card)', color: 'var(--bc-text)' }

/**
 * The protocol fee terms and the lender's agreement to them. The sentences
 * shown are the terms themselves, exactly as the server sends them.
 */
export default function FeeTermsCard() {
  const [terms, setTerms] = useState<Terms | null>(null)
  const [lender, setLender] = useState<LenderTerms | null>(null)
  const [loadError, setLoadError] = useState('')
  const [legalName, setLegalName] = useState('')
  const [billingEmail, setBillingEmail] = useState('')
  const [billingAddress, setBillingAddress] = useState('')
  const [accept, setAccept] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [showTerms, setShowTerms] = useState(false)

  const load = useCallback(async () => {
    let res: Response
    try { res = await fetch('/api/fees/terms') } catch { setLoadError('The fee terms could not be loaded. Check your connection and reload the page.'); return }
    const json = await res.json().catch(() => ({}))
    if (!res.ok) { setLoadError(json.error || `The fee terms could not be loaded (${res.status})`); return }
    setLoadError('')
    setTerms(json.terms ?? null)
    const l: LenderTerms | null = json.lender ?? null
    setLender(l)
    if (l) {
      setLegalName(l.legalName ?? '')
      setBillingEmail(l.billingEmail ?? '')
      setBillingAddress(l.billingAddress ?? '')
    }
  }, [])
  useEffect(() => { load() }, [load])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true); setError('')
    let res: Response
    try {
      res = await fetch('/api/fees/terms', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accept, legal_name: legalName, billing_email: billingEmail, billing_address: billingAddress }),
      })
    } catch { setBusy(false); setError('Your acceptance was not saved. Check your connection and try again.'); return }
    const json = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setError(json.error || `Your acceptance was not saved (${res.status})`); return }
    setLender(l => l && {
      ...l, legalName: legalName.trim(), billingEmail: billingEmail.trim(), billingAddress: billingAddress.trim(),
      accepted: true, acceptedAt: json.acceptedAt ?? new Date().toISOString(), acceptedOlderVersion: null,
    })
    setShowTerms(false)
  }

  if (loadError) {
    return (
      <div className="rounded-lg border px-4 py-3 mb-6 text-sm" style={{ borderColor: 'rgba(192,57,43,0.3)', background: 'rgba(192,57,43,0.06)', color: '#c0392b' }}>
        {loadError}
      </div>
    )
  }
  // An admin reviewing this page, or an account with no lender record, sees nothing.
  if (!terms || !lender) return null

  const points = (
    <ol className="list-decimal pl-5 space-y-2 text-sm" style={{ color: 'var(--bc-text)' }}>
      {terms.points.map((p, i) => <li key={i} className="pl-1">{p}</li>)}
    </ol>
  )

  if (lender.accepted) {
    return (
      <div className="rounded-lg border mb-6" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
        <div className="px-5 py-4 flex flex-wrap items-center gap-4">
          <FileText size={20} style={{ color: 'var(--bc-gold-ink)' }} />
          <div className="flex-1 min-w-[220px]">
            <div className={label} style={{ color: 'var(--bc-muted)' }}>Fee terms accepted</div>
            <div className="text-sm mt-0.5" style={{ color: 'var(--bc-text)' }}>
              {lender.acceptedAt ? `Accepted ${longDate(lender.acceptedAt)}. ` : ''}
              The protocol fee is {terms.rate} of each amount released to a payee. The first draw released for you is free.
            </div>
            <div className="text-xs mt-1" style={{ color: 'var(--bc-muted)' }}>No fee is charged during the pilot on the test network.</div>
          </div>
          <button type="button" onClick={() => setShowTerms(v => !v)} aria-expanded={showTerms}
            className="px-4 py-2 rounded-lg text-sm font-bold border" style={{ borderColor: 'var(--bc-border)', color: 'var(--bc-text)' }}>
            {showTerms ? 'Hide terms' : 'View terms'}
          </button>
        </div>
        {showTerms && (
          <div className="px-5 py-4 border-t" style={{ borderColor: 'var(--bc-border)' }}>
            <div className={`${label} mb-3`} style={{ color: 'var(--bc-muted)' }}>Protocol fee terms, version {terms.version}</div>
            {points}
          </div>
        )}
      </div>
    )
  }

  const who = legalName.trim() || lender.companyName || 'your company'
  return (
    <div className="rounded-lg border mb-6" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
      <div className="px-6 py-4 border-b" style={{ borderColor: 'var(--bc-border)' }}>
        <h3 className="uppercase">Protocol fee terms</h3>
        <div className="mt-1 text-sm" style={{ color: 'var(--bc-muted)' }}>
          Version {terms.version}. No fee can be due from you until you accept these terms.
        </div>
      </div>

      {lender.acceptedOlderVersion && (
        <div className="px-6 py-3 border-b text-sm" style={{ borderColor: 'var(--bc-border)', background: 'var(--bc-page)', color: 'var(--bc-text)' }}>
          You accepted an earlier version ({lender.acceptedOlderVersion}). Please review and accept the current terms.
        </div>
      )}

      <div className="px-6 py-5 border-b" style={{ borderColor: 'var(--bc-border)' }}>
        {points}
        <div className="mt-4 text-sm" style={{ color: 'var(--bc-muted)' }}>No fee is charged during the pilot on the test network.</div>
      </div>

      <form onSubmit={submit} className="px-6 py-5">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="fee-legal-name" className={label} style={{ color: 'var(--bc-muted)' }}>Legal name</label>
            <input id="fee-legal-name" type="text" value={legalName} maxLength={200} onChange={e => setLegalName(e.target.value)}
              autoComplete="organization" className={field} style={fieldStyle} />
          </div>
          <div>
            <label htmlFor="fee-billing-email" className={label} style={{ color: 'var(--bc-muted)' }}>Billing email</label>
            <input id="fee-billing-email" type="email" value={billingEmail} maxLength={200} onChange={e => setBillingEmail(e.target.value)}
              autoComplete="email" className={field} style={fieldStyle} />
          </div>
          <div className="md:col-span-2">
            <label htmlFor="fee-billing-address" className={label} style={{ color: 'var(--bc-muted)' }}>Billing address</label>
            <textarea id="fee-billing-address" rows={3} value={billingAddress} maxLength={600} onChange={e => setBillingAddress(e.target.value)}
              autoComplete="street-address" className={field} style={fieldStyle} />
          </div>
        </div>

        <label className="mt-4 flex items-start gap-2.5 text-sm cursor-pointer" style={{ color: 'var(--bc-text)' }}>
          <input type="checkbox" checked={accept} onChange={e => setAccept(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0 break-words">I accept these fee terms on behalf of {who}</span>
        </label>

        {error && <div className="mt-3 text-sm" role="alert" style={{ color: '#c0392b' }}>{error}</div>}

        <button type="submit" disabled={busy || !accept}
          className="mt-4 px-4 py-2 rounded-lg text-sm font-bold disabled:opacity-50" style={{ background: 'var(--bc-gold)', color: 'var(--bc-dark)' }}>
          {busy ? 'Saving…' : 'Accept fee terms'}
        </button>
      </form>
    </div>
  )
}
