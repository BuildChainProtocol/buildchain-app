'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { formatCurrency, timeAgo } from '@/lib/utils'

const STAGES = ['application', 'review', 'approved', 'active', 'complete', 'cancelled']
const stageBadge: Record<string, string> = {
  active: 'badge-green', approved: 'badge-blue', review: 'badge-yellow',
  application: 'badge-gray', complete: 'badge-blue', cancelled: 'badge-red',
}
const drawStatusBadge: Record<string, string> = {
  draft: 'badge-gray', submitted: 'badge-blue', pending: 'badge-yellow',
  approved: 'badge-blue', funded: 'badge-green', declined: 'badge-red',
}
const docStatusBadge: Record<string, string> = {
  required: 'badge-yellow', uploaded: 'badge-blue', approved: 'badge-green',
  rejected: 'badge-red', overdue: 'badge-red', not_required: 'badge-gray',
}

const TESTNET_EXPLORER = 'https://testnet.xrpl.org/transactions'
const TESTNET_NFT = 'https://testnet.xrpl.org/nft'

export default function ProjectDetailPage() {
  const params = useParams()
  const router = useRouter()
  const [project, setProject] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'overview' | 'draws' | 'documents' | 'activity'>('overview')
  const [stageUpdating, setStageUpdating] = useState(false)
  const [drawActionId, setDrawActionId] = useState<string | null>(null)
  const [docActionId, setDocActionId] = useState<string | null>(null)
  const [toast, setToast] = useState('')

  const load = useCallback(async () => {
    const res = await fetch(`/api/projects/${params.id}`)
    const json = await res.json()
    setProject(json.data)
    setLoading(false)
  }, [params.id])

  useEffect(() => { load() }, [load])

  async function updateStage(stage: string) {
    setStageUpdating(true)
    await fetch(`/api/projects/${params.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage }),
    })
    await load()
    setStageUpdating(false)
    setToast(`Stage updated to ${stage}`)
    setTimeout(() => setToast(''), 3000)
  }

  async function updateDraw(drawId: string, status: string) {
    setDrawActionId(drawId + status)
    await fetch(`/api/draws/${drawId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    await load()
    setDrawActionId(null)
    setToast(`Draw ${status}`)
    setTimeout(() => setToast(''), 3000)
  }

  async function updateDoc(docId: string, status: 'approved' | 'rejected') {
    setDocActionId(docId + status)
    await fetch(`/api/documents/${docId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    await load()
    setDocActionId(null)
    setToast(`Document ${status}`)
    setTimeout(() => setToast(''), 3000)
  }

  async function archiveProject() {
    const confirmed = window.confirm('Archive this project? It will be hidden from the active list but all data is preserved.')
    if (!confirmed) return
    await fetch(`/api/projects/${params.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archived_at: new Date().toISOString() }),
    })
    router.push('/admin/projects')
  }

  async function unarchiveProject() {
    await fetch(`/api/projects/${params.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archived_at: null }),
    })
    await load()
    setToast('Project restored to active')
    setTimeout(() => setToast(''), 3000)
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="text-sm" style={{ color: 'var(--bc-muted)' }}>Loading project…</div>
    </div>
  )

  if (!project) return (
    <div className="flex items-center justify-center h-64">
      <div className="text-sm" style={{ color: 'var(--bc-muted)' }}>Project not found.</div>
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
        <div className="fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl text-sm font-bold shadow-xl"
          style={{ background: 'var(--bc-gold)', color: 'var(--bc-dark)' }}>✓ {toast}</div>
      )}

      {/* Back */}
      <button onClick={() => router.push('/admin/projects')}
        className="text-sm mb-4 hover:underline" style={{ color: 'var(--bc-muted)' }}>
        ← All Projects
      </button>

      {/* Hero */}
      <div className="rounded-xl border overflow-hidden mb-5" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
        <div className="px-6 pt-6 pb-4">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <h1 className="text-2xl font-bold">{project.name}</h1>
                <span className={`badge ${stageBadge[project.stage] || 'badge-gray'} text-xs`}>{project.stage}</span>
                {pendingDraws.length > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded-full font-bold" style={{ background: 'rgba(243,156,18,0.2)', color: 'var(--bc-gold)' }}>
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
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid var(--bc-border)', color: '#e8edf2' }}>
                {STAGES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1).replace('_', ' ')}</option>)}
              </select>
              {project.archived_at ? (
                <button onClick={unarchiveProject}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold border transition-all hover:bg-white/5"
                  style={{ borderColor: 'var(--bc-border)', color: '#2ecc71' }}>
                  ↩ Restore
                </button>
              ) : (
                <button onClick={archiveProject}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold border transition-all hover:bg-white/5"
                  style={{ borderColor: 'var(--bc-border)', color: 'var(--bc-muted)' }}>
                  Archive
                </button>
              )}
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-4 gap-4 mb-4">
            {[
              { label: 'Loan Amount', value: formatCurrency(project.loan_amount), color: '#e8edf2' },
              { label: 'Amount Drawn', value: formatCurrency(drawn), color: 'var(--bc-gold)' },
              { label: 'Available', value: formatCurrency(available), color: '#2ecc71' },
              { label: 'Interest Rate', value: project.interest_rate ? `${project.interest_rate}%` : '—', color: 'var(--bc-blue)' },
            ].map(s => (
              <div key={s.label} className="rounded-lg p-3 border text-center" style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'var(--bc-border)' }}>
                <div className="text-lg font-bold" style={{ color: s.color }}>{s.value}</div>
                <div className="text-xs mt-0.5 uppercase tracking-wide" style={{ color: 'var(--bc-muted)' }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Progress bar */}
          <div>
            <div className="flex justify-between text-xs mb-1.5" style={{ color: 'var(--bc-muted)' }}>
              <span>Draw utilization</span>
              <span style={{ color: 'var(--bc-gold)' }}>{drawPct}% drawn</span>
            </div>
            <div className="rounded-full overflow-hidden h-2" style={{ background: 'rgba(255,255,255,0.06)' }}>
              <div className="h-full rounded-full transition-all duration-500"
                style={{ width: `${Math.min(drawPct, 100)}%`, background: drawPct > 80 ? '#e74c3c' : 'var(--bc-gold)' }} />
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-t" style={{ borderColor: 'var(--bc-border)' }}>
          {(['overview', 'draws', 'documents', 'activity'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className="px-5 py-3 text-sm font-semibold capitalize transition-all border-b-2"
              style={{
                borderColor: tab === t ? 'var(--bc-gold)' : 'transparent',
                color: tab === t ? 'var(--bc-gold)' : 'var(--bc-muted)',
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
        <div className="grid grid-cols-2 gap-5">
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
              ? 'rgba(243,156,18,0.04)'
              : 'var(--bc-card)',
            borderColor: project.loan_nft_token_id
              ? 'rgba(243,156,18,0.2)'
              : 'var(--bc-border)',
          }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--bc-gold)' }}>
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
                    className="font-mono text-xs hover:underline" style={{ color: 'var(--bc-gold)' }}>
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
                      className="font-mono text-xs hover:underline" style={{ color: '#4ade80' }}>
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
                  No digital title minted. Set <code className="text-xs px-1 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.06)' }}>XRPL_WALLET_SEED</code> and{' '}
                  <code className="text-xs px-1 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.06)' }}>XRPL_DEFAULT_DESTINATION</code>{' '}
                  in Vercel environment variables, then new projects will mint a loan NFT at origination.
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
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b" style={{ borderColor: 'var(--bc-border)' }}>
                  {['Request #', 'Amount', 'Phase', 'Submitted', 'Status', 'XRPL', 'Actions'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--bc-muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {draws.map((d: any) => (
                  <tr key={d.id} className="border-b last:border-0 hover:bg-white/[0.02]" style={{ borderColor: 'rgba(42,63,87,0.4)' }}>
                    <td className="px-4 py-3 font-bold" style={{ color: 'var(--bc-gold)' }}>{d.request_number}</td>
                    <td className="px-4 py-3 font-semibold">{formatCurrency(d.amount)}</td>
                    <td className="px-4 py-3 text-xs">{d.phase || d.purpose || '—'}</td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--bc-muted)' }}>{d.submitted_at ? timeAgo(d.submitted_at) : '—'}</td>
                    <td className="px-4 py-3"><span className={`badge ${drawStatusBadge[d.status] || 'badge-gray'}`}>{d.status}</span></td>
                    <td className="px-4 py-3">
                      {d.escrow_txn_hash ? (
                        <a href={`${TESTNET_EXPLORER}/${d.escrow_txn_hash}`} target="_blank" rel="noreferrer"
                          className="text-xs font-mono hover:underline" style={{ color: 'var(--bc-blue)' }}>
                          {d.escrow_txn_hash.slice(0, 8)}…
                        </a>
                      ) : <span style={{ color: 'var(--bc-muted)' }}>—</span>}
                    </td>
                    <td className="px-4 py-3">
                      {['submitted', 'pending'].includes(d.status) && (
                        <div className="flex gap-1.5">
                          <button onClick={() => updateDraw(d.id, 'approved')}
                            disabled={drawActionId === d.id + 'approved'}
                            className="px-2 py-1 rounded text-xs font-bold"
                            style={{ background: 'var(--bc-blue)', color: '#fff' }}>
                            {drawActionId === d.id + 'approved' ? '…' : 'Approve'}
                          </button>
                          <button onClick={() => updateDraw(d.id, 'declined')}
                            disabled={drawActionId === d.id + 'declined'}
                            className="px-2 py-1 rounded text-xs font-bold"
                            style={{ background: 'rgba(231,76,60,0.15)', color: '#e74c3c' }}>
                            ✗
                          </button>
                        </div>
                      )}
                      {d.status === 'approved' && (
                        <button onClick={() => updateDraw(d.id, 'funded')}
                          disabled={drawActionId === d.id + 'funded'}
                          className="px-2 py-1 rounded text-xs font-bold"
                          style={{ background: 'var(--bc-gold)', color: 'var(--bc-dark)' }}>
                          {drawActionId === d.id + 'funded' ? '…' : '↑ Release'}
                        </button>
                      )}
                      {d.status === 'funded' && (
                        <span className="text-xs" style={{ color: '#2ecc71' }}>Funded {d.funded_at ? timeAgo(d.funded_at) : ''}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
                  <tr key={doc.id} className="border-b last:border-0 hover:bg-white/[0.02]" style={{ borderColor: 'rgba(42,63,87,0.4)' }}>
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
                              style={{ background: 'rgba(39,174,96,0.15)', color: '#27ae60' }}>
                              {docActionId === doc.id + 'approved' ? '…' : '✓ Approve'}
                            </button>
                            <button
                              onClick={() => updateDoc(doc.id, 'rejected')}
                              disabled={docActionId === doc.id + 'rejected'}
                              className="text-xs font-bold px-2 py-0.5 rounded transition-all"
                              style={{ background: 'rgba(231,76,60,0.1)', color: '#e74c3c' }}>
                              {docActionId === doc.id + 'rejected' ? '…' : '✗ Reject'}
                            </button>
                          </>
                        )}
                        {doc.status === 'rejected' && (
                          <button
                            onClick={() => updateDoc(doc.id, 'approved')}
                            disabled={docActionId === doc.id + 'approved'}
                            className="text-xs font-bold px-2 py-0.5 rounded transition-all"
                            style={{ background: 'rgba(39,174,96,0.1)', color: '#27ae60' }}>
                            {docActionId === doc.id + 'approved' ? '…' : '↩ Re-approve'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
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
            <div className="divide-y" style={{ borderColor: 'rgba(42,63,87,0.4)' }}>
              {activity.map((a: any) => (
                <div key={a.id} className="px-5 py-3 flex items-start gap-3 hover:bg-white/[0.02]">
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
