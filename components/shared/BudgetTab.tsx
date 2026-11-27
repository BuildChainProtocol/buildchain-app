'use client'

import { useState, useEffect } from 'react'
import { formatCurrency } from '@/lib/utils'

interface BudgetLine {
  id: string
  line_no: string
  description: string
  scheduled_value: number
  csi_division: string | null
  trade: string | null
  sort_order: number
  drawn_to_date: number   // aggregated from approved/funded draw_line_items
}

interface BudgetTabProps {
  projectId: string
  readOnly?: boolean
}

const TRADES = [
  'Site Work', 'Foundation', 'Framing', 'Roofing', 'Exterior',
  'MEP - Mechanical', 'MEP - Electrical', 'MEP - Plumbing',
  'Insulation', 'Drywall', 'Interior Finish', 'Flooring',
  'Cabinets & Millwork', 'Landscaping', 'Contingency', 'General Conditions', 'Other'
]

const emptyLine = { line_no: '', description: '', scheduled_value: '', csi_division: '', trade: '' }

export default function BudgetTab({ projectId, readOnly = false }: BudgetTabProps) {
  const [lines, setLines] = useState<BudgetLine[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState(emptyLine)
  const [editId, setEditId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')

  const [toastOk, setToastOk] = useState(true)
  const [loadError, setLoadError] = useState('')

  const showToast = (msg: string, ok = true) => {
    setToast(msg); setToastOk(ok)
    setTimeout(() => setToast(''), ok ? 3000 : 8000)
  }

  /** Reads the server's own error message from a failed response. */
  async function errorFrom(res: Response, fallback: string): Promise<string> {
    const json = await res.json().catch(() => ({}))
    return json?.error ?? `${fallback} (${res.status})`
  }

  async function load() {
    try {
      const res = await fetch(`/api/budget-lines?project_id=${projectId}`)
      if (!res.ok) {
        setLoadError(await errorFrom(res, 'The budget could not be loaded'))
        setLoading(false)
        return
      }
      const json = await res.json()
      setLoadError('')
      setLines(json.data || [])
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'The budget could not be loaded')
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [projectId])

  const totalBudget = lines.reduce((s, l) => s + l.scheduled_value, 0)

  async function saveLine() {
    if (!form.line_no || !form.description || !form.scheduled_value) return
    const value = parseFloat(form.scheduled_value)
    if (!Number.isFinite(value)) { showToast('Scheduled value must be a number', false); return }
    setSaving(true)
    const wasEdit = !!editId
    try {
      const res = wasEdit
        ? await fetch(`/api/budget-lines/${editId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...form, scheduled_value: value, sort_order: lines.length }),
          })
        : await fetch('/api/budget-lines', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ project_id: projectId, ...form, scheduled_value: value, sort_order: lines.length }),
          })
      if (!res.ok) {
        // Keep the form open with what was typed so it can be corrected.
        showToast(await errorFrom(res, wasEdit ? 'The line could not be updated' : 'The line could not be added'), false)
        return
      }
      setEditId(null)
      setForm(emptyLine)
      setAdding(false)
      await load()
      showToast(wasEdit ? 'Line updated' : 'Line added')
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'The line could not be saved', false)
    } finally {
      setSaving(false)
    }
  }

  async function deleteLine(id: string) {
    if (!window.confirm('Remove this budget line?')) return
    try {
      const res = await fetch(`/api/budget-lines/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        showToast(await errorFrom(res, 'The line could not be removed'), false)
        return
      }
      await load()
      showToast('Line removed')
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'The line could not be removed', false)
    }
  }

  function startEdit(line: BudgetLine) {
    setForm({ line_no: line.line_no, description: line.description, scheduled_value: String(line.scheduled_value), csi_division: line.csi_division || '', trade: line.trade || '' })
    setEditId(line.id)
    setAdding(true)
  }

  const inputStyle = {
    background: 'rgba(13,27,42,0.05)',
    border: '1px solid var(--bc-border)',
    color: 'var(--bc-text)',
    borderRadius: '0.5rem',
    padding: '0.4rem 0.6rem',
    fontSize: '0.8rem',
    outline: 'none',
    width: '100%',
  }

  return (
    <div>
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl text-sm font-bold shadow-xl"
          style={{ background: toastOk ? 'var(--bc-gold)' : '#c0392b', color: toastOk ? 'var(--bc-dark)' : '#fff' }}>{toast}</div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-bold text-base">Schedule of Values</h3>
          <p className="text-xs mt-0.5" style={{ color: 'var(--bc-muted)' }}>
            Approved budget breakdown — {lines.length} line{lines.length !== 1 ? 's' : ''} · Total {formatCurrency(totalBudget)}
          </p>
        </div>
        {!readOnly && !adding && (
          <button onClick={() => { setAdding(true); setEditId(null); setForm(emptyLine) }}
            className="text-xs font-bold px-3 py-1.5 rounded-lg"
            style={{ background: 'var(--bc-gold)', color: 'var(--bc-dark)' }}>
            + Add Line
          </button>
        )}
      </div>

      {/* Add / Edit form */}
      {adding && !readOnly && (
        <div className="rounded-xl border p-4 mb-4 space-y-3" style={{ borderColor: 'var(--bc-gold)', background: 'rgba(201,164,87,0.05)' }}>
          <p className="text-xs font-bold" style={{ color: 'var(--bc-gold-ink)' }}>{editId ? 'Edit Line' : 'New Budget Line'}</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs mb-1 block" style={{ color: 'var(--bc-muted)' }}>Line #</label>
              <input style={inputStyle} placeholder="e.g. 1, 1.1, 2" value={form.line_no} onChange={e => setForm(f => ({ ...f, line_no: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs mb-1 block" style={{ color: 'var(--bc-muted)' }}>Scheduled Value ($)</label>
              <input type="number" style={inputStyle} placeholder="50000" value={form.scheduled_value} onChange={e => setForm(f => ({ ...f, scheduled_value: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="text-xs mb-1 block" style={{ color: 'var(--bc-muted)' }}>Description</label>
            <input style={inputStyle} placeholder="Foundation & Excavation" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs mb-1 block" style={{ color: 'var(--bc-muted)' }}>Trade (optional)</label>
              <select style={inputStyle} value={form.trade} onChange={e => setForm(f => ({ ...f, trade: e.target.value }))}>
                <option value="" style={{ background: 'var(--bc-navy)' }}>Select trade…</option>
                {TRADES.map(t => <option key={t} value={t} style={{ background: 'var(--bc-navy)' }}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs mb-1 block" style={{ color: 'var(--bc-muted)' }}>CSI Division (optional)</label>
              <input style={inputStyle} placeholder="03-300" value={form.csi_division} onChange={e => setForm(f => ({ ...f, csi_division: e.target.value }))} />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={saveLine} disabled={saving || !form.line_no || !form.description || !form.scheduled_value}
              className="text-xs font-bold px-4 py-1.5 rounded-lg disabled:opacity-50"
              style={{ background: 'var(--bc-gold)', color: 'var(--bc-dark)' }}>
              {saving ? 'Saving…' : editId ? 'Update' : 'Add Line'}
            </button>
            <button onClick={() => { setAdding(false); setEditId(null); setForm(emptyLine) }}
              className="text-xs px-3 py-1.5 rounded-lg border"
              style={{ borderColor: 'var(--bc-border)', color: 'var(--bc-muted)' }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* SOV Table */}
      {loading ? (
        <div className="text-sm py-8 text-center" style={{ color: 'var(--bc-muted)' }}>Loading…</div>
      ) : loadError ? (
        <div className="text-sm py-8 text-center" style={{ color: '#c0392b' }}>{loadError}</div>
      ) : lines.length === 0 ? (
        <div className="text-center py-10 rounded-xl border border-dashed" style={{ borderColor: 'var(--bc-border)' }}>
          <div className="text-3xl mb-2">📋</div>
          <p className="text-sm font-semibold mb-1">No budget lines yet</p>
          <p className="text-xs" style={{ color: 'var(--bc-muted)' }}>
            {readOnly ? 'The admin has not set up the Schedule of Values for this project yet.' : 'Add the approved budget breakdown. These are the cost categories the lender funded at closing.'}
          </p>
        </div>
      ) : (() => {
        const totalDrawn = lines.reduce((s, l) => s + (l.drawn_to_date || 0), 0)
        return (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--bc-border)', color: 'var(--bc-muted)' }}>
                <th className="text-left py-2 pr-3 font-semibold w-10">Line</th>
                <th className="text-left py-2 pr-3 font-semibold">Description</th>
                <th className="text-left py-2 pr-3 font-semibold hidden md:table-cell">Trade</th>
                <th className="text-right py-2 pr-3 font-semibold">Budget</th>
                <th className="text-right py-2 pr-3 font-semibold">Drawn</th>
                <th className="text-right py-2 pr-3 font-semibold hidden sm:table-cell">Remaining</th>
                <th className="text-left py-2 pr-3 font-semibold" style={{ minWidth: 90 }}>Progress</th>
                {!readOnly && <th className="w-14" />}
              </tr>
            </thead>
            <tbody>
              {lines.map(line => {
                const drawn = line.drawn_to_date || 0
                const remaining = line.scheduled_value - drawn
                const drawnPct = line.scheduled_value > 0
                  ? Math.min(Math.round((drawn / line.scheduled_value) * 100), 100)
                  : 0
                const barColor = drawnPct >= 100 ? '#15803d'
                  : drawnPct > 80 ? 'var(--bc-gold)'
                  : 'var(--bc-blue)'

                return (
                  <tr key={line.id} style={{ borderBottom: '1px solid rgba(13,27,42,0.04)' }}>
                    <td className="py-3 pr-3 font-mono" style={{ color: 'var(--bc-muted)' }}>{line.line_no}</td>
                    <td className="py-3 pr-3 font-medium">{line.description}</td>
                    <td className="py-3 pr-3 hidden md:table-cell" style={{ color: 'var(--bc-muted)' }}>{line.trade || '—'}</td>
                    <td className="py-3 pr-3 text-right font-semibold" style={{ color: 'var(--bc-gold-ink)' }}>
                      {formatCurrency(line.scheduled_value)}
                    </td>
                    <td className="py-3 pr-3 text-right font-semibold" style={{ color: drawn > 0 ? 'var(--bc-text)' : 'var(--bc-muted)' }}>
                      {drawn > 0 ? formatCurrency(drawn) : '—'}
                    </td>
                    <td className="py-3 pr-3 text-right hidden sm:table-cell" style={{ color: remaining > 0 ? '#15803d' : 'var(--bc-muted)' }}>
                      {formatCurrency(Math.max(remaining, 0))}
                    </td>
                    <td className="py-3 pr-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 rounded-full overflow-hidden h-1.5" style={{ background: 'rgba(13,27,42,0.08)', minWidth: 48 }}>
                          <div className="h-full rounded-full transition-all duration-500"
                            style={{ width: `${drawnPct}%`, background: barColor }} />
                        </div>
                        <span className="font-semibold tabular-nums" style={{ color: barColor, minWidth: 32, textAlign: 'right' }}>
                          {drawnPct}%
                        </span>
                      </div>
                    </td>
                    {!readOnly && (
                      <td className="py-3">
                        <div className="flex gap-2 justify-end">
                          <button onClick={() => startEdit(line)} className="hover:underline" style={{ color: 'var(--bc-gold-ink)' }}>Edit</button>
                          <button onClick={() => deleteLine(line.id)} className="hover:underline" style={{ color: '#c0392b' }}>Del</button>
                        </div>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: '2px solid var(--bc-border)' }}>
                <td colSpan={3} className="py-3 pr-3 font-bold" style={{ color: 'var(--bc-muted)' }}>
                  TOTAL CONTRACT SUM
                </td>
                <td className="py-3 pr-3 text-right font-bold" style={{ color: 'var(--bc-gold-ink)' }}>
                  {formatCurrency(totalBudget)}
                </td>
                <td className="py-3 pr-3 text-right font-bold">
                  {totalDrawn > 0 ? formatCurrency(totalDrawn) : '—'}
                </td>
                <td className="py-3 pr-3 text-right font-bold hidden sm:table-cell text-green-700">
                  {formatCurrency(Math.max(totalBudget - totalDrawn, 0))}
                </td>
                <td className="py-3 pr-3">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 rounded-full overflow-hidden h-1.5" style={{ background: 'rgba(13,27,42,0.08)', minWidth: 48 }}>
                      <div className="h-full rounded-full"
                        style={{ width: `${totalBudget > 0 ? Math.min(Math.round(totalDrawn / totalBudget * 100), 100) : 0}%`, background: 'var(--bc-gold)' }} />
                    </div>
                    <span className="font-bold tabular-nums" style={{ color: 'var(--bc-gold-ink)', minWidth: 32, textAlign: 'right' }}>
                      {totalBudget > 0 ? Math.round(totalDrawn / totalBudget * 100) : 0}%
                    </span>
                  </div>
                </td>
                {!readOnly && <td />}
              </tr>
            </tfoot>
          </table>
        </div>
        )
      })()}
    </div>
  )
}
