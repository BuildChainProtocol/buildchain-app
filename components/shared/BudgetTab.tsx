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

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000) }

  async function load() {
    const res = await fetch(`/api/budget-lines?project_id=${projectId}`)
    const json = await res.json()
    setLines(json.data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [projectId])

  const totalBudget = lines.reduce((s, l) => s + l.scheduled_value, 0)

  async function saveLine() {
    if (!form.line_no || !form.description || !form.scheduled_value) return
    setSaving(true)
    if (editId) {
      await fetch(`/api/budget-lines/${editId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, scheduled_value: parseFloat(form.scheduled_value), sort_order: lines.length }),
      })
      setEditId(null)
    } else {
      await fetch('/api/budget-lines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: projectId, ...form, scheduled_value: parseFloat(form.scheduled_value), sort_order: lines.length }),
      })
    }
    setForm(emptyLine)
    setAdding(false)
    setSaving(false)
    await load()
    showToast(editId ? 'Line updated' : 'Line added')
  }

  async function deleteLine(id: string) {
    if (!window.confirm('Remove this budget line?')) return
    await fetch(`/api/budget-lines/${id}`, { method: 'DELETE' })
    await load()
    showToast('Line removed')
  }

  function startEdit(line: BudgetLine) {
    setForm({ line_no: line.line_no, description: line.description, scheduled_value: String(line.scheduled_value), csi_division: line.csi_division || '', trade: line.trade || '' })
    setEditId(line.id)
    setAdding(true)
  }

  const inputStyle = {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid var(--bc-border)',
    color: '#e8edf2',
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
          style={{ background: 'var(--bc-gold)', color: 'var(--bc-dark)' }}>✓ {toast}</div>
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
        <div className="rounded-xl border p-4 mb-4 space-y-3" style={{ borderColor: 'var(--bc-gold)', background: 'rgba(201,168,76,0.05)' }}>
          <p className="text-xs font-bold" style={{ color: 'var(--bc-gold)' }}>{editId ? 'Edit Line' : 'New Budget Line'}</p>
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
                const barColor = drawnPct >= 100 ? '#2ecc71'
                  : drawnPct > 80 ? 'var(--bc-gold)'
                  : 'var(--bc-blue)'

                return (
                  <tr key={line.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <td className="py-3 pr-3 font-mono" style={{ color: 'var(--bc-muted)' }}>{line.line_no}</td>
                    <td className="py-3 pr-3 font-medium">{line.description}</td>
                    <td className="py-3 pr-3 hidden md:table-cell" style={{ color: 'var(--bc-muted)' }}>{line.trade || '—'}</td>
                    <td className="py-3 pr-3 text-right font-semibold" style={{ color: 'var(--bc-gold)' }}>
                      {formatCurrency(line.scheduled_value)}
                    </td>
                    <td className="py-3 pr-3 text-right font-semibold" style={{ color: drawn > 0 ? '#e8edf2' : 'var(--bc-muted)' }}>
                      {drawn > 0 ? formatCurrency(drawn) : '—'}
                    </td>
                    <td className="py-3 pr-3 text-right hidden sm:table-cell" style={{ color: remaining > 0 ? '#2ecc71' : 'var(--bc-muted)' }}>
                      {formatCurrency(Math.max(remaining, 0))}
                    </td>
                    <td className="py-3 pr-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 rounded-full overflow-hidden h-1.5" style={{ background: 'rgba(255,255,255,0.08)', minWidth: 48 }}>
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
                          <button onClick={() => startEdit(line)} className="hover:underline" style={{ color: 'var(--bc-gold)' }}>Edit</button>
                          <button onClick={() => deleteLine(line.id)} className="hover:underline" style={{ color: '#e74c3c' }}>Del</button>
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
                <td className="py-3 pr-3 text-right font-bold" style={{ color: 'var(--bc-gold)' }}>
                  {formatCurrency(totalBudget)}
                </td>
                <td className="py-3 pr-3 text-right font-bold">
                  {totalDrawn > 0 ? formatCurrency(totalDrawn) : '—'}
                </td>
                <td className="py-3 pr-3 text-right font-bold hidden sm:table-cell text-green-400">
                  {formatCurrency(Math.max(totalBudget - totalDrawn, 0))}
                </td>
                <td className="py-3 pr-3">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 rounded-full overflow-hidden h-1.5" style={{ background: 'rgba(255,255,255,0.08)', minWidth: 48 }}>
                      <div className="h-full rounded-full"
                        style={{ width: `${totalBudget > 0 ? Math.min(Math.round(totalDrawn / totalBudget * 100), 100) : 0}%`, background: 'var(--bc-gold)' }} />
                    </div>
                    <span className="font-bold tabular-nums" style={{ color: 'var(--bc-gold)', minWidth: 32, textAlign: 'right' }}>
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
