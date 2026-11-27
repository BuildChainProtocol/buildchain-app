'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { formatCurrency, timeAgo } from '@/lib/utils'
import BudgetTab from '@/components/shared/BudgetTab'
import SettlementCard from '@/components/admin/SettlementCard'

const STAGES = ['application', 'review', 'approved', 'active', 'complete', 'cancelled']
const stageBadge: Record<string, string> = {
  active: 'badge-green', approved: 'badge-blue', review: 'badge-yellow',
  application: 'badge-gray', complete: 'badge-blue', cancelled: 'badge-red',
}
const drawStatusBadge: Record<string, string> = {
  draft: 'badge-gray', submitted: 'badge-blue', pending: 'badge-yellow',
  approved: 'badge-blue', funded: 'badge-green', declined: 'badge-red', held: 'badge-yellow',
}
const drawStatusLabel: Record<string, string> = { funded: 'released', held: 'on hold' }
const docStatusBadge: Record<string, string> = {
  required: 'badge-yellow', uploaded: 'badge-blue', approved: 'badge-green',
  rejected: 'badge-red', overdue: 'badge-red', not_required: 'badge-gray',
}

const TESTNET_EXPLORER = 'https://testnet.xrpl.org/transactions'
const TESTNET_NFT = 'https://testnet.xrpl.org/nft'

// Dollar-token methods: the lender signs to lock, and release is automatic.
const isTokenMethod = (m: string | null | undefined) => m === 'token_escrow' || m === 'two_signature'

interface InspectionRow { id: string; status: string; inspector_name: string; credential_nft_id?: string | null }

/** Inspection condition for one draw, from its inspections and the draw's own flag. */
function inspectionState(list: InspectionRow[], inspectionDone: boolean | null | undefined) {
  const passed = list.some(i => i.status === 'passed') || !!inspectionDone
  const state: 'none' | 'pending' | 'passed' | 'failed' =
    passed ? 'passed'
    : list.some(i => i.status === 'pending') ? 'pending'
    : list.some(i => i.status === 'failed') ? 'failed'
    : 'none'
  return { state, recorded: list.some(i => i.status === 'passed' && !!i.credential_nft_id) }
}

