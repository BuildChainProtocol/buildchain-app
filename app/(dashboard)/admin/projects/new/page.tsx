'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

interface Borrower { id: string; company_name: string; contact_name: string | null }
interface Lender { id: string; company_name: string; contact_name: string | null }

const PROPERTY_TYPES = [
  { value: 'single_family', label: 'Single Family Residential' },
  { value: 'multi_family', label: 'Multi-Family' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'mixed_use', label: 'Mixed Use' },
  { value: 'land', label: 'Land / Lot' },
  { value: 'industrial', label: 'Industrial' },
]

const US_STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY']

export default function NewProjectPage() {
  const router = useRouter()
  const [borrowers, setBorrowers] = useState<Borrower[]>([])
  const [lenders, setLenders] = useState<Lender[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    name: '',
    address: '',
    city: '',
    state: 'TX',
    zip: '',
    property_type: 'single_family',
    borrower_id: '',
    lender_id: '',
    loan_amount: '',
    appraised_value: '',
    interest_rate: '',
    maturity_date: '',
    stage: 'review',
    notes: '',
  })

  useEffect(() => {
    Promise.all([
      fetch('/api/borrowers').then(r => r.json()),
      fetch('/api/lenders').then(r => r.json()),
    ]).then(([b, l]) => {
      setBorrowers(b.data || [])
      setLenders(l.data || [])
    })
  }, [])

  const set = (field: string, value: string) => setForm(f => ({ ...f, [field]: value }))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    if (!form.borrower_id || !form.lender_id) {
      setError('Please select both a borrower and a lender.')
      setLoading(false)
      return
    }

    const payload = {
      ...form,
      loan_amount: parseFloat(form.loan_amount.replace(/,/g, '')),
      appraised_value: form.appraised_value ? parseFloat(form.appraised_value.replace(/,/g, '')) : null,
      interest_rate: form.interest_rate ? parseFloat(form.interest_rate) : null,
      maturity_date: form.maturity_date || null,
      amount_drawn: 0,
      ltv: form.appraised_value ? Math.round(parseFloat(form.loan_amount.replace(/,/g, '')) / parseFloat(form.appraised_value.replace(/,/g, '')) * 100) : null,
    }

    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    const json = await res.json()
    if (!res.ok) {
      setError(json.error || 'Failed to create project')
      setLoading(false)
      return
    }

    router.push(`/admin/projects/${json.data.id}`)
  }

  const inputClass = "w-full rounded-lg px-3 py-2.5 text-sm outline-none transition-colors"
  const inputStyle = { background: 'rgba(255,255,255,0.05)', border: '1px solid var(--bc-border)', color: '#e8edf2' }
  const labelClass = "block text-xs font-semibold uppercase tracking-wide mb-1.5"
  const labelStyle = { color: 'var(--bc-muted)' }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => router.back()} className="text-sm hover:underline" style={{ color: 'var(--bc-muted)' }}>
          ← Projects
        </button>
        <span style={{ color: 'var(--bc-border)' }}>/</span>
        <span className="text-sm font-semibold">New Project</span>
      </div>

      <div className="mb-6">
        <h1 className="text-2xl font-bold">Create New Project</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--bc-muted)' }}>
          Set up a new construction loan project. A loan number will be generated automatically.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">

        {/* Project Info */}
        <div className="rounded-xl border p-6" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
          <h2 className="text-sm font-bold uppercase tracking-wide mb-4" style={{ color: 'var(--bc-muted)' }}>Project Information</h2>
          <div className="space-y-4">
            <div>
              <label className={labelClass} style={labelStyle}>Project Name *</label>
              <input required value={form.name} onChange={e => set('name', e.target.value)}
                placeholder="e.g. Austin Heights Townhomes — Unit 3"
                className={inputClass} style={inputStyle} />
            </div>
            <div>
              <label className={labelClass} style={labelStyle}>Property Type *</label>
              <select required value={form.property_type} onChange={e => set('property_type', e.target.value)}
                className={inputClass} style={inputStyle}>
                {PROPERTY_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass} style={labelStyle}>Street Address *</label>
              <input required value={form.address} onChange={e => set('address', e.target.value)}
                placeholder="123 Main Street"
                className={inputClass} style={inputStyle} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="col-span-1">
                <label className={labelClass} style={labelStyle}>City *</label>
                <input required value={form.city} onChange={e => set('city', e.target.value)}
                  placeholder="Austin"
                  className={inputClass} style={inputStyle} />
              </div>
              <div>
                <label className={labelClass} style={labelStyle}>State</label>
                <select value={form.state} onChange={e => set('state', e.target.value)}
                  className={inputClass} style={inputStyle}>
                  {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className={labelClass} style={labelStyle}>ZIP Code</label>
                <input value={form.zip} onChange={e => set('zip', e.target.value)}
                  placeholder="78701"
                  className={inputClass} style={inputStyle} />
              </div>
            </div>
            <div>
              <label className={labelClass} style={labelStyle}>Notes</label>
              <textarea value={form.notes} onChange={e => set('notes', e.target.value)}
                rows={3} placeholder="Any additional notes about this project..."
                className={inputClass} style={{ ...inputStyle, resize: 'none' }} />
            </div>
          </div>
        </div>

        {/* Parties */}
        <div className="rounded-xl border p-6" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
          <h2 className="text-sm font-bold uppercase tracking-wide mb-4" style={{ color: 'var(--bc-muted)' }}>Parties</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelClass} style={labelStyle}>Borrower *</label>
              <select required value={form.borrower_id} onChange={e => set('borrower_id', e.target.value)}
                className={inputClass} style={inputStyle}>
                <option value="">Select borrower…</option>
                {borrowers.map(b => (
                  <option key={b.id} value={b.id}>{b.company_name}{b.contact_name ? ` (${b.contact_name})` : ''}</option>
                ))}
              </select>
              {borrowers.length === 0 && (
                <p className="text-xs mt-1" style={{ color: '#e74c3c' }}>No borrowers found — add one first in the Borrowers tab.</p>
              )}
            </div>
            <div>
              <label className={labelClass} style={labelStyle}>Lender *</label>
              <select required value={form.lender_id} onChange={e => set('lender_id', e.target.value)}
                className={inputClass} style={inputStyle}>
                <option value="">Select lender…</option>
                {lenders.map(l => (
                  <option key={l.id} value={l.id}>{l.company_name}{l.contact_name ? ` (${l.contact_name})` : ''}</option>
                ))}
              </select>
              {lenders.length === 0 && (
                <p className="text-xs mt-1" style={{ color: '#e74c3c' }}>No lenders found — add one first in the Lenders tab.</p>
              )}
            </div>
          </div>
        </div>

        {/* Loan Terms */}
        <div className="rounded-xl border p-6" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
          <h2 className="text-sm font-bold uppercase tracking-wide mb-4" style={{ color: 'var(--bc-muted)' }}>Loan Terms</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelClass} style={labelStyle}>Loan Amount (USD) *</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: 'var(--bc-muted)' }}>$</span>
                <input required type="number" min="1" step="any"
                  value={form.loan_amount} onChange={e => set('loan_amount', e.target.value)}
                  placeholder="2500000"
                  className={inputClass} style={{ ...inputStyle, paddingLeft: '1.5rem' }} />
              </div>
            </div>
            <div>
              <label className={labelClass} style={labelStyle}>Appraised Value (USD)</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: 'var(--bc-muted)' }}>$</span>
                <input type="number" min="1" step="any"
                  value={form.appraised_value} onChange={e => set('appraised_value', e.target.value)}
                  placeholder="3200000"
                  className={inputClass} style={{ ...inputStyle, paddingLeft: '1.5rem' }} />
              </div>
            </div>
            <div>
              <label className={labelClass} style={labelStyle}>Interest Rate (%)</label>
              <div className="relative">
                <input type="number" min="0" max="100" step="0.01"
                  value={form.interest_rate} onChange={e => set('interest_rate', e.target.value)}
                  placeholder="9.50"
                  className={inputClass} style={{ ...inputStyle, paddingRight: '2rem' }} />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: 'var(--bc-muted)' }}>%</span>
              </div>
            </div>
            <div>
              <label className={labelClass} style={labelStyle}>Maturity Date</label>
              <input type="date" value={form.maturity_date} onChange={e => set('maturity_date', e.target.value)}
                className={inputClass} style={inputStyle} />
            </div>
            <div>
              <label className={labelClass} style={labelStyle}>Initial Stage</label>
              <select value={form.stage} onChange={e => set('stage', e.target.value)}
                className={inputClass} style={inputStyle}>
                <option value="application">Application</option>
                <option value="review">In Review</option>
                <option value="approved">Approved</option>
                <option value="active">Active Build</option>
              </select>
            </div>
            {form.loan_amount && form.appraised_value && (
              <div className="flex items-end pb-1">
                <div className="rounded-lg px-4 py-2.5 text-sm w-full" style={{ background: 'rgba(243,156,18,0.1)', border: '1px solid rgba(243,156,18,0.3)' }}>
                  <span style={{ color: 'var(--bc-muted)' }}>LTV: </span>
                  <span className="font-bold" style={{ color: 'var(--bc-gold)' }}>
                    {Math.round(parseFloat(form.loan_amount) / parseFloat(form.appraised_value) * 100)}%
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        {error && (
          <div className="rounded-lg p-4 text-sm border" style={{ background: 'rgba(231,76,60,0.1)', borderColor: 'rgba(231,76,60,0.3)', color: '#e74c3c' }}>
            {error}
          </div>
        )}

        <div className="flex gap-3 pb-8">
          <button type="submit" disabled={loading}
            className="px-6 py-2.5 rounded-lg text-sm font-bold transition-all"
            style={{ background: 'var(--bc-gold)', color: 'var(--bc-dark)', opacity: loading ? 0.7 : 1 }}>
            {loading ? 'Creating Project…' : 'Create Project'}
          </button>
          <button type="button" onClick={() => router.back()}
            className="px-5 py-2.5 rounded-lg text-sm font-semibold border transition-all"
            style={{ borderColor: 'var(--bc-border)', color: 'var(--bc-muted)' }}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
