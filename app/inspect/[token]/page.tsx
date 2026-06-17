'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'

interface InspectionData {
  id: string
  token: string
  status: 'pending' | 'passed' | 'failed' | 'cancelled'
  notes: string | null
  submitted_at: string | null
  scheduled_date: string | null
  inspector_name: string
  inspector_email: string
  draw_requests: {
    request_number: string
    amount: number
    phase: string | null
    purpose: string | null
    description: string | null
  } | null
  projects: {
    name: string
    address: string | null
    city: string | null
    state: string | null
    zip: string | null
  } | null
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
}

export default function InspectorPortal() {
  const params = useParams()
  const token = params.token as string

  const [inspection, setInspection] = useState<InspectionData | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  const [result, setResult] = useState<'passed' | 'failed' | ''>('')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch(`/api/inspections/${token}`)
      .then(r => r.json())
      .then(json => {
        if (json.error) { setNotFound(true); return }
        setInspection(json.data)
        if (json.data.notes) setNotes(json.data.notes)
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false))
  }, [token])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!result) { setError('Please select Pass or Fail'); return }
    setSubmitting(true)
    setError('')

    const res = await fetch(`/api/inspections/${token}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: result, notes }),
    })
    const json = await res.json()

    if (!res.ok) {
      setError(json.error ?? 'Submission failed')
      setSubmitting(false)
      return
    }

    setSubmitted(true)
    setInspection(prev => prev ? { ...prev, status: result as 'passed' | 'failed', submitted_at: new Date().toISOString(), notes } : prev)
  }

  const navy = '#0d1b2a'
  const card = '#111e2d'
  const border = '#1e3a50'
  const muted = '#6b8198'
  const gold = '#c9a84c'
  const text = '#e8edf2'

  if (loading) return (
    <div style={{ minHeight: '100vh', background: navy, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ color: muted, fontSize: 14 }}>Loading inspection…</div>
    </div>
  )

  if (notFound) return (
    <div style={{ minHeight: '100vh', background: navy, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ textAlign: 'center', maxWidth: 400 }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🔍</div>
        <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8, color: text }}>Inspection Not Found</div>
        <div style={{ color: muted, fontSize: 14 }}>This link may have expired or is invalid. Contact the admin who sent you this link.</div>
      </div>
    </div>
  )

  if (!inspection) return null

  const project = inspection.projects
  const draw = inspection.draw_requests
  const isAlreadyDone = inspection.status !== 'pending'

  return (
    <div style={{ minHeight: '100vh', background: navy, color: text, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      {/* Header */}
      <header style={{ background: card, borderBottom: `1px solid ${border}`, padding: '0 24px', height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: gold, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 13, color: navy }}>BC</div>
          <span style={{ fontWeight: 700, fontSize: 15 }}>Build<span style={{ color: gold }}>Chain</span></span>
          <span style={{ color: muted, fontSize: 12, marginLeft: 4 }}>· Inspector Portal</span>
        </div>
        <span style={{ fontSize: 12, color: muted }}>Secure link — no login required</span>
      </header>

      <div style={{ maxWidth: 640, margin: '0 auto', padding: '32px 24px' }}>

        {/* Project card */}
        <div style={{ background: card, border: `1px solid ${border}`, borderRadius: 12, padding: '20px 24px', marginBottom: 24 }}>
          <div style={{ fontSize: 11, color: muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
            Inspection Assignment
          </div>
          <div style={{ fontWeight: 800, fontSize: 20, marginBottom: 4 }}>{project?.name ?? '—'}</div>
          {project?.address && (
            <div style={{ color: muted, fontSize: 13, marginBottom: 12 }}>
              📍 {[project.address, project.city, project.state, project.zip].filter(Boolean).join(', ')}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginTop: 16 }}>
            {[
              { label: 'Draw #', value: draw?.request_number ?? '—' },
              { label: 'Draw Amount', value: draw?.amount ? formatCurrency(draw.amount) : '—' },
              { label: 'Phase', value: draw?.phase || draw?.purpose || '—' },
              { label: 'Scheduled', value: inspection.scheduled_date ? new Date(inspection.scheduled_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'TBD' },
            ].map(({ label, value }) => (
              <div key={label} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '10px 12px', border: `1px solid ${border}` }}>
                <div style={{ fontSize: 10, color: muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 3 }}>{label}</div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{value}</div>
              </div>
            ))}
          </div>

          {inspection.inspector_name && (
            <div style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${border}`, display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(201,168,76,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 12, color: gold }}>
                {inspection.inspector_name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{inspection.inspector_name}</div>
                <div style={{ color: muted, fontSize: 11 }}>{inspection.inspector_email}</div>
              </div>
            </div>
          )}
        </div>

        {/* Already submitted */}
        {(isAlreadyDone || submitted) && (
          <div style={{
            background: inspection.status === 'passed' ? 'rgba(46,204,113,0.08)' : 'rgba(231,76,60,0.08)',
            border: `1px solid ${inspection.status === 'passed' ? 'rgba(46,204,113,0.3)' : 'rgba(231,76,60,0.3)'}`,
            borderRadius: 12, padding: '24px', textAlign: 'center',
          }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>
              {inspection.status === 'passed' ? '✅' : '❌'}
            </div>
            <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 4 }}>
              Inspection {inspection.status === 'passed' ? 'Passed' : 'Failed'}
            </div>
            {submitted && (
              <div style={{ color: muted, fontSize: 13, marginBottom: 12 }}>Your report has been submitted and the project team has been notified.</div>
            )}
            {inspection.notes && (
              <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: '12px 16px', textAlign: 'left', marginTop: 12 }}>
                <div style={{ fontSize: 11, color: muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Inspector Notes</div>
                <div style={{ fontSize: 13, lineHeight: 1.6 }}>{inspection.notes}</div>
              </div>
            )}
            {inspection.submitted_at && (
              <div style={{ color: muted, fontSize: 11, marginTop: 12 }}>
                Submitted {new Date(inspection.submitted_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
              </div>
            )}
          </div>
        )}

        {/* Submit form — only shown when status is pending and not yet submitted */}
        {!isAlreadyDone && !submitted && (
          <form onSubmit={handleSubmit}>
            <div style={{ background: card, border: `1px solid ${border}`, borderRadius: 12, padding: '24px', marginBottom: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Submit Inspection Report</div>
              <div style={{ color: muted, fontSize: 13, marginBottom: 20 }}>
                After completing your on-site inspection, record your findings below.
              </div>

              {/* Pass / Fail */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 11, color: muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
                  Inspection Result *
                </div>
                <div style={{ display: 'flex', gap: 12 }}>
                  {(['passed', 'failed'] as const).map(r => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setResult(r)}
                      style={{
                        flex: 1,
                        padding: '14px 16px',
                        borderRadius: 10,
                        border: `2px solid ${result === r
                          ? r === 'passed' ? '#2ecc71' : '#e74c3c'
                          : border}`,
                        background: result === r
                          ? r === 'passed' ? 'rgba(46,204,113,0.1)' : 'rgba(231,76,60,0.1)'
                          : 'rgba(255,255,255,0.02)',
                        color: result === r
                          ? r === 'passed' ? '#2ecc71' : '#e74c3c'
                          : muted,
                        fontWeight: 700,
                        fontSize: 15,
                        cursor: 'pointer',
                        transition: 'all 0.15s',
                        textTransform: 'capitalize',
                      }}>
                      {r === 'passed' ? '✅ Pass' : '❌ Fail'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Notes */}
              <div>
                <label style={{ display: 'block', fontSize: 11, color: muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                  Inspector Notes {result === 'failed' ? '*' : '(optional)'}
                </label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  required={result === 'failed'}
                  rows={5}
                  placeholder={result === 'failed'
                    ? 'Describe what did not meet inspection requirements…'
                    : 'Add any relevant observations, photos references, or comments…'}
                  style={{
                    width: '100%', borderRadius: 8, padding: '12px 14px',
                    background: 'rgba(255,255,255,0.04)', border: `1px solid ${border}`,
                    color: text, fontSize: 13, outline: 'none', resize: 'vertical',
                    lineHeight: 1.6, boxSizing: 'border-box',
                  }}
                />
              </div>

              {error && (
                <div style={{ marginTop: 12, color: '#e74c3c', fontSize: 13 }}>⚠️ {error}</div>
              )}
            </div>

            <button
              type="submit"
              disabled={submitting || !result}
              style={{
                width: '100%', padding: '14px 24px', borderRadius: 10,
                background: !result || submitting ? 'rgba(201,168,76,0.4)' : gold,
                color: navy, fontWeight: 800, fontSize: 15, border: 'none',
                cursor: !result || submitting ? 'not-allowed' : 'pointer',
                transition: 'all 0.15s',
              }}>
              {submitting ? 'Submitting…' : 'Submit Inspection Report'}
            </button>

            <div style={{ textAlign: 'center', marginTop: 12, color: muted, fontSize: 12 }}>
              Once submitted, your report is final and will notify the project team immediately.
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
