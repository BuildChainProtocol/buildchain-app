'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { formatCurrency } from '@/lib/utils'

const PHASES = [
  'Site Preparation', 'Foundation / Slab', 'Framing', 'Roofing',
  'MEP Rough-In', 'Exterior / Windows', 'Insulation / Drywall',
  'Interior Finish', 'Landscaping', 'Final / CO',
]

interface Project {
  id: string
  name: string
  loan_amount: number
  amount_drawn: number
  loan_number: string | null
  stage: string
}

export default function SubmitDrawPage() {
  const router = useRouter()
  const [projects, setProjects] = useState<Project[]>([])
  const [files, setFiles] = useState<File[]>([])
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [form, setForm] = useState({
    project_id: '', amount: '', phase: '', purpose: '',
    description: '', inspection_done: false, lien_waiver: false,
  })

  useEffect(() => {
    fetch('/api/projects').then(r => r.json()).then(d => {
      const active = (d.data || []).filter((p: Project) => ['active', 'approved'].includes(p.stage))
      setProjects(active)
      if (active.length > 0) setForm(f => ({ ...f, project_id: active[0].id }))
    })
  }, [])

  const selectedProject = projects.find(p => p.id === form.project_id)
  const available = selectedProject ? selectedProject.loan_amount - selectedProject.amount_drawn : 0
  const amount = parseFloat(form.amount) || 0
  const overLimit = amount > available

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (overLimit) return
    setLoading(true)

    const res = await fetch('/api/draws', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: form.project_id,
        amount: parseFloat(form.amount),
        phase: form.phase,
        purpose: form.purpose || form.phase,
        description: form.description,
        inspection_done: form.inspection_done,
        lien_waiver: form.lien_waiver,
      }),
    })

    if (res.ok) {
      setSuccess(true)
      setTimeout(() => router.push('/borrower'), 2000)
    }
    setLoading(false)
  }

  if (success) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="text-5xl mb-4">✅</div>
          <h2 className="text-xl font-bold mb-2">Draw Request Submitted!</h2>
          <p style={{ color: 'var(--bc-muted)' }} className="text-sm">Your lender has been notified. Redirecting…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Submit Draw Request</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--bc-muted)' }}>Request a construction loan disbursement</p>
      </div>

      <div className="rounded-xl border p-6" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Project */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--bc-muted)' }}>Project</label>
            <select value={form.project_id} onChange={e => setForm(f => ({ ...f, project_id: e.target.value }))} required
              className="w-full rounded-lg px-3 py-2.5 text-sm outline-none"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--bc-border)', color: '#e8edf2' }}>
              {projects.map(p => (
                <option key={p.id} value={p.id} style={{ background: 'var(--bc-navy)' }}>
                  {p.name} — {p.loan_number} ({formatCurrency(p.loan_amount - p.amount_drawn)} available)
                </option>
              ))}
              {projects.length === 0 && <option disabled>No active projects</option>}
            </select>
          </div>

          {/* Amount */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--bc-muted)' }}>Draw Amount ($)</label>
              <input type="number" min="1" max={available} required value={form.amount}
                onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                className="w-full rounded-lg px-3 py-2.5 text-sm outline-none"
                style={{ background: 'rgba(255,255,255,0.05)', border: `1px solid ${overLimit ? '#e74c3c' : 'var(--bc-border)'}`, color: '#e8edf2' }}
                placeholder="e.g. 45000" />
              {overLimit && <p className="text-xs mt-1" style={{ color: '#e74c3c' }}>Exceeds available balance</p>}
              {selectedProject && !overLimit && form.amount && (
                <p className="text-xs mt-1" style={{ color: 'var(--bc-muted)' }}>
                  {formatCurrency(available - amount)} remaining after draw
                </p>
              )}
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--bc-muted)' }}>Construction Phase</label>
              <select required value={form.phase} onChange={e => setForm(f => ({ ...f, phase: e.target.value }))}
                className="w-full rounded-lg px-3 py-2.5 text-sm outline-none"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--bc-border)', color: '#e8edf2' }}>
                <option value="" style={{ background: 'var(--bc-navy)' }}>Select phase…</option>
                {PHASES.map(p => <option key={p} value={p} style={{ background: 'var(--bc-navy)' }}>{p}</option>)}
              </select>
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--bc-muted)' }}>Description of Work</label>
            <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={3}
              className="w-full rounded-lg px-3 py-2.5 text-sm outline-none resize-none"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--bc-border)', color: '#e8edf2' }}
              placeholder="Describe the work completed that this draw covers…" />
          </div>

          {/* Checkboxes */}
          <div className="grid grid-cols-2 gap-4">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input type="checkbox" checked={form.inspection_done} onChange={e => setForm(f => ({ ...f, inspection_done: e.target.checked }))}
                className="w-4 h-4 rounded accent-[var(--bc-gold)]" />
              <span className="text-sm">Inspection completed</span>
            </label>
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input type="checkbox" checked={form.lien_waiver} onChange={e => setForm(f => ({ ...f, lien_waiver: e.target.checked }))}
                className="w-4 h-4 rounded accent-[var(--bc-gold)]" />
              <span className="text-sm">Lien waiver attached</span>
            </label>
          </div>

          {/* File upload */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--bc-muted)' }}>Supporting Documents</label>
            <label className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed p-6 cursor-pointer transition-colors hover:border-[var(--bc-gold)]"
              style={{ borderColor: 'var(--bc-border)' }}>
              <span className="text-2xl">📎</span>
              <span className="text-sm font-medium">Click to upload files</span>
              <span className="text-xs" style={{ color: 'var(--bc-muted)' }}>Inspection report, lien waiver, invoices (PDF, JPG, PNG)</span>
              <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png" className="hidden"
                onChange={e => setFiles(Array.from(e.target.files || []))} />
            </label>
            {files.length > 0 && (
              <div className="mt-2 space-y-1">
                {files.map(f => (
                  <div key={f.name} className="text-xs flex items-center gap-2 px-3 py-1.5 rounded-lg"
                    style={{ background: 'rgba(201,168,76,0.08)', color: 'var(--bc-gold)' }}>
                    📄 {f.name} <span style={{ color: 'var(--bc-muted)' }}>({(f.size / 1024).toFixed(0)} KB)</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={loading || overLimit || !form.project_id || !form.amount || !form.phase}
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
    </div>
  )
}
