'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { formatCurrency } from '@/lib/utils'

interface Project {
  id: string
  name: string
  loan_amount: number
  amount_drawn: number
  loan_number: string | null
  stage: string
  retainage_rate?: number
}

interface BudgetLine {
  id: string
  line_no: string
  description: string
  scheduled_value: number
  trade: string | null
}

interface DrawLine {
  budget_line_item_id: string
  scheduled_value: number
  work_completed_prev: number
  work_completed_period: string  // user input — string to allow empty
  materials_stored: string
}

interface LienWaiverEntry {
  sub_name: string
  sub_code: string
  trade: string
  waiver_type: string
  through_amount: string
  signed_by: string
}

const WAIVER_TYPES = [
  { value: 'conditional_partial', label: 'Conditional Partial' },
  { value: 'conditional_final', label: 'Conditional Final' },
  { value: 'unconditional_partial', label: 'Unconditional Partial' },
  { value: 'unconditional_final', label: 'Unconditional Final' },
]

// Totals are shown to the cent, so the contractor sees exactly the figures the server stores
const money = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)

const emptyWaiver: LienWaiverEntry = { sub_name: '', sub_code: '', trade: '', waiver_type: 'conditional_partial', through_amount: '', signed_by: '' }

export default function SubmitDrawPage() {
  const router = useRouter()
  const [projects, setProjects] = useState<Project[]>([])
  const [budgetLines, setBudgetLines] = useState<BudgetLine[]>([])
  const [drawLines, setDrawLines] = useState<Record<string, DrawLine>>({})
  const [lienWaivers, setLienWaivers] = useState<LienWaiverEntry[]>([])
  const [files, setFiles] = useState<File[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingSOV, setLoadingSOV] = useState(false)
  const [success, setSuccess] = useState(false)
  const [hasSov, setHasSov] = useState(false)
  const [submitError, setSubmitError] = useState('')
  // The draw was submitted, but some of what goes with it was not saved
  const [partialErrors, setPartialErrors] = useState<string[]>([])
  const [form, setForm] = useState({
    project_id: '', amount: '', phase: '', description: '',
  })

  // Load projects
  useEffect(() => {
    fetch('/api/projects').then(r => r.json()).then(d => {
      const active = (d.data || []).filter((p: Project) => ['active', 'approved'].includes(p.stage))
      setProjects(active)
      if (active.length > 0) setForm(f => ({ ...f, project_id: active[0].id }))
    })
  }, [])

  // Load SOV when project changes
  useEffect(() => {
    if (!form.project_id) return
    setLoadingSOV(true)
    setBudgetLines([])
    setDrawLines({})
    fetch(`/api/budget-lines?project_id=${form.project_id}`)
      .then(r => r.json())
      .then(d => {
        const lines: BudgetLine[] = d.data || []
        setBudgetLines(lines)
        setHasSov(lines.length > 0)
        // Initialize draw lines map
        const init: Record<string, DrawLine> = {}
        lines.forEach(l => {
          init[l.id] = { budget_line_item_id: l.id, scheduled_value: l.scheduled_value, work_completed_prev: 0, work_completed_period: '', materials_stored: '' }
        })
        setDrawLines(init)
        setLoadingSOV(false)
      })
  }, [form.project_id])

  const selectedProject = projects.find(p => p.id === form.project_id)
  const available = selectedProject ? selectedProject.loan_amount - selectedProject.amount_drawn : 0
  // The server (POST /api/draw-lines) treats a missing or zero rate as 10%, so this page does too.
  const retainageRate = Number(selectedProject?.retainage_rate) || 0.10
  const round2 = (n: number) => Math.round(n * 100) / 100

  // Compute G703 totals from draw lines, with the same formula the server uses
  // when it recomputes the draw: retainage = round(period x rate, 2), payment
  // due = period - retainage. Stored materials are recorded on the line but are
  // not part of this draw's payment.
  const lineEntries = budgetLines.map(bl => {
    const dl = drawLines[bl.id] || { work_completed_prev: 0, work_completed_period: '', materials_stored: '' }
    const period = parseFloat(dl.work_completed_period as string) || 0
    const stored = parseFloat(dl.materials_stored as string) || 0
    const prev = dl.work_completed_prev || 0
    const total = prev + period + stored
    const pct = bl.scheduled_value > 0 ? (total / bl.scheduled_value) * 100 : 0
    const retainage = round2(period * retainageRate)
    const due = round2(period - retainage)
    return { ...bl, period, stored, prev, total, pct, retainage, due }
  })

  const totalRetainage = round2(lineEntries.reduce((s, l) => s + l.retainage, 0))
  const totalNet = round2(lineEntries.reduce((s, l) => s + l.due, 0))
  const totalGross = round2(totalNet + totalRetainage)
  const totalStored = lineEntries.reduce((s, l) => s + l.stored, 0)
  const hasLineItems = lineEntries.some(l => l.period > 0 || l.stored > 0)
  // A draw needs work this period: stored materials alone are not paid in a draw
  const hasPeriodWork = totalGross > 0

  // Simple form mode: amount check
  const simpleAmount = parseFloat(form.amount) || 0
  const overLimit = !hasSov && simpleAmount > available

  function updateDrawLine(budgetLineId: string, field: 'work_completed_period' | 'materials_stored', value: string) {
    setDrawLines(prev => ({
      ...prev,
      [budgetLineId]: { ...prev[budgetLineId], [field]: value }
    }))
  }

  function addWaiver() { setLienWaivers(w => [...w, { ...emptyWaiver }]) }
  function removeWaiver(i: number) { setLienWaivers(w => w.filter((_, idx) => idx !== i)) }
  function updateWaiver(i: number, field: keyof LienWaiverEntry, value: string) {
    setLienWaivers(w => w.map((wv, idx) => idx === i ? { ...wv, [field]: value } : wv))
  }

  // Reads a failed response's { error } (or falls back to the status code)
  async function errorOf(res: Response): Promise<string> {
    const json = await res.json().catch(() => ({}))
    return (json && typeof json.error === 'string' && json.error) || `the server answered ${res.status}`
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (overLimit) return
    setLoading(true)
    setSubmitError('')
    setPartialErrors([])

    try {
      // Step 1: Create the draw request
      const drawAmount = hasSov ? totalGross : simpleAmount
      const res = await fetch('/api/draws', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: form.project_id,
          amount: drawAmount,
          phase: form.phase || 'Multi-phase',
          purpose: form.description || 'Draw request',
          description: form.description,
          retainage_rate: retainageRate,
          retainage_held: hasSov ? totalRetainage : 0,
          net_amount: hasSov ? totalNet : drawAmount,
        }),
      })

      if (!res.ok) {
        setSubmitError(`The draw request was not submitted: ${await errorOf(res)}`)
        setLoading(false)
        return
      }
      const { data: draw } = await res.json()

      // The draw now exists. Anything below that fails is reported, not hidden.
      const problems: string[] = []

      // Step 2: Save draw line items if SOV exists
      if (hasSov && hasLineItems) {
        const lines = lineEntries
          .filter(l => l.period > 0 || l.stored > 0)
          .map(l => ({
            budget_line_item_id: l.id,
            scheduled_value: l.scheduled_value,
            work_completed_prev: l.prev,
            work_completed_period: l.period,
            materials_stored: l.stored,
          }))
        const linesRes = await fetch('/api/draw-lines', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ draw_request_id: draw.id, lines }),
        })
        if (!linesRes.ok) problems.push(`The line items were not saved: ${await errorOf(linesRes)}`)
      }

      // Step 3: Save lien waivers
      const waiverResults = await Promise.all(lienWaivers.filter(w => w.sub_name).map(async w => {
        const r = await fetch('/api/lien-waivers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            project_id: form.project_id,
            draw_request_id: draw.id,
            ...w,
            through_amount: parseFloat(w.through_amount) || 0,
          }),
        })
        return r.ok ? '' : `The lien waiver for ${w.sub_name} was not saved: ${await errorOf(r)}`
      }))
      problems.push(...waiverResults.filter(Boolean))

      // Step 4: Upload supporting documents
      if (files.length > 0 && draw?.id) {
        const fileResults = await Promise.all(files.map(async file => {
          const fd = new FormData()
          fd.append('file', file)
          fd.append('project_id', form.project_id)
          fd.append('draw_request_id', draw.id)
          const r = await fetch('/api/documents', { method: 'POST', body: fd })
          return r.ok ? '' : `${file.name} was not uploaded: ${await errorOf(r)}`
        }))
        problems.push(...fileResults.filter(Boolean))
      }

      setSuccess(true)
      if (problems.length > 0) {
        // Stay on the page so the contractor can read what is missing
        setPartialErrors(problems)
      } else {
        setTimeout(() => router.push('/borrower'), 2000)
      }
    } catch {
      setSubmitError('The server could not be reached. Check your connection, then look at your draw list before trying again: the draw may already have been submitted.')
    }
    setLoading(false)
  }

  const inputStyle = {
    background: 'rgba(13,27,42,0.05)',
    border: '1px solid var(--bc-border)',
    color: 'var(--bc-text)',
  }

  if (success) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center max-w-lg">
          <h2 className="text-xl font-bold mb-2">Draw request submitted</h2>
          {partialErrors.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--bc-muted)' }}>Your lender has been notified. Redirecting…</p>
          ) : (
            <>
              <p className="text-sm mb-3" style={{ color: 'var(--bc-muted)' }}>
                The draw reached your lender, but not everything that goes with it was saved:
              </p>
              <div className="rounded-xl border p-4 text-sm text-left space-y-1.5"
                style={{ background: 'rgba(231,76,60,0.06)', borderColor: 'rgba(231,76,60,0.3)', color: '#c0392b' }}>
                {partialErrors.map((p, i) => <div key={i}>{p}</div>)}
              </div>
              <p className="text-sm mt-3" style={{ color: 'var(--bc-muted)' }}>
                Do not submit the draw again. Tell your lender what is missing so it can be added.
              </p>
              <button type="button" onClick={() => router.push('/borrower')}
                className="mt-4 px-5 py-2.5 rounded-lg text-sm font-bold"
                style={{ background: 'var(--bc-gold)', color: 'var(--bc-dark)' }}>
                Go to my draws
              </button>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Submit Draw Request</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--bc-muted)' }}>Request a construction loan disbursement</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">

        {/* Project selector */}
        <div className="rounded-xl border p-5" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
          <label className="block text-xs font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--bc-muted)' }}>Project</label>
          <select value={form.project_id} onChange={e => setForm(f => ({ ...f, project_id: e.target.value }))} required
            className="w-full rounded-lg px-3 py-2.5 text-sm outline-none"
            style={{ ...inputStyle, borderRadius: '0.5rem', padding: '0.625rem 0.75rem' }}>
            {projects.map(p => (
              <option key={p.id} value={p.id} style={{ background: 'var(--bc-navy)' }}>
                {p.name} — {p.loan_number} ({formatCurrency(p.loan_amount - p.amount_drawn)} available)
              </option>
            ))}
            {projects.length === 0 && <option disabled>No active projects</option>}
          </select>
        </div>

        {/* G703 Line Items — shown when SOV exists */}
        {loadingSOV && (
          <div className="rounded-xl border p-5 text-center text-sm" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)', color: 'var(--bc-muted)' }}>
            Loading budget lines…
          </div>
        )}

        {!loadingSOV && hasSov && (
          <div className="rounded-xl border overflow-hidden" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
            <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--bc-border)' }}>
              <div>
                <h2 className="font-bold text-sm">G703 — Schedule of Values</h2>
                <p className="text-xs mt-0.5" style={{ color: 'var(--bc-muted)' }}>Enter amount earned this period per line item. Retainage ({Math.round(retainageRate * 100)}%) is auto-calculated.</p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead style={{ background: 'rgba(13,27,42,0.03)' }}>
                  <tr style={{ borderBottom: '1px solid var(--bc-border)', color: 'var(--bc-muted)' }}>
                    <th className="text-left px-4 py-2.5 font-semibold w-10">#</th>
                    <th className="text-left px-2 py-2.5 font-semibold">Description</th>
                    <th className="text-right px-2 py-2.5 font-semibold">Scheduled Value</th>
                    <th className="text-right px-2 py-2.5 font-semibold w-28">This Period ($)</th>
                    <th className="text-right px-2 py-2.5 font-semibold w-28">Materials Stored ($)</th>
                    <th className="text-right px-2 py-2.5 font-semibold">% Complete</th>
                    <th className="text-right px-4 py-2.5 font-semibold">Net Due</th>
                  </tr>
                </thead>
                <tbody>
                  {lineEntries.map(line => (
                    <tr key={line.id} style={{ borderBottom: '1px solid rgba(13,27,42,0.04)' }}>
                      <td className="px-4 py-2.5 font-mono" style={{ color: 'var(--bc-muted)' }}>{line.line_no}</td>
                      <td className="px-2 py-2.5">
                        <div className="font-medium">{line.description}</div>
                        {line.trade && <div className="text-xs mt-0.5" style={{ color: 'var(--bc-muted)' }}>{line.trade}</div>}
                      </td>
                      <td className="px-2 py-2.5 text-right" style={{ color: 'var(--bc-muted)' }}>{formatCurrency(line.scheduled_value)}</td>
                      <td className="px-2 py-2">
                        <input type="number" min="0" max={line.scheduled_value} step="0.01"
                          value={drawLines[line.id]?.work_completed_period || ''}
                          onChange={e => updateDrawLine(line.id, 'work_completed_period', e.target.value)}
                          className="w-full rounded px-2 py-1 text-right outline-none text-xs"
                          style={{ ...inputStyle, borderRadius: '0.375rem', padding: '0.25rem 0.5rem' }}
                          placeholder="0" />
                      </td>
                      <td className="px-2 py-2">
                        <input type="number" min="0" step="0.01"
                          value={drawLines[line.id]?.materials_stored || ''}
                          onChange={e => updateDrawLine(line.id, 'materials_stored', e.target.value)}
                          className="w-full rounded px-2 py-1 text-right outline-none text-xs"
                          style={{ ...inputStyle, borderRadius: '0.375rem', padding: '0.25rem 0.5rem' }}
                          placeholder="0" />
                      </td>
                      <td className="px-2 py-2.5 text-right">
                        <span style={{ color: line.pct >= 100 ? '#15803d' : line.pct > 0 ? 'var(--bc-gold-ink)' : 'var(--bc-muted)' }}>
                          {line.pct.toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold" style={{ color: line.due > 0 ? 'var(--bc-text)' : 'var(--bc-muted)' }}>
                        {line.due > 0 ? formatCurrency(line.due) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot style={{ background: 'rgba(13,27,42,0.03)', borderTop: '1px solid var(--bc-border)' }}>
                  <tr>
                    <td colSpan={3} className="px-4 py-3 text-xs font-bold" style={{ color: 'var(--bc-muted)' }}>TOTALS</td>
                    <td className="px-2 py-3 text-right text-xs font-bold" style={{ color: 'var(--bc-gold-ink)' }}>{money(totalGross)}</td>
                    <td className="px-2 py-3 text-right text-xs" style={{ color: 'var(--bc-muted)' }}>{totalStored > 0 ? money(totalStored) : ''}</td>
                    <td />
                    <td className="px-4 py-3 text-right text-xs">
                      <div className="font-bold" style={{ color: 'var(--bc-text)' }}>{money(totalNet)}</div>
                      <div className="text-xs mt-0.5" style={{ color: 'var(--bc-muted)' }}>−{money(totalRetainage)} retainage</div>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        {/* Simple amount form — shown when no SOV */}
        {!loadingSOV && !hasSov && (
          <div className="rounded-xl border p-5" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
            <p className="text-xs mb-4 px-3 py-2 rounded-lg" style={{ background: 'rgba(201,164,87,0.08)', color: 'var(--bc-gold-ink)' }}>
              ℹ️ No Schedule of Values set up for this project yet. Enter a draw amount below. Ask your lender to set up the SOV for line-item tracking.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--bc-muted)' }}>Draw Amount ($)</label>
                <input type="number" min="1" max={available} required={!hasSov} value={form.amount}
                  onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                  className="w-full rounded-lg px-3 py-2.5 text-sm outline-none"
                  style={{ ...inputStyle, borderRadius: '0.5rem', padding: '0.625rem 0.75rem', borderColor: overLimit ? '#c0392b' : 'var(--bc-border)' }}
                  placeholder="e.g. 45000" />
                {overLimit && <p className="text-xs mt-1" style={{ color: '#c0392b' }}>Exceeds available balance ({formatCurrency(available)})</p>}
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--bc-muted)' }}>Construction Phase</label>
                <select value={form.phase} onChange={e => setForm(f => ({ ...f, phase: e.target.value }))}
                  className="w-full rounded-lg px-3 py-2.5 text-sm outline-none"
                  style={{ ...inputStyle, borderRadius: '0.5rem', padding: '0.625rem 0.75rem' }}>
                  <option value="" style={{ background: 'var(--bc-navy)' }}>Select phase…</option>
                  {['Site Preparation','Foundation / Slab','Framing','Roofing','MEP Rough-In','Exterior / Windows','Insulation / Drywall','Interior Finish','Landscaping','Final / CO'].map(p =>
                    <option key={p} value={p} style={{ background: 'var(--bc-navy)' }}>{p}</option>
                  )}
                </select>
              </div>
            </div>
          </div>
        )}

        {/* Description */}
        <div className="rounded-xl border p-5" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
          <label className="block text-xs font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--bc-muted)' }}>Description of Work</label>
          <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2}
            className="w-full rounded-lg px-3 py-2.5 text-sm outline-none resize-none"
            style={{ ...inputStyle, borderRadius: '0.5rem', padding: '0.625rem 0.75rem' }}
            placeholder="Describe the work completed this draw period…" />
        </div>

        {/* Lien Waivers */}
        <div className="rounded-xl border p-5" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-bold text-sm">Lien Waivers</h2>
              <p className="text-xs mt-0.5" style={{ color: 'var(--bc-muted)' }}>Required by lender before funds release. Add one row per subcontractor.</p>
            </div>
            <button type="button" onClick={addWaiver}
              className="text-xs font-bold px-3 py-1.5 rounded-lg"
              style={{ background: 'rgba(201,164,87,0.12)', color: 'var(--bc-gold-ink)', border: '1px solid rgba(201,164,87,0.3)' }}>
              + Add Sub
            </button>
          </div>

          {lienWaivers.length === 0 ? (
            <div className="text-center py-5 rounded-lg border border-dashed" style={{ borderColor: 'var(--bc-border)' }}>
              <p className="text-xs" style={{ color: 'var(--bc-muted)' }}>No waivers added yet. Click "+ Add Sub" for each subcontractor working this period.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {lienWaivers.map((wv, i) => (
                <div key={i} className="rounded-lg border p-3 space-y-2" style={{ borderColor: 'var(--bc-border)', background: 'rgba(13,27,42,0.02)' }}>
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-semibold" style={{ color: 'var(--bc-gold-ink)' }}>Subcontractor {i + 1}</span>
                    <button type="button" onClick={() => removeWaiver(i)} className="text-xs" style={{ color: '#c0392b' }}>Remove</button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs mb-1 block" style={{ color: 'var(--bc-muted)' }}>Sub Name *</label>
                      <input value={wv.sub_name} onChange={e => updateWaiver(i, 'sub_name', e.target.value)}
                        className="w-full rounded px-2 py-1.5 text-xs outline-none"
                        style={{ ...inputStyle, borderRadius: '0.375rem' }}
                        placeholder="Apex Electric LLC" />
                    </div>
                    <div>
                      <label className="text-xs mb-1 block" style={{ color: 'var(--bc-muted)' }}>Waiver Type</label>
                      <select value={wv.waiver_type} onChange={e => updateWaiver(i, 'waiver_type', e.target.value)}
                        className="w-full rounded px-2 py-1.5 text-xs outline-none"
                        style={{ ...inputStyle, borderRadius: '0.375rem' }}>
                        {WAIVER_TYPES.map(t => <option key={t.value} value={t.value} style={{ background: 'var(--bc-navy)' }}>{t.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs mb-1 block" style={{ color: 'var(--bc-muted)' }}>Through Amount ($)</label>
                      <input type="number" value={wv.through_amount} onChange={e => updateWaiver(i, 'through_amount', e.target.value)}
                        className="w-full rounded px-2 py-1.5 text-xs outline-none"
                        style={{ ...inputStyle, borderRadius: '0.375rem' }}
                        placeholder="Waiver covers work through this $" />
                    </div>
                    <div>
                      <label className="text-xs mb-1 block" style={{ color: 'var(--bc-muted)' }}>Signed By</label>
                      <input value={wv.signed_by} onChange={e => updateWaiver(i, 'signed_by', e.target.value)}
                        className="w-full rounded px-2 py-1.5 text-xs outline-none"
                        style={{ ...inputStyle, borderRadius: '0.375rem' }}
                        placeholder="John Smith, GC" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Inspection + Files */}
        <div className="rounded-xl border p-5 space-y-4" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
          <p className="text-sm" style={{ color: 'var(--bc-muted)' }}>
            Inspection: the lender&apos;s inspector confirms the work. There is nothing for you to mark here.
          </p>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--bc-muted)' }}>Supporting Documents</label>
            <label className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed p-5 cursor-pointer transition-colors hover:border-[var(--bc-gold)]"
              style={{ borderColor: 'var(--bc-border)' }}>
              <span className="text-2xl">📎</span>
              <span className="text-sm font-medium">Click to upload files</span>
              <span className="text-xs" style={{ color: 'var(--bc-muted)' }}>Inspection report, lien waivers, invoices (PDF, JPG, PNG)</span>
              <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png" className="hidden"
                onChange={e => setFiles(Array.from(e.target.files || []))} />
            </label>
            {files.length > 0 && (
              <div className="mt-2 space-y-1">
                {files.map(f => (
                  <div key={f.name} className="text-xs flex items-center gap-2 px-3 py-1.5 rounded-lg"
                    style={{ background: 'rgba(201,164,87,0.08)', color: 'var(--bc-gold-ink)' }}>
                    📄 {f.name} <span style={{ color: 'var(--bc-muted)' }}>({(f.size / 1024).toFixed(0)} KB)</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Summary + Submit */}
        {hasSov && (
          <div className="rounded-xl border p-4" style={{ background: 'rgba(201,164,87,0.06)', borderColor: 'rgba(201,164,87,0.2)' }}>
            <div className="text-sm">
              <span style={{ color: 'var(--bc-muted)' }}>Gross draw: </span>
              <span className="font-bold bc-figure">{money(totalGross)}</span>
              <span className="mx-2" style={{ color: 'var(--bc-muted)' }}>·</span>
              <span style={{ color: 'var(--bc-muted)' }}>Retainage ({Math.round(retainageRate * 100)}%): </span>
              <span className="font-bold bc-figure" style={{ color: '#c0392b' }}>−{money(totalRetainage)}</span>
              <span className="mx-2" style={{ color: 'var(--bc-muted)' }}>·</span>
              <span style={{ color: 'var(--bc-muted)' }}>Net payment due: </span>
              <span className="font-bold text-base bc-figure" style={{ color: 'var(--bc-gold-ink)' }}>{money(totalNet)}</span>
            </div>
            <p className="text-xs mt-1.5" style={{ color: 'var(--bc-muted)' }}>
              Stored materials are recorded but not paid in this draw.
              {totalStored > 0 ? ` You entered ${money(totalStored)} of stored materials.` : ''}
            </p>
            {hasLineItems && !hasPeriodWork && (
              <p className="text-xs mt-1.5" style={{ color: '#c0392b' }}>
                Enter work completed this period on at least one line: a draw cannot be made of stored materials alone.
              </p>
            )}
          </div>
        )}

        {submitError && (
          <div role="alert" className="rounded-xl border p-4 text-sm" style={{ background: 'rgba(231,76,60,0.08)', borderColor: 'rgba(231,76,60,0.3)', color: '#c0392b' }}>
            {submitError}
          </div>
        )}

        <div className="flex gap-3">
          <button type="submit"
            disabled={loading || overLimit || !form.project_id || (hasSov && !hasPeriodWork) || (!hasSov && !form.amount)}
            className="px-6 py-2.5 rounded-lg text-sm font-bold transition-all disabled:opacity-50"
            style={{ background: 'var(--bc-gold)', color: 'var(--bc-dark)' }}>
            {loading ? 'Submitting…' : 'Submit Draw Request'}
          </button>
          <button type="button" onClick={() => router.back()}
            className="px-4 py-2.5 rounded-lg text-sm font-semibold border transition-all"
            style={{ border: '1px solid var(--bc-border)', color: 'var(--bc-muted)' }}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
