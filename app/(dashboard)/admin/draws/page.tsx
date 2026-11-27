'use client'

import { useState, useEffect } from 'react'
import { formatCurrency, timeAgo } from '@/lib/utils'
import type { DrawRequest } from '@/lib/types/database'

type XrplDraw = DrawRequest & {
  escrow_sequence: number | null
  escrow_txn_hash: string | null
  escrow_finish_hash: string | null
  escrow_finish_after: string | null
  // Migration 012 — on-ledger NFT evidence (Patent §IV + §V)
  lien_waiver_nft_id: string | null
  lien_waiver_nft_minted_at: string | null
  verification_receipt: {
    verified_at: string
    inspector_credential_nft: string | null
    lien_waiver_nft: string | null
    escrow_finish_hash: string | null
    trigger: string
    patent_ref: string
  } | null
  // Migrations 014 and 020
  hold_reason?: string | null
  net_amount?: number | null
  settlement_method?: string | null
  settlement_state?: string | null
}

type DrawWithProject = XrplDraw & {
  projects: { id: string; name: string; loan_number: string; loan_amount: number; amount_drawn: number }
}

interface Inspection {
  id: string
  status: 'pending' | 'passed' | 'failed' | 'cancelled'
  inspector_name: string
  inspector_email: string
  scheduled_date: string | null
  submitted_at: string | null
  notes: string | null
  token: string
  credential_nft_id?: string | null
}

const TESTNET_EXPLORER = 'https://testnet.xrpl.org/transactions'
const BASE_URL = typeof window !== 'undefined' ? window.location.origin : 'https://www.buildchain.finance'

// Dollar-token methods: the lender signs to lock, and release is automatic.
const isTokenMethod = (m: string | null | undefined) => m === 'token_escrow' || m === 'two_signature'

function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return 'less than a minute'
  if (s < 3600) return `${Math.round(s / 60)} min`
  if (s < 86400) return `${Math.round(s / 3600)} hr`
  return `${Math.round(s / 86400)} days`
}