export default function ProjectDetailPage() {
  const params = useParams()
  const router = useRouter()
  const [project, setProject] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [tab, setTab] = useState<'overview' | 'draws' | 'documents' | 'budget' | 'activity'>('overview')
  const [stageUpdating, setStageUpdating] = useState(false)
  const [drawActionId, setDrawActionId] = useState<string | null>(null)
  const [lienWaiverLoading, setLienWaiverLoading] = useState<string | null>(null)
  const [checkLoading, setCheckLoading] = useState<string | null>(null)
  const [docActionId, setDocActionId] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  const [inspections, setInspections] = useState<Record<string, InspectionRow[]>>({})

  function notify(msg: string, ok = true) {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), ok ? 4000 : 9000)
  }

  /** Runs a request and reports what the server said. Never assumes success. */
  async function send(url: string, init: RequestInit, fallback: string): Promise<{ ok: boolean; json: any }> {
    try {
      const res = await fetch(url, init)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        notify(json?.error ?? `${fallback} (${res.status})`, false)
        return { ok: false, json }
      }
      return { ok: true, json }
    } catch (e) {
      notify(e instanceof Error ? `${fallback}: ${e.message}` : fallback, false)
      return { ok: false, json: {} }
    }
  }
  const jsonInit = (method: string, body: unknown): RequestInit => ({
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${params.id}`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setLoadError(json?.error ?? `The project could not be loaded (${res.status})`)
        setLoading(false)
        return
      }
      setLoadError('')
      setProject(json.data)
      setLoading(false)
      // Inspections for draws that are still open, so the Draws tab can say
      // whether one is assigned, pending or passed, and whether it is recorded.
      const open = (json.data?.draw_requests || []).filter((d: any) => !['funded', 'declined', 'draft'].includes(d.status))
      open.forEach(async (d: any) => {
        try {
          const r = await fetch(`/api/inspections?draw_request_id=${d.id}`)
          if (!r.ok) return
          const j = await r.json()
          if (j.data) setInspections(prev => ({ ...prev, [d.id]: j.data }))
        } catch { /* the row falls back to the draw's own flag */ }
      })
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'The project could not be loaded')
      setLoading(false)
    }
  }, [params.id])

  useEffect(() => { load() }, [load])

  async function updateStage(stage: string) {
    setStageUpdating(true)
    const r = await send(`/api/projects/${params.id}`, jsonInit('PATCH', { stage }), 'The stage could not be changed')
    await load()
    setStageUpdating(false)
    if (r.ok) notify(`Stage updated to ${stage}`)
  }

  async function updateDraw(drawId: string, status: string, extra?: Record<string, string>) {
    setDrawActionId(drawId + status)
    const r = await send(`/api/draws/${drawId}`, jsonInit('PATCH', { status, ...(extra ?? {}) }), 'The draw could not be updated')
    await load()
    setDrawActionId(null)
    if (!r.ok) return
    notify(
      status === 'approved'
        ? (r.json?.data?.escrow_txn_hash
            ? 'Draw approved. A test escrow is recorded on the XRP Ledger test network.'
            : 'Draw approved. No ledger escrow was created.')
      : status === 'funded' ? 'Draw released (pilot method, test network).'
      : status === 'declined' ? 'Draw declined.'
      : status === 'submitted' ? 'Draw taken off hold. It is back in review.'
      : `Draw ${status}.`
    )
  }

  function declineDraw(drawId: string) {
    const reason = window.prompt('Reason for declining this draw (the contractor sees this). A declined draw is final.')
    if (reason === null) return
    if (!reason.trim()) { notify('A reason is needed to decline a draw', false); return }
    updateDraw(drawId, 'declined', { decline_reason: reason.trim() })
  }

  function releaseDrawManually(drawId: string) {
    const confirmed = window.confirm(
      'Release without both conditions (pilot only)?\n\n' +
      'This marks the draw released and finishes its test escrow on the XRP Ledger test network without checking that the inspection and the lien waivers are both recorded. No dollars move. It cannot be undone.'
    )
    if (confirmed) updateDraw(drawId, 'funded')
  }

  async function confirmLienWaiver(drawId: string) {
    setLienWaiverLoading(drawId)
    const r = await send(`/api/draws/${drawId}`, jsonInit('PATCH', { lien_waiver: true }), 'Lien waiver confirmation failed')
    await load()
    setLienWaiverLoading(null)
    if (r.ok) notify('Lien waiver confirmation saved. The row shows whether it is recorded on the ledger.')
  }

  // Retry any missing ledger record and attempt the release.
  async function checkAgain(drawId: string) {
    setCheckLoading(drawId)
    const r = await send(`/api/draws/${drawId}/conditions`, { method: 'POST' }, 'The check could not be run')
    await load()
    setCheckLoading(null)
    if (!r.ok) return
    if (r.json?.released) notify('Both conditions are recorded. The draw was released.')
    else notify(`Not released. ${r.json?.reason ?? 'Both conditions are not recorded yet.'}`, false)
  }

  async function updateDoc(docId: string, status: 'approved' | 'rejected') {
    setDocActionId(docId + status)
    const r = await send(`/api/documents/${docId}`, jsonInit('PATCH', { status }), 'The document could not be updated')
    await load()
    setDocActionId(null)
    if (r.ok) notify(`Document ${status}`)
  }

  async function archiveProject() {
    const confirmed = window.confirm('Archive this project? It will be hidden from the active list but all data is preserved.')
    if (!confirmed) return
    const r = await send(`/api/projects/${params.id}`, jsonInit('PATCH', { archived_at: new Date().toISOString() }), 'The project could not be archived')
    if (r.ok) router.push('/admin/projects')
  }

  async function unarchiveProject() {
    const r = await send(`/api/projects/${params.id}`, jsonInit('PATCH', { archived_at: null }), 'The project could not be restored')
    await load()
    if (r.ok) notify('Project restored to active')
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="text-sm" style={{ color: 'var(--bc-muted)' }}>Loading project…</div>
    </div>
  )

  if (!project) return (
    <div className="flex items-center justify-center h-64">
      <div className="text-sm" style={{ color: loadError ? '#c0392b' : 'var(--bc-muted)' }}>{loadError || 'Project not found.'}</div>
    </div>
  )

  const drawn = project.amount_drawn || 0
  const available = project.loan_amount - drawn
  const drawPct = Math.round((drawn / project.loan_amount) * 100)
  const borrower = project.borrowers
  const lender = project.lenders
  const draws = project.draw_requests || []
  const docs = project.documents || []
  const activity = project.activity_log || []

  const pendingDraws = draws.filter((d: any) => ['submitted', 'pending'].includes(d.status))

  return (
    <div>
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl text-sm font-bold shadow-xl max-w-sm"
          style={{ background: toast.ok ? 'var(--bc-gold)' : '#c0392b', color: toast.ok ? 'var(--bc-dark)' : '#fff' }}>{toast.msg}</div>
      )}

      {/* Back */}
      <button onClick={() => router.push('/admin/projects')}
        className="text-sm mb-4 hover:underline" style={{ color: 'var(--bc-muted)' }}>
        ← All Projects
      </button>

      <SettlementCard projectId={project.id} />

      {/* Hero */}
      <div className="rounded-xl border overflow-hidden mb-5" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
        <div className="px-6 pt-6 pb-4">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <h1 className="text-2xl font-bold">{project.name}</h1>
                <span className={`badge ${stageBadge[project.stage] || 'badge-gray'} text-xs`}>{project.stage}</span>
                {pendingDraws.length > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded-full font-bold" style={{ background: 'rgba(201,164,87,0.2)', color: 'var(--bc-gold-ink)' }}>
                    {pendingDraws.length} draw{pendingDraws.length > 1 ? 's' : ''} pending
                  </span>
                )}
              </div>
              <div className="text-sm" style={{ color: 'var(--bc-muted)' }}>
                {project.address}{project.city ? `, ${project.city}` : ''}{project.state ? ` ${project.state}` : ''}{project.zip ? ` ${project.zip}` : ''}
                {project.loan_number && <span className="ml-3 font-mono text-xs">#{project.loan_number}</span>}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <select value={project.stage} disabled={stageUpdating}
                onChange={e => updateStage(e.target.value)}
                className="rounded-lg px-3 py-1.5 text-xs font-semibold outline-none"
                style={{ background: 'rgba(13,27,42,0.06)', border: '1px solid var(--bc-border)', color: 'var(--bc-text)' }}>
                {STAGES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1).replace('_', ' ')}</option>)}
              </select>
              {project.archived_at ? (
                <button onClick={unarchiveProject}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold border transition-all hover:bg-slate-900/5"
                  style={{ borderColor: 'var(--bc-border)', color: '#15803d' }}>
                  ↩ Restore
                </button>
              ) : (
                <button onClick={archiveProject}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold border transition-all hover:bg-slate-900/5"
                  style={{ borderColor: 'var(--bc-border)', color: 'var(--bc-muted)' }}>
                  Archive
                </button>
              )}
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            {[
              { label: 'Loan Amount', value: formatCurrency(project.loan_amount), color: 'var(--bc-text)' },
              { label: 'Amount Drawn', value: formatCurrency(drawn), color: 'var(--bc-gold-ink)' },
              { label: 'Available', value: formatCurrency(available), color: '#15803d' },
              { label: 'Interest Rate', value: project.interest_rate ? `${project.interest_rate}%` : '—', color: 'var(--bc-blue)' },
            ].map(s => (
              <div key={s.label} className="rounded-lg p-3 border text-center" style={{ background: 'rgba(13,27,42,0.03)', borderColor: 'var(--bc-border)' }}>
                <div className="text-lg font-bold" style={{ color: s.color }}>{s.value}</div>
                <div className="text-xs mt-0.5 uppercase tracking-wide" style={{ color: 'var(--bc-muted)' }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Progress bar */}
          <div>
            <div className="flex justify-between text-xs mb-1.5" style={{ color: 'var(--bc-muted)' }}>
              <span>Draw utilization</span>
              <span style={{ color: 'var(--bc-gold-ink)' }}>{drawPct}% drawn</span>
            </div>
            <div className="rounded-full overflow-hidden h-2" style={{ background: 'rgba(13,27,42,0.06)' }}>
              <div className="h-full rounded-full transition-all duration-500"
                style={{ width: `${Math.min(drawPct, 100)}%`, background: drawPct > 80 ? '#c0392b' : 'var(--bc-gold)' }} />
            </div>
          </div>
        </div>

        {/* Tabs — scrollable on mobile */}
        <div className="flex overflow-x-auto border-t scrollbar-none" style={{ borderColor: 'var(--bc-border)' }}>
          {(['overview', 'draws', 'documents', 'budget', 'activity'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className="flex-shrink-0 px-4 sm:px-5 py-3 text-sm font-semibold capitalize transition-all border-b-2"
              style={{
                borderColor: tab === t ? 'var(--bc-gold)' : 'transparent',
                color: tab === t ? 'var(--bc-gold-ink)' : 'var(--bc-muted)',
              }}>
              {t}
              {t === 'draws' && draws.length > 0 && <span className="ml-1.5 text-xs opacity-60">({draws.length})</span>}
              {t === 'documents' && docs.length > 0 && <span className="ml-1.5 text-xs opacity-60">({docs.length})</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Overview */}
      {tab === 'overview' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {[
            {
              title: 'Property Details',
              rows: [
                ['Type', project.property_type?.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()) || '—'],
                ['Address', project.address || '—'],
                ['City / State / ZIP', [project.city, project.state, project.zip].filter(Boolean).join(', ') || '—'],
                ['Appraised Value', project.appraised_value ? formatCurrency(project.appraised_value) : '—'],
                ['LTV', project.ltv ? `${project.ltv}%` : '—'],
                ['Maturity Date', project.maturity_date ? new Date(project.maturity_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '—'],
              ]
            },
            {
              title: 'Borrower',
              rows: [
                ['Company', borrower?.company_name || '—'],
                ['Contact', borrower?.contact_name || '—'],
                ['Email', borrower?.email || '—'],
                ['Phone', borrower?.phone || '—'],
                ['Rating', borrower?.rating || '—'],
                ['License', borrower?.license_number ? `${borrower.license_number} (${borrower.license_state})` : '—'],
              ]
            },
            {
              title: 'Lender',
              rows: [
                ['Company', lender?.company_name || '—'],
                ['Contact', lender?.contact_name || '—'],
                ['Email', lender?.email || '—'],
                ['Phone', lender?.phone || '—'],
                ['Max LTV', lender?.max_ltv ? `${lender.max_ltv}%` : '—'],
                ['Loan Types', lender?.loan_types?.join(', ') || '—'],
              ]
            },
            {
              title: 'Notes',
              rows: [['', project.notes || 'No notes on this project.']]
            }
          ].map(card => (
            <div key={card.title} className="rounded-xl border p-5" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
              <h3 className="text-xs font-bold uppercase tracking-wide mb-4" style={{ color: 'var(--bc-muted)' }}>{card.title}</h3>
              <div className="space-y-2.5">
                {card.rows.map(([label, value]) => (
                  <div key={label} className="flex justify-between text-sm gap-4">
                    {label && <span style={{ color: 'var(--bc-muted)' }}>{label}</span>}
                    <span className="font-medium text-right">{value}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* XRPL Digital Title — full width below the grid */}
          <div className="col-span-2 rounded-xl border p-5" style={{
            background: project.loan_nft_token_id
              ? 'rgba(201,164,87,0.04)'
              : 'var(--bc-card)',
            borderColor: project.loan_nft_token_id
              ? 'rgba(201,164,87,0.2)'
              : 'var(--bc-border)',
          }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--bc-gold-ink)' }}>
                ⬡ XRPL Digital Title
              </h3>
              {project.loan_nft_token_id && (
                <span className={`badge ${project.loan_nft_burn_hash ? 'badge-gray' : 'badge-green'} text-xs`}>
                  {project.loan_nft_burn_hash ? 'Burned (Loan Complete)' : 'Active'}
                </span>
              )}
            </div>

            {project.loan_nft_token_id ? (
              <div className="space-y-3 text-sm">
                <div className="flex justify-between items-center gap-4">
                  <span style={{ color: 'var(--bc-muted)' }}>NFT Token ID</span>
                  <a href={`${TESTNET_NFT}/${project.loan_nft_token_id}`}
                    target="_blank" rel="noreferrer"
                    className="font-mono text-xs hover:underline" style={{ color: 'var(--bc-gold-ink)' }}>
                    {project.loan_nft_token_id.slice(0, 14)}…{project.loan_nft_token_id.slice(-8)} ↗
                  </a>
                </div>
                {project.loan_nft_mint_hash && (
                  <div className="flex justify-between items-center gap-4">
                    <span style={{ color: 'var(--bc-muted)' }}>Mint TX</span>
                    <a href={`${TESTNET_EXPLORER}/${project.loan_nft_mint_hash}`}
                      target="_blank" rel="noreferrer"
                      className="font-mono text-xs hover:underline" style={{ color: 'var(--bc-muted)' }}>
                      {project.loan_nft_mint_hash.slice(0, 14)}…{project.loan_nft_mint_hash.slice(-8)} ↗
                    </a>
                  </div>
                )}
                {project.loan_nft_burn_hash && (
                  <div className="flex justify-between items-center gap-4">
                    <span style={{ color: 'var(--bc-muted)' }}>Settlement TX</span>
                    <a href={`${TESTNET_EXPLORER}/${project.loan_nft_burn_hash}`}
                      target="_blank" rel="noreferrer"
                      className="font-mono text-xs hover:underline" style={{ color: '#15803d' }}>
                      {project.loan_nft_burn_hash.slice(0, 14)}…{project.loan_nft_burn_hash.slice(-8)} ↗
                    </a>
                  </div>
                )}
                <p className="text-xs pt-1" style={{ color: 'var(--bc-muted)' }}>
                  One token per loan — minted at origination, burned at payoff.
                  {!project.loan_nft_burn_hash && ' Escrow TX hashes on each draw serve as the per-draw record.'}
                </p>
              </div>
            ) : (
              <div>
                <p className="text-sm" style={{ color: 'var(--bc-muted)' }}>
                  No ledger record exists for this loan.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Draws */}
      {tab === 'draws' && (
        <div className="rounded-xl border overflow-hidden" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
          <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--bc-border)' }}>
            <h2 className="text-sm font-bold">Draw Requests</h2>
            <span className="text-xs" style={{ color: 'var(--bc-muted)' }}>{draws.length} total</span>
          </div>
          {draws.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <div className="text-4xl mb-3">💵</div>
              <div className="font-semibold mb-1">No draw requests yet</div>
              <div className="text-sm" style={{ color: 'var(--bc-muted)' }}>Draw requests will appear here once the borrower submits them.</div>
            </div>
          ) : (
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b" style={{ borderColor: 'var(--bc-border)' }}>
                  {['Request #', 'Amount', 'Phase', 'Submitted', 'Status', 'Verification', 'Actions'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wide whitespace-nowrap" style={{ color: 'var(--bc-muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {draws.map((d: any) => {
                  const insp = inspectionState(inspections[d.id] || [], d.inspection_done)
                  const tokenMethod = isTokenMethod(d.settlement_method ?? project.settlement_method)
                  const approvedOpen = d.status === 'approved' && !d.funded_at
                  return (
                  <tr key={d.id} className="border-b last:border-0 hover:bg-slate-900/[0.02] align-top" style={{ borderColor: '#edf0f4' }}>
                    <td className="px-4 py-3 font-bold" style={{ color: 'var(--bc-gold-ink)' }}>{d.request_number}</td>
                    <td className="px-4 py-3 font-semibold whitespace-nowrap">
                      {formatCurrency(d.amount)}
                      {d.net_amount != null && Number(d.net_amount) !== Number(d.amount) && (
                        <div className="text-xs font-normal" style={{ color: 'var(--bc-muted)' }}>net {formatCurrency(d.net_amount)}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">{d.phase || d.purpose || '—'}</td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap" style={{ color: 'var(--bc-muted)' }}>{d.submitted_at ? timeAgo(d.submitted_at) : '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`badge ${drawStatusBadge[d.status] || 'badge-gray'}`}>{drawStatusLabel[d.status] ?? d.status}</span>
                      {d.status === 'held' && d.hold_reason && (
                        <div className="text-xs mt-1.5 max-w-[14rem]" style={{ color: 'var(--bc-muted)' }}>Reason: {d.hold_reason}</div>
                      )}
                    </td>

                    {/* Verification column: the true state of the two conditions */}
                    <td className="px-4 py-3">
                      {d.status === 'funded' ? (
                        <div className="text-xs">
                          <div className="font-semibold" style={{ color: d.verification_receipt ? '#15803d' : 'var(--bc-muted)' }}>
                            {d.verification_receipt ? 'Released automatically' : 'Released manually'}
                          </div>
                          {d.funded_at && <div className="mt-0.5" style={{ color: 'var(--bc-muted)' }}>{timeAgo(d.funded_at)}</div>}
                          {d.escrow_finish_hash && (
                            <a href={`${TESTNET_EXPLORER}/${d.escrow_finish_hash}`} target="_blank" rel="noreferrer"
                              className="font-mono hover:underline block mt-0.5" style={{ color: 'var(--bc-blue)', fontSize: 10 }}>
                              release {d.escrow_finish_hash.slice(0, 6)}…
                            </a>
                          )}
                        </div>
                      ) : ['approved', 'submitted', 'pending', 'held'].includes(d.status) ? (
                        <div className="space-y-1 text-xs">
                          <div style={{ color: insp.state === 'passed' && insp.recorded ? '#15803d' : 'var(--bc-muted)' }}>
                            Inspection: {insp.state === 'none' ? 'none assigned'
                              : insp.state === 'pending' ? 'pending'
                              : insp.state === 'failed' ? 'failed'
                              : insp.recorded ? 'passed, recorded on the ledger' : 'passed, not recorded on the ledger'}
                          </div>
                          <div style={{ color: d.lien_waiver_nft_id ? '#15803d' : 'var(--bc-muted)' }}>
                            Lien waivers: {d.lien_waiver_nft_id
                              ? 'confirmed and recorded on the ledger'
                              : d.lien_waiver ? 'not confirmed (stated by the contractor or Building Block)' : 'not confirmed'}
                          </div>
                          {d.escrow_txn_hash && (
                            <a href={`${TESTNET_EXPLORER}/${d.escrow_txn_hash}`} target="_blank" rel="noreferrer"
                              className="font-mono hover:underline block" style={{ color: 'var(--bc-blue)', fontSize: 10 }}>
                              escrow {d.escrow_txn_hash.slice(0, 6)}…
                            </a>
                          )}
                        </div>
                      ) : d.escrow_txn_hash ? (
                        <a href={`${TESTNET_EXPLORER}/${d.escrow_txn_hash}`} target="_blank" rel="noreferrer"
                          className="text-xs font-mono hover:underline" style={{ color: 'var(--bc-blue)' }}>
                          {d.escrow_txn_hash.slice(0, 8)}…
                        </a>
                      ) : (
                        <span style={{ color: 'var(--bc-muted)', fontSize: 12 }}>—</span>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3">
                      {['submitted', 'pending'].includes(d.status) && (
                        <div className="flex gap-1.5">
                          <button onClick={() => updateDraw(d.id, 'approved')}
                            disabled={drawActionId === d.id + 'approved'}
                            className="px-2 py-1 rounded text-xs font-bold"
                            style={{ background: 'var(--bc-blue)', color: '#fff' }}>
                            {drawActionId === d.id + 'approved' ? '…' : 'Approve'}
                          </button>
                          <button onClick={() => declineDraw(d.id)}
                            disabled={drawActionId === d.id + 'declined'}
                            className="px-2 py-1 rounded text-xs font-bold"
                            style={{ background: 'rgba(231,76,60,0.15)', color: '#c0392b' }}>
                            {drawActionId === d.id + 'declined' ? '…' : 'Decline'}
                          </button>
                        </div>
                      )}
                      {d.status === 'held' && (
                        <button onClick={() => updateDraw(d.id, 'submitted')}
                          disabled={drawActionId === d.id + 'submitted'}
                          className="px-2 py-1 rounded text-xs font-bold whitespace-nowrap"
                          style={{ background: 'var(--bc-blue)', color: '#fff' }}>
                          {drawActionId === d.id + 'submitted' ? '…' : 'Take off hold'}
                        </button>
                      )}
                      {approvedOpen && (
                        <div className="flex flex-col gap-1" style={{ minWidth: 150 }}>
                          {/* Shown until the confirmation is recorded on the ledger */}
                          {!d.lien_waiver_nft_id && (
                            <button
                              onClick={() => confirmLienWaiver(d.id)}
                              disabled={lienWaiverLoading === d.id}
                              className="px-2 py-1 rounded text-xs font-bold whitespace-nowrap"
                              style={{ background: 'rgba(46,204,113,0.15)', color: '#15803d' }}>
                              {lienWaiverLoading === d.id ? '…' : 'Confirm lien waivers'}
                            </button>
                          )}
                          <button
                            onClick={() => checkAgain(d.id)}
                            disabled={checkLoading === d.id}
                            title="Retry any missing ledger record and release the draw if both conditions are recorded"
                            className="px-2 py-1 rounded text-xs font-bold whitespace-nowrap border"
                            style={{ borderColor: 'var(--bc-border)', color: 'var(--bc-text)' }}>
                            {checkLoading === d.id ? 'Checking…' : 'Check again'}
                          </button>
                          {/* Manual release: pilot method only */}
                          {!tokenMethod && (
                            <button onClick={() => releaseDrawManually(d.id)}
                              disabled={drawActionId === d.id + 'funded'}
                              className="px-2 py-1 rounded text-xs font-bold text-left"
                              style={{ background: 'rgba(201,164,87,0.15)', color: 'var(--bc-gold-ink)' }}>
                              {drawActionId === d.id + 'funded' ? '…' : 'Release without both conditions (pilot only)'}
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
            </div>
          )}
        </div>
      )}

      {/* Documents */}
      {tab === 'documents' && (
        <div className="rounded-xl border overflow-hidden" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
          <div className="px-5 py-4 border-b" style={{ borderColor: 'var(--bc-border)' }}>
            <h2 className="text-sm font-bold">Project Documents</h2>
          </div>
          {docs.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <div className="text-4xl mb-3">📁</div>
              <div className="font-semibold mb-1">No documents yet</div>
            </div>
          ) : (
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b" style={{ borderColor: 'var(--bc-border)' }}>
                  {['Document', 'Type', 'Size', 'Uploaded', 'Status', ''].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--bc-muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {docs.map((doc: any) => (
                  <tr key={doc.id} className="border-b last:border-0 hover:bg-slate-900/[0.02]" style={{ borderColor: '#edf0f4' }}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span>{doc.required ? '📌' : '📄'}</span>
                        <div>
                          <div className="font-semibold">{doc.name}</div>
                          {doc.file_name && <div className="text-xs font-mono mt-0.5" style={{ color: 'var(--bc-muted)' }}>{doc.file_name}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs">{doc.doc_type?.replace(/_/g, ' ') || '—'}</td>
                    <td className="px-4 py-3 text-xs">{doc.file_size ? `${(doc.file_size / 1024).toFixed(0)} KB` : '—'}</td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--bc-muted)' }}>{doc.uploaded_at ? timeAgo(doc.uploaded_at) : '—'}</td>
                    <td className="px-4 py-3"><span className={`badge ${docStatusBadge[doc.status] || 'badge-gray'}`}>{doc.status}</span></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {doc.storage_path && (
                          <a href={`/api/documents/${doc.id}/view`} target="_blank" rel="noopener noreferrer"
                            className="text-xs font-medium hover:underline"
                            style={{ color: 'var(--bc-blue)' }}>
                            View ↗
                          </a>
                        )}
                        {/* Approve / Reject — only show when status is uploaded or pending_review */}
                        {(doc.status === 'uploaded' || doc.status === 'pending_review') && (
                          <>
                            <button
                              onClick={() => updateDoc(doc.id, 'approved')}
                              disabled={docActionId === doc.id + 'approved'}
                              className="text-xs font-bold px-2 py-0.5 rounded transition-all"
                              style={{ background: 'rgba(39,174,96,0.15)', color: '#15803d' }}>
                              {docActionId === doc.id + 'approved' ? '…' : '✓ Approve'}
                            </button>
                            <button
                              onClick={() => updateDoc(doc.id, 'rejected')}
                              disabled={docActionId === doc.id + 'rejected'}
                              className="text-xs font-bold px-2 py-0.5 rounded transition-all"
                              style={{ background: 'rgba(231,76,60,0.1)', color: '#c0392b' }}>
                              {docActionId === doc.id + 'rejected' ? '…' : '✗ Reject'}
                            </button>
                          </>
                        )}
                        {doc.status === 'rejected' && (
                          <button
                            onClick={() => updateDoc(doc.id, 'approved')}
                            disabled={docActionId === doc.id + 'approved'}
                            className="text-xs font-bold px-2 py-0.5 rounded transition-all"
                            style={{ background: 'rgba(39,174,96,0.1)', color: '#15803d' }}>
                            {docActionId === doc.id + 'approved' ? '…' : '↩ Re-approve'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </div>
      )}

      {/* Budget / SOV */}
      {tab === 'budget' && (
        <div className="rounded-xl border p-6" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
          <BudgetTab projectId={project.id} readOnly={false} />
        </div>
      )}

      {/* Activity */}
      {tab === 'activity' && (
        <div className="rounded-xl border overflow-hidden" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
          <div className="px-5 py-4 border-b" style={{ borderColor: 'var(--bc-border)' }}>
            <h2 className="text-sm font-bold">Activity Log</h2>
          </div>
          {activity.length === 0 ? (
            <div className="px-5 py-12 text-center" style={{ color: 'var(--bc-muted)' }}>No activity yet.</div>
          ) : (
            <div className="divide-y" style={{ borderColor: '#edf0f4' }}>
              {activity.map((a: any) => (
                <div key={a.id} className="px-5 py-3 flex items-start gap-3 hover:bg-slate-900/[0.02]">
                  <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                    style={{ background: 'rgba(45,125,210,0.15)', color: 'var(--bc-blue)', fontSize: 12 }}>
                    ⊙
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium capitalize">{a.action.replace(/_/g, ' ')}</div>
                    {a.profiles?.full_name && (
                      <div className="text-xs mt-0.5" style={{ color: 'var(--bc-muted)' }}>by {a.profiles.full_name}</div>
                    )}
                  </div>
                  <div className="text-xs flex-shrink-0" style={{ color: 'var(--bc-muted)' }}>{timeAgo(a.created_at)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