/** The escrow has a "not before" time. Say plainly which side of it we are on. */
function releasableText(iso: string): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const diff = t - Date.now()
  if (diff > 0) return `Releasable in ${duration(diff)}`
  return `Releasable since ${new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
}

type InspectionState = 'none' | 'pending' | 'passed' | 'failed'

function inspectionState(list: Inspection[], inspectionDone: boolean | null | undefined) {
  const passed = list.find(i => i.status === 'passed')
  const pending = list.find(i => i.status === 'pending')
  const failed = list.find(i => i.status === 'failed')
  const state: InspectionState = passed || inspectionDone ? 'passed' : pending ? 'pending' : failed ? 'failed' : 'none'
  return {
    state,
    shown: passed ?? pending ?? failed ?? null,
    recorded: list.some(i => i.status === 'passed' && !!i.credential_nft_id),
  }
}

export default function AdminDrawsPage() {
  const [draws, setDraws] = useState<DrawWithProject[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [filter, setFilter] = useState<string>('submitted')
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [lienWaiverLoading, setLienWaiverLoading] = useState<string | null>(null)
  const [checkLoading, setCheckLoading] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  const [notice, setNotice] = useState<{ title: string; msg: string; error: boolean } | null>(null)

  // Decline / hold: both ask for a reason
  const [reasonModal, setReasonModal] = useState<{ draw: DrawWithProject; kind: 'declined' | 'held' } | null>(null)
  const [reasonText, setReasonText] = useState('')
  // Manual release (pilot method only): asks first
  const [releaseModal, setReleaseModal] = useState<DrawWithProject | null>(null)
  // Shown when an inspection was assigned but its email did not go out
  const [linkModal, setLinkModal] = useState<{ name: string; email: string; url: string; why: string | null } | null>(null)

  // Inspection state
  const [inspections, setInspections] = useState<Record<string, Inspection[]>>({})
  const [inspectModal, setInspectModal] = useState<DrawWithProject | null>(null)
  const [inspectForm, setInspectForm] = useState({ inspector_name: '', inspector_email: '', scheduled_date: '' })
  const [inspectSubmitting, setInspectSubmitting] = useState(false)

  useEffect(() => { fetchDraws() }, [filter])

  function showToast(msg: string, ok = true, ms = 4000) {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), ms)
  }
  const showError = (msg: string) => setNotice({ title: 'Action failed', msg, error: true })

  async function fetchDraws() {
    setLoading(true)
    setLoadError('')
    try {
      const params = filter === 'all' ? '' : `?status=${filter}`
      const res = await fetch(`/api/draws${params}`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setDraws([])
        setLoadError(json.error ?? `The draws could not be loaded (${res.status})`)
        return
      }
      const drawList: DrawWithProject[] = json.data || []
      setDraws(drawList)
      // Load inspections for all draws in the background
      drawList.forEach(d => loadInspections(d.id))
    } catch (e) {
      setDraws([])
      setLoadError(e instanceof Error ? e.message : 'The draws could not be loaded')
    } finally {
      setLoading(false)
    }
  }

  async function loadInspections(drawId: string) {
    try {
      const res = await fetch(`/api/inspections?draw_request_id=${drawId}`)
      if (!res.ok) return
      const json = await res.json()
      if (json.data) {
        setInspections(prev => ({ ...prev, [drawId]: json.data }))
      }
    } catch { /* the column shows "none" until it loads */ }
  }

  // Confirm that lien waivers are in hand: the server records it on the
  // ledger and releases the draw if the inspection is recorded too.
  async function confirmLienWaiver(id: string) {
    setLienWaiverLoading(id)
    try {
      const res = await fetch(`/api/draws/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lien_waiver: true }),
      })
      const json = await res.json().catch(() => ({}))
      if (res.ok) {
        showToast('Lien waiver confirmation saved. The row shows whether it is recorded on the ledger.', true, 6000)
        fetchDraws()
      } else {
        showError(json.error ?? `Lien waiver confirmation failed (${res.status})`)
      }
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Lien waiver confirmation failed')
    } finally {
      setLienWaiverLoading(null)
    }
  }

  // Retry any missing ledger record and attempt the release.
  async function checkAgain(id: string) {
    setCheckLoading(id)
    try {
      const res = await fetch(`/api/draws/${id}/conditions`, { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        showError(json.error ?? `The check could not be run (${res.status})`)
      } else if (json.released) {
        showToast('Both conditions are recorded. The draw was released.', true, 6000)
      } else {
        const insp = json.inspection
          ? `Inspection: ${json.inspection.passed ? 'passed' : 'not passed'}, ${json.inspection.recorded ? 'recorded on the ledger' : 'not recorded on the ledger'}.`
          : ''
        const lw = json.lienWaiver
          ? `Lien waivers: ${json.lienWaiver.confirmed ? 'confirmed' : 'not confirmed'}, ${json.lienWaiver.recorded ? 'recorded on the ledger' : 'not recorded on the ledger'}.`
          : ''
        setNotice({
          title: 'Not released',
          msg: [json.reason ?? 'The draw was not released.', insp, lw].filter(Boolean).join(' '),
          error: false,
        })
      }
      fetchDraws()
    } catch (e) {
      showError(e instanceof Error ? e.message : 'The check could not be run')
    } finally {
      setCheckLoading(null)
    }
  }

  /** Returns true when the server accepted the change. */
  async function updateDraw(id: string, status: string, reasons?: { decline_reason?: string; hold_reason?: string }): Promise<boolean> {
    setActionLoading(id + status)
    try {
      const res = await fetch(`/api/draws/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, ...(reasons ?? {}) }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        showError(json.error ?? `The draw could not be updated (${res.status})`)
        return false
      }
      const verb = status === 'approved'
          ? (json.data?.escrow_txn_hash
              ? 'Draw approved. A test escrow is recorded on the XRP Ledger test network.'
              : 'Draw approved. No ledger escrow was created.')
        : status === 'funded' ? 'Draw released (pilot method, test network).'
        : status === 'held' ? 'Draw placed on hold.'
        : status === 'submitted' ? 'Draw taken off hold. It is back in review.'
        : status === 'declined' ? 'Draw declined.'
        : `Draw ${status}.`
      showToast(verb)
      fetchDraws()
      return true
    } catch (e) {
      showError(e instanceof Error ? e.message : 'The draw could not be updated')
      return false
    } finally {
      setActionLoading(null)
    }
  }

  async function submitReason() {
    if (!reasonModal) return
    const reason = reasonText.trim()
    if (!reason) return
    const { draw, kind } = reasonModal
    const ok = await updateDraw(draw.id, kind, kind === 'declined' ? { decline_reason: reason } : { hold_reason: reason })
    if (ok) { setReasonModal(null); setReasonText('') }
  }

  async function submitInspection(draw: DrawWithProject) {
    if (!inspectForm.inspector_name.trim() || !inspectForm.inspector_email.trim()) return
    setInspectSubmitting(true)
    try {
      const name = inspectForm.inspector_name.trim()
      const email = inspectForm.inspector_email.trim()
      const res = await fetch('/api/inspections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          draw_request_id: draw.id,
          project_id: (draw.projects as any)?.id ?? undefined,
          inspector_name: name,
          inspector_email: email,
          scheduled_date: inspectForm.scheduled_date || null,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (res.ok) {
        if (json.email_sent === true) {
          showToast(`Inspection assigned to ${name}. Email sent to ${email}.`)
        } else {
          // The email did not go out: put the link in front of the admin.
          const url = json.inspect_url ?? (json.data?.token ? `${BASE_URL}/inspect/${json.data.token}` : '')
          setLinkModal({ name, email, url, why: json.email_error ?? null })
        }
        setInspectModal(null)
        setInspectForm({ inspector_name: '', inspector_email: '', scheduled_date: '' })
        loadInspections(draw.id)
      } else {
        showError(json.error ?? `The inspection could not be assigned (${res.status})`)
      }
    } catch (e) {
      showError(e instanceof Error ? e.message : 'The inspection could not be assigned')
    } finally {
      setInspectSubmitting(false)
    }
  }

  function copyLink(url: string) {
    navigator.clipboard.writeText(url).then(
      () => showToast('Link copied', true, 2500),
      () => showToast('The link could not be copied. Select it and copy it by hand.', false, 5000),
    )
  }

  const statusBadge: Record<string, string> = {
    pending: 'badge-yellow', submitted: 'badge-blue', approved: 'badge-blue',
    funded: 'badge-green', declined: 'badge-red', draft: 'badge-gray', held: 'badge-yellow',
  }
  const statusLabel: Record<string, string> = { funded: 'released', held: 'on hold' }
  const inspectStatusColor: Record<InspectionState, string> = {
    none: 'var(--bc-muted)', pending: 'var(--bc-gold-ink)', passed: '#15803d', failed: '#c0392b',
  }

  const FILTERS = ['submitted', 'held', 'approved', 'funded', 'declined', 'all']
  const filterLabel: Record<string, string> = { held: 'on hold', funded: 'released' }

  const fieldStyle = { background: 'rgba(13,27,42,0.05)', border: '1px solid var(--bc-border)', color: 'var(--bc-text)' }
  const smallBtn = 'px-2.5 py-1 rounded-lg text-xs font-bold transition-all w-full whitespace-nowrap'
  const outlineStyle = { borderColor: 'var(--bc-border)', color: 'var(--bc-text)', background: 'transparent' }

  return (
    <div>
      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-[70] px-4 py-3 rounded-xl text-sm font-bold shadow-xl max-w-sm"
          style={{ background: toast.ok ? 'var(--bc-gold)' : '#c0392b', color: toast.ok ? 'var(--bc-dark)' : '#fff' }}>
          {toast.msg}
        </div>
      )}

      {/* Notice / error modal */}
      {notice && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40"
          onClick={() => setNotice(null)}>
          <div className="rounded-xl border p-6 max-w-md w-full mx-4" onClick={e => e.stopPropagation()}
            style={{ background: 'var(--bc-navy)', borderColor: 'var(--bc-border)' }}>
            <div className={`text-lg font-bold mb-2 ${notice.error ? 'text-red-700' : ''}`}>{notice.title}</div>
            <div className="text-sm mb-4" style={{ color: 'var(--bc-muted)' }}>{notice.msg}</div>
            <button onClick={() => setNotice(null)}
              className="px-4 py-2 rounded-lg text-sm font-bold"
              style={{ background: 'var(--bc-gold)', color: 'var(--bc-dark)' }}>
              OK
            </button>
          </div>
        </div>
      )}

      {/* Decline / hold reason */}
      {reasonModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={() => { setReasonModal(null); setReasonText('') }}>
          <div className="rounded-xl border w-full max-w-md" onClick={e => e.stopPropagation()}
            style={{ background: 'var(--bc-navy)', borderColor: 'var(--bc-border)' }}>
            <div className="px-5 py-4 border-b" style={{ borderColor: 'var(--bc-border)' }}>
              <div className="font-bold">{reasonModal.kind === 'declined' ? 'Decline draw' : 'Place draw on hold'}</div>
              <div className="text-xs mt-0.5" style={{ color: 'var(--bc-muted)' }}>
                {reasonModal.draw.request_number} · {reasonModal.draw.projects?.name} · {formatCurrency(reasonModal.draw.amount)}
              </div>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--bc-muted)' }}>
                  Reason *
                </label>
                <textarea
                  value={reasonText}
                  onChange={e => setReasonText(e.target.value)}
                  rows={4}
                  autoFocus
                  placeholder={reasonModal.kind === 'declined'
                    ? 'Why this draw is declined. The contractor sees this.'
                    : 'What is needed before this draw can move. The contractor sees this.'}
                  className="w-full rounded-lg px-3 py-2.5 text-sm outline-none"
                  style={fieldStyle}
                />
                {reasonModal.kind === 'declined' && (
                  <p className="text-xs mt-1.5" style={{ color: 'var(--bc-muted)' }}>A declined draw is final and cannot be reopened.</p>
                )}
              </div>
              <div className="flex gap-3">
                <button
                  onClick={submitReason}
                  disabled={!reasonText.trim() || actionLoading === reasonModal.draw.id + reasonModal.kind}
                  className="flex-1 py-2.5 rounded-lg text-sm font-bold"
                  style={{
                    background: reasonModal.kind === 'declined' ? '#c0392b' : 'var(--bc-gold)',
                    color: reasonModal.kind === 'declined' ? '#fff' : 'var(--bc-dark)',
                    opacity: !reasonText.trim() ? 0.5 : 1,
                  }}>
                  {actionLoading === reasonModal.draw.id + reasonModal.kind
                    ? 'Saving…'
                    : reasonModal.kind === 'declined' ? 'Decline draw' : 'Place on hold'}
                </button>
                <button onClick={() => { setReasonModal(null); setReasonText('') }}
                  className="px-4 py-2.5 rounded-lg text-sm font-semibold border"
                  style={{ borderColor: 'var(--bc-border)', color: 'var(--bc-muted)' }}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Manual release confirm (pilot method only) */}
      {releaseModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={() => setReleaseModal(null)}>
          <div className="rounded-xl border p-6 w-full max-w-md" onClick={e => e.stopPropagation()}
            style={{ background: 'var(--bc-navy)', borderColor: 'var(--bc-border)' }}>
            <div className="text-lg font-bold mb-2">Release without both conditions?</div>
            <div className="text-sm mb-2" style={{ color: 'var(--bc-muted)' }}>
              {releaseModal.request_number} · {releaseModal.projects?.name} · {formatCurrency(releaseModal.amount)}
            </div>
            <div className="text-sm mb-4" style={{ color: 'var(--bc-muted)' }}>
              This marks the draw released and finishes its test escrow on the XRP Ledger test network without
              checking that the inspection and the lien waivers are both recorded. It is for the pilot only.
              No dollars move. It cannot be undone.
            </div>
            <div className="flex gap-3">
              <button
                onClick={async () => { const d = releaseModal; await updateDraw(d.id, 'funded'); setReleaseModal(null) }}
                disabled={actionLoading === releaseModal.id + 'funded'}
                className="flex-1 py-2.5 rounded-lg text-sm font-bold"
                style={{ background: 'var(--bc-gold)', color: 'var(--bc-dark)' }}>
                {actionLoading === releaseModal.id + 'funded' ? 'Releasing…' : 'Release (pilot only)'}
              </button>
              <button onClick={() => setReleaseModal(null)}
                className="px-4 py-2.5 rounded-lg text-sm font-semibold border"
                style={{ borderColor: 'var(--bc-border)', color: 'var(--bc-muted)' }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Inspection assigned, email not sent: show the link */}
      {linkModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={() => setLinkModal(null)}>
          <div className="rounded-xl border p-6 w-full max-w-md" onClick={e => e.stopPropagation()}
            style={{ background: 'var(--bc-navy)', borderColor: 'var(--bc-border)' }}>
            <div className="text-lg font-bold mb-2">Inspection assigned. The email could not be sent: copy the link</div>
            <div className="text-sm mb-3" style={{ color: 'var(--bc-muted)' }}>
              {linkModal.name} ({linkModal.email}) has not been told. Send them this link yourself.
              {linkModal.why ? ` Reason: ${linkModal.why}.` : ''}
            </div>
            {linkModal.url ? (
              <input readOnly value={linkModal.url} onFocus={e => e.currentTarget.select()}
                className="w-full rounded-lg px-3 py-2.5 text-xs font-mono outline-none mb-4" style={fieldStyle} />
            ) : (
              <div className="text-sm mb-4" style={{ color: '#c0392b' }}>
                The link was not returned. Use "Copy link" in the Inspection column of the draw.
              </div>
            )}
            <div className="flex gap-3">
              {linkModal.url && (
                <button onClick={() => copyLink(linkModal.url)}
                  className="px-4 py-2 rounded-lg text-sm font-bold"
                  style={{ background: 'var(--bc-gold)', color: 'var(--bc-dark)' }}>
                  Copy link
                </button>
              )}
              <button onClick={() => setLinkModal(null)}
                className="px-4 py-2 rounded-lg text-sm font-semibold border"
                style={{ borderColor: 'var(--bc-border)', color: 'var(--bc-muted)' }}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Assign Inspection Modal */}
      {inspectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={() => setInspectModal(null)}>
          <div className="rounded-xl border w-full max-w-md" onClick={e => e.stopPropagation()}
            style={{ background: 'var(--bc-navy)', borderColor: 'var(--bc-border)' }}>
            <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--bc-border)' }}>
              <div>
                <div className="font-bold">
                  {(inspections[inspectModal.id] || []).length > 0 ? 'Assign re-inspection' : 'Assign Inspection'}
                </div>
                <div className="text-xs mt-0.5" style={{ color: 'var(--bc-muted)' }}>
                  {inspectModal.request_number} · {(inspectModal.projects as any)?.name}
                </div>
              </div>
              <button onClick={() => setInspectModal(null)} className="text-lg" style={{ color: 'var(--bc-muted)' }}>✕</button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--bc-muted)' }}>
                  Inspector Name *
                </label>
                <input
                  value={inspectForm.inspector_name}
                  onChange={e => setInspectForm(f => ({ ...f, inspector_name: e.target.value }))}
                  placeholder="John Smith"
                  className="w-full rounded-lg px-3 py-2.5 text-sm outline-none"
                  style={fieldStyle}
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--bc-muted)' }}>
                  Inspector Email *
                </label>
                <input
                  type="email"
                  value={inspectForm.inspector_email}
                  onChange={e => setInspectForm(f => ({ ...f, inspector_email: e.target.value }))}
                  placeholder="inspector@company.com"
                  className="w-full rounded-lg px-3 py-2.5 text-sm outline-none"
                  style={fieldStyle}
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--bc-muted)' }}>
                  Scheduled Date (optional)
                </label>
                <input
                  type="date"
                  value={inspectForm.scheduled_date}
                  onChange={e => setInspectForm(f => ({ ...f, scheduled_date: e.target.value }))}
                  className="w-full rounded-lg px-3 py-2.5 text-sm outline-none"
                  style={fieldStyle}
                />
              </div>
              <div className="pt-1 flex gap-3">
                <button
                  onClick={() => submitInspection(inspectModal)}
                  disabled={inspectSubmitting || !inspectForm.inspector_name || !inspectForm.inspector_email}
                  className="flex-1 py-2.5 rounded-lg text-sm font-bold"
                  style={{
                    background: inspectSubmitting || !inspectForm.inspector_name || !inspectForm.inspector_email
                      ? 'rgba(201,164,87,0.4)' : 'var(--bc-gold)',
                    color: 'var(--bc-dark)',
                    cursor: !inspectForm.inspector_name || !inspectForm.inspector_email ? 'not-allowed' : 'pointer',
                  }}>
                  {inspectSubmitting ? 'Assigning…' : 'Assign and send email'}
                </button>
                <button onClick={() => setInspectModal(null)}
                  className="px-4 py-2.5 rounded-lg text-sm font-semibold border"
                  style={{ borderColor: 'var(--bc-border)', color: 'var(--bc-muted)' }}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold">Draw Requests</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--bc-muted)' }}>
            Review draws, their two conditions, and release. Pilot on the XRP Ledger test network.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {FILTERS.map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold capitalize border transition-all"
              style={{
                background: filter === f ? 'var(--bc-gold)' : 'transparent',
                color: filter === f ? 'var(--bc-dark)' : 'var(--bc-muted)',
                borderColor: filter === f ? 'var(--bc-gold)' : 'var(--bc-border)',
              }}>
              {filterLabel[f] ?? f}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border overflow-hidden" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
        {loading ? (
          <div className="p-8 text-center" style={{ color: 'var(--bc-muted)' }}>Loading…</div>
        ) : loadError ? (
          <div className="p-8 text-center text-sm" style={{ color: '#c0392b' }}>{loadError}</div>
        ) : draws.length === 0 ? (
          <div className="p-8 text-center" style={{ color: 'var(--bc-muted)' }}>
            No {filter === 'all' ? '' : `${filterLabel[filter] ?? filter} `}draw requests
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b" style={{ borderColor: 'var(--bc-border)' }}>
                  {['Request #', 'Project', 'Amount', 'Phase', 'Inspection', 'Lien waivers', 'Submitted', 'Status', 'XRPL', 'Actions'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--bc-muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {draws.map(draw => {
                  const status = draw.status as string
                  const insp = inspectionState(inspections[draw.id] || [], draw.inspection_done)
                  const open = !['funded', 'declined'].includes(status)
                  const approvedOpen = status === 'approved' && !draw.funded_at
                  const tokenMethod = isTokenMethod(draw.settlement_method)

                  return (
                    <tr key={draw.id} className="border-b last:border-0 hover:bg-slate-900/[0.02] align-top" style={{ borderColor: '#edf0f4' }}>
                      <td className="px-4 py-3 font-bold" style={{ color: 'var(--bc-gold-ink)' }}>{draw.request_number}</td>
                      <td className="px-4 py-3">
                        <div className="font-medium">{draw.projects?.name}</div>
                        <div className="text-xs" style={{ color: 'var(--bc-muted)' }}>{draw.projects?.loan_number}</div>
                      </td>
                      <td className="px-4 py-3 font-bold">{formatCurrency(draw.amount)}</td>
                      <td className="px-4 py-3 text-xs">{draw.phase || draw.purpose}</td>

                      {/* Inspection column: the true state, in words */}
                      <td className="px-4 py-3">
                        <div className="space-y-1 text-xs">
                          <div className="font-semibold" style={{ color: inspectStatusColor[insp.state] }}>
                            {insp.state === 'none' ? 'None assigned'
                              : insp.state === 'pending' ? 'Pending'
                              : insp.state === 'passed' ? 'Passed'
                              : 'Failed'}
                          </div>
                          {insp.state === 'passed' && (
                            <div style={{ color: insp.recorded ? '#15803d' : 'var(--bc-muted)' }}>
                              {insp.recorded ? 'Recorded on the ledger' : 'Not recorded on the ledger'}
                            </div>
                          )}
                          {insp.shown && (
                            <div style={{ color: 'var(--bc-muted)' }}>{insp.shown.inspector_name}</div>
                          )}
                          {insp.state === 'pending' && insp.shown && (
                            <button
                              onClick={() => copyLink(`${BASE_URL}/inspect/${insp.shown!.token}`)}
                              className="font-semibold hover:underline block"
                              style={{ color: 'var(--bc-blue)' }}>
                              Copy link
                            </button>
                          )}
                          {open && (insp.state === 'none' || insp.state === 'failed') && (
                            <button
                              onClick={() => setInspectModal(draw)}
                              className="font-semibold px-2 py-1 rounded border transition-all hover:bg-slate-900/5 whitespace-nowrap"
                              style={{ color: 'var(--bc-gold-ink)', borderColor: 'rgba(201,164,87,0.3)' }}>
                              {insp.state === 'failed' ? 'Assign re-inspection' : '+ Assign'}
                            </button>
                          )}
                        </div>
                      </td>

                      {/* Lien waivers: confirmed means confirmed AND recorded on the ledger */}
                      <td className="px-4 py-3 text-xs">
                        {draw.lien_waiver_nft_id ? (
                          <span className="font-semibold" style={{ color: '#15803d' }}>Confirmed and recorded on the ledger</span>
                        ) : (
                          <div>
                            <div className="font-semibold" style={{ color: 'var(--bc-muted)' }}>Not confirmed</div>
                            {draw.lien_waiver && (
                              <div style={{ color: 'var(--bc-muted)' }}>Stated by the contractor or Building Block</div>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--bc-muted)' }}>
                        {draw.submitted_at ? timeAgo(draw.submitted_at) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`badge ${statusBadge[status] || 'badge-gray'}`}>{statusLabel[status] ?? status}</span>
                        {status === 'held' && draw.hold_reason && (
                          <div className="text-xs mt-1.5 max-w-[14rem]" style={{ color: 'var(--bc-muted)' }}>
                            Reason: {draw.hold_reason}
                          </div>
                        )}
                        {status === 'declined' && draw.decline_reason && (
                          <div className="text-xs mt-1.5 max-w-[14rem]" style={{ color: 'var(--bc-muted)' }}>
                            Reason: {draw.decline_reason}
                          </div>
                        )}
                      </td>

                      {/* XRPL escrow + ledger records */}
                      <td className="px-4 py-3">
                        {draw.escrow_txn_hash || draw.lien_waiver_nft_id || draw.verification_receipt ? (
                          <div className="text-xs space-y-0.5">
                            {draw.escrow_txn_hash && (
                              <a href={`${TESTNET_EXPLORER}/${draw.escrow_txn_hash}`} target="_blank" rel="noreferrer"
                                className="block font-mono hover:underline" style={{ color: 'var(--bc-blue)' }}>
                                {draw.escrow_txn_hash.slice(0, 8)}…
                              </a>
                            )}
                            {draw.escrow_finish_after && !draw.escrow_finish_hash && status !== 'funded' && (
                              <div className="whitespace-nowrap" style={{ color: 'var(--bc-muted)' }}>
                                {releasableText(draw.escrow_finish_after)}
                              </div>
                            )}
                            {draw.lien_waiver_nft_id && (
                              <div className="font-mono" style={{ color: '#15803d' }}>
                                LW {draw.lien_waiver_nft_id.slice(0, 6)}…
                              </div>
                            )}
                            {draw.escrow_finish_hash ? (
                              <a href={`${TESTNET_EXPLORER}/${draw.escrow_finish_hash}`} target="_blank" rel="noreferrer"
                                className="block hover:underline whitespace-nowrap" style={{ color: '#15803d' }}>
                                {draw.verification_receipt ? 'Released automatically ↗' : 'Released ↗'}
                              </a>
                            ) : draw.verification_receipt ? (
                              <div className="font-bold whitespace-nowrap" style={{ color: '#15803d' }}>Released automatically</div>
                            ) : null}
                          </div>
                        ) : <span style={{ color: 'var(--bc-muted)' }}>—</span>}
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3">
                        {/* Pending / submitted: approve, hold or decline */}
                        {['pending', 'submitted'].includes(status) && (
                          <div className="space-y-1.5" style={{ minWidth: 110 }}>
                            <button
                              onClick={() => updateDraw(draw.id, 'approved')}
                              disabled={actionLoading === draw.id + 'approved'}
                              title="Approve this draw. On the pilot method this locks a test escrow on the XRP Ledger test network."
                              className={smallBtn}
                              style={{ background: 'var(--bc-blue)', color: '#fff' }}>
                              {actionLoading === draw.id + 'approved' ? '…' : 'Approve'}
                            </button>
                            <button
                              onClick={() => { setReasonText(''); setReasonModal({ draw, kind: 'held' }) }}
                              className={`${smallBtn} border`} style={outlineStyle}>
                              Hold
                            </button>
                            <button
                              onClick={() => { setReasonText(''); setReasonModal({ draw, kind: 'declined' }) }}
                              className={`${smallBtn} border`}
                              style={{ background: 'rgba(231,76,60,0.1)', color: '#c0392b', borderColor: 'rgba(231,76,60,0.3)' }}>
                              Decline
                            </button>
                          </div>
                        )}

                        {/* On hold: take it off hold, or decline */}
                        {status === 'held' && (
                          <div className="space-y-1.5" style={{ minWidth: 110 }}>
                            <button
                              onClick={() => updateDraw(draw.id, 'submitted')}
                              disabled={actionLoading === draw.id + 'submitted'}
                              className={smallBtn}
                              style={{ background: 'var(--bc-blue)', color: '#fff' }}>
                              {actionLoading === draw.id + 'submitted' ? '…' : 'Take off hold'}
                            </button>
                            <button
                              onClick={() => { setReasonText(''); setReasonModal({ draw, kind: 'declined' }) }}
                              className={`${smallBtn} border`}
                              style={{ background: 'rgba(231,76,60,0.1)', color: '#c0392b', borderColor: 'rgba(231,76,60,0.3)' }}>
                              Decline
                            </button>
                          </div>
                        )}

                        {/* Approved, not released: conditions, hold, and the pilot-only manual release */}
                        {approvedOpen && (
                          <div className="space-y-1.5" style={{ minWidth: 150 }}>
                            {!draw.lien_waiver_nft_id && (
                              <button
                                onClick={() => confirmLienWaiver(draw.id)}
                                disabled={lienWaiverLoading === draw.id}
                                title="Confirm the lien waivers are in hand. This records the confirmation on the ledger and releases the draw if the inspection is recorded too."
                                className={smallBtn}
                                style={{ background: 'rgba(74,222,128,0.12)', color: '#15803d', border: '1px solid rgba(74,222,128,0.3)' }}>
                                {lienWaiverLoading === draw.id ? '…' : 'Confirm lien waivers'}
                              </button>
                            )}
                            <button
                              onClick={() => checkAgain(draw.id)}
                              disabled={checkLoading === draw.id}
                              title="Retry any missing ledger record and release the draw if both conditions are recorded"
                              className={`${smallBtn} border`} style={outlineStyle}>
                              {checkLoading === draw.id ? 'Checking…' : 'Check again'}
                            </button>
                            <button
                              onClick={() => { setReasonText(''); setReasonModal({ draw, kind: 'held' }) }}
                              className={`${smallBtn} border`} style={outlineStyle}>
                              Hold
                            </button>
                            {!tokenMethod && (
                              <button
                                onClick={() => setReleaseModal(draw)}
                                disabled={actionLoading === draw.id + 'funded'}
                                className="px-2.5 py-1 rounded-lg text-xs font-bold transition-all w-full text-left"
                                style={{ background: 'rgba(201,164,87,0.15)', color: 'var(--bc-gold-ink)' }}>
                                {actionLoading === draw.id + 'funded' ? '…' : 'Release without both conditions (pilot only)'}
                              </button>
                            )}
                          </div>
                        )}

                        {status === 'funded' && draw.funded_at && (
                          <div className="text-xs space-y-0.5">
                            {draw.verification_receipt ? (
                              <div className="font-semibold" style={{ color: '#15803d' }}>Released automatically</div>
                            ) : (
                              <div style={{ color: 'var(--bc-muted)' }}>Released manually</div>
                            )}
                            <div style={{ color: 'var(--bc-muted)' }}>{timeAgo(draw.funded_at)}</div>
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
    </div>
  )
}
