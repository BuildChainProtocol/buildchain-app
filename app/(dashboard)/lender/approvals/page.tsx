'use client'

import { useState, useEffect } from 'react'
import { formatCurrency, timeAgo } from '@/lib/utils'
import SignDrawPanel from '@/components/lender/SignDrawPanel'
import LenderWalletCard from '@/components/lender/LenderWalletCard'

type TabKey = 'submitted' | 'held' | 'approved' | 'funded' | 'declined'

interface DrawLineItem {
  id: string
  work_completed_period: number
  materials_stored: number
  total_completed_stored: number
  percent_complete: number
  retainage_amount: number
  current_payment_due: number
  budget_line_items: { line_no: string; description: string; scheduled_value: number; trade: string | null }
}

interface LienWaiver {
  id: string
  sub_name: string
  sub_code: string | null
  waiver_type: string
  through_amount: number
  status: string
  signed_by: string | null
}

interface VerificationReceipt {
  verified_at: string
  inspector_credential_nft: string | null
  lien_waiver_nft: string | null
  escrow_finish_hash: string | null
  trigger: string
  patent_ref: string
}

interface Draw {
  id: string
  request_number: string
  amount: number
  net_amount: number | null
  retainage_held: number | null
  phase: string
  purpose: string
  description: string
  // Set when an inspection passes
  inspection_done: boolean
  // The contractor's statement that its lien waivers are signed. It is not the
  // lender's confirmation: that is lien_waiver_nft_id.
  lien_waiver: boolean
  submitted_at: string
  reviewed_at: string | null
  funded_at: string | null
  status: string
  hold_reason: string | null
  decline_reason: string | null
  settlement_method: string | null
  settlement_state: string | null
  escrow_txn_hash: string | null
  escrow_finish_hash: string | null
  nft_token_id: string | null
  nft_mint_hash: string | null
  // Present once the lender has confirmed the lien waivers and the ledger record exists
  lien_waiver_nft_id: string | null
  lien_waiver_nft_minted_at: string | null
  // Written when both conditions were recorded and the draw was released
  verification_receipt: VerificationReceipt | null
  projects: { name: string; loan_number: string; loan_amount: number; amount_drawn: number; settlement_method?: string | null }
}

interface ConditionsResult {
  ok: boolean
  inspection: { passed: boolean; recorded: boolean }
  lienWaiver: { confirmed: boolean; recorded: boolean }
  released: boolean
  reason?: string
}

// The pilot runs on the XRP Ledger test network. Every explorer link on this page starts here.
const XRPL_EXPLORER = 'https://testnet.xrpl.org'

// What each tab asks the server for
const TAB_STATUS: Record<TabKey, string> = {
  submitted: 'submitted,pending',
  held: 'held',
  approved: 'approved',
  funded: 'funded',
  declined: 'declined',
}

const TABS: { key: TabKey; label: string; badge: string; badgeCls: string; emptyTitle: string; emptyMsg: string }[] = [
  { key: 'submitted', label: 'Pending Review', badge: 'Awaiting Review', badgeCls: 'badge-yellow', emptyTitle: 'Nothing awaiting review', emptyMsg: 'No pending draw requests.' },
  { key: 'held', label: 'On hold', badge: 'On hold', badgeCls: 'badge-gray', emptyTitle: 'No draws on hold', emptyMsg: 'Draws you put on hold appear here with the reason.' },
  { key: 'approved', label: 'Approved', badge: 'Approved', badgeCls: 'badge-green', emptyTitle: 'No approved draws waiting on release', emptyMsg: 'Approved draws appear here until they are released.' },
  { key: 'funded', label: 'Released', badge: 'Released', badgeCls: 'badge-blue', emptyTitle: 'No released draws yet', emptyMsg: 'Released draws appear here with their ledger records.' },
  { key: 'declined', label: 'Declined', badge: 'Declined', badgeCls: 'badge-red', emptyTitle: 'No declined draws', emptyMsg: 'No declined draws.' },
]

const EMPTY: Record<TabKey, Draw[]> = { submitted: [], held: [], approved: [], funded: [], declined: [] }

const isTokenMethod = (method: string | null | undefined) => method === 'token_escrow' || method === 'two_signature'
const longDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
const shortHash = (h: string) => `${h.slice(0, 10)}…${h.slice(-6)}`

export default function LenderApprovalsPage() {
  const [tab, setTab] = useState<TabKey>('submitted')
  const [draws, setDraws] = useState<Record<TabKey, Draw[]>>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [expandedDrawId, setExpandedDrawId] = useState<string | null>(null)
  const [drawLines, setDrawLines] = useState<Record<string, DrawLineItem[]>>({})
  const [drawWaivers, setDrawWaivers] = useState<Record<string, LienWaiver[]>>({})
  const [detailError, setDetailError] = useState<Record<string, string>>({})
  const [detailLoading, setDetailLoading] = useState<string | null>(null)
  // One modal asks for the reason for a decline or a hold
  const [reasonModal, setReasonModal] = useState<{ draw: Draw; mode: 'decline' | 'hold' } | null>(null)
  const [reasonText, setReasonText] = useState('')
  const [lienWaiverLoading, setLienWaiverLoading] = useState<string | null>(null)
  // Draws whose lien waivers this lender confirmed in this visit (the ledger record follows shortly)
  const [waiverSent, setWaiverSent] = useState<Record<string, boolean>>({})
  const [checkLoading, setCheckLoading] = useState<string | null>(null)
  const [checkNote, setCheckNote] = useState<Record<string, string>>({})

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchAll() }, [])

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 5000)
  }

  async function fetchAll(silent = false) {
    if (!silent) setLoading(true)
    const keys = Object.keys(TAB_STATUS) as TabKey[]
    const results = await Promise.all(keys.map(async key => {
      try {
        const res = await fetch(`/api/draws?status=${TAB_STATUS[key]}`, { cache: 'no-store' })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) return { key, data: null as Draw[] | null, error: json.error || `Request failed (${res.status})` }
        return { key, data: (json.data || []) as Draw[], error: '' }
      } catch {
        return { key, data: null as Draw[] | null, error: 'The server could not be reached' }
      }
    }))
    setDraws(prev => {
      const next = { ...prev }
      for (const r of results) if (r.data) next[r.key] = r.data
      return next
    })
    const failed = results.find(r => r.error)
    if (failed) setErrorMsg(`Draws could not be loaded: ${failed.error}`)
    setLoading(false)
  }

  async function toggleDrawDetail(drawId: string) {
    if (expandedDrawId === drawId) { setExpandedDrawId(null); return }
    setExpandedDrawId(drawId)
    if (drawLines[drawId] && !detailError[drawId]) return  // already loaded
    setDetailLoading(drawId)
    try {
      const [linesRes, waiversRes] = await Promise.all([
        fetch(`/api/draw-lines?draw_request_id=${drawId}`),
        fetch(`/api/lien-waivers?draw_request_id=${drawId}`),
      ])
      const linesJson = await linesRes.json().catch(() => ({}))
      const waiversJson = await waiversRes.json().catch(() => ({}))
      const problem = !linesRes.ok
        ? `Line items could not be loaded: ${linesJson.error || linesRes.status}`
        : !waiversRes.ok
          ? `Lien waivers could not be loaded: ${waiversJson.error || waiversRes.status}`
          : ''
      setDetailError(prev => ({ ...prev, [drawId]: problem }))
      setDrawLines(prev => ({ ...prev, [drawId]: linesRes.ok ? linesJson.data || [] : [] }))
      setDrawWaivers(prev => ({ ...prev, [drawId]: waiversRes.ok ? waiversJson.data || [] : [] }))
    } catch {
      setDetailError(prev => ({ ...prev, [drawId]: 'The details could not be loaded: the server could not be reached' }))
    }
    setDetailLoading(null)
  }

  // The lender's own confirmation that the lien waivers are in hand. The server
  // records it on the ledger and releases the draw once the inspection has passed too.
  async function confirmLienWaiver(id: string) {
    setLienWaiverLoading(id)
    setErrorMsg('')
    try {
      const res = await fetch(`/api/draws/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lien_waiver: true }),
      })
      const json = await res.json().catch(() => ({}))
      if (res.ok) {
        setWaiverSent(prev => ({ ...prev, [id]: true }))
        setCheckNote(prev => ({ ...prev, [id]: '' }))
        showToast('Lien waiver confirmation saved. It is being recorded on the ledger.')
        fetchAll(true)
      } else {
        setErrorMsg(json.error || `Lien waiver confirmation failed (${res.status})`)
      }
    } catch {
      setErrorMsg('Lien waiver confirmation failed: the server could not be reached')
    }
    setLienWaiverLoading(null)
  }

  // Retries any missing ledger record for an approved draw and attempts release
  async function checkAgain(id: string) {
    setCheckLoading(id)
    setErrorMsg('')
    try {
      const res = await fetch(`/api/draws/${id}/conditions`, { method: 'POST' })
      const json: Partial<ConditionsResult> & { error?: string } = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErrorMsg(json.error || `The check failed (${res.status})`)
      } else if (json.released) {
        setCheckNote(prev => ({ ...prev, [id]: '' }))
        showToast('Draw released. It is now under Released.')
      } else {
        setCheckNote(prev => ({ ...prev, [id]: json.reason || 'Not released yet.' }))
      }
    } catch {
      setErrorMsg('The check failed: the server could not be reached')
    }
    await fetchAll(true)
    setCheckLoading(null)
  }

  // The draw whose approval is open for signing (dollar-token loans sign in Xaman).
  const [signDrawId, setSignDrawId] = useState<string | null>(null)

  async function act(id: string, status: 'approved' | 'held' | 'declined' | 'submitted', reason?: string) {
    setActionLoading(id + status)
    setErrorMsg('')
    try {
      const res = await fetch(`/api/draws/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status,
          ...(status === 'declined' && reason ? { decline_reason: reason } : {}),
          ...(status === 'held' && reason ? { hold_reason: reason } : {}),
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (res.ok) {
        // Only say the ledger holds a record when the returned draw carries one
        const msg =
          status === 'approved' ? (json.data?.escrow_txn_hash ? 'Draw approved and recorded on the XRP Ledger' : 'Draw approved')
          : status === 'held' ? 'Draw put on hold'
          : status === 'submitted' ? 'Draw taken off hold. It is back under Pending Review.'
          : 'Draw declined'
        showToast(msg)
        fetchAll(true)
      } else {
        setErrorMsg(json.error || `Request failed (${res.status})`)
      }
    } catch {
      setErrorMsg('Request failed: the server could not be reached')
    }
    setActionLoading(null)
  }

  function closeReasonModal() { setReasonModal(null); setReasonText('') }

  const current = draws[tab]
  const activeTab = TABS.find(t => t.key === tab)!
  const holdMode = reasonModal?.mode === 'hold'

  return (
    <div>
      {signDrawId && (
        <SignDrawPanel
          drawId={signDrawId}
          onApprove={() => { const id = signDrawId; setSignDrawId(null); act(id, 'approved') }}
          onClose={() => setSignDrawId(null)}
        />
      )}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl text-sm font-bold shadow-xl"
          style={{ background: toast.ok ? 'var(--bc-gold)' : '#c0392b', color: '#fff' }}>
          {toast.msg}
        </div>
      )}

      {/* Reason modal: decline or hold */}
      {reasonModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={closeReasonModal}>
          <div className="rounded-xl border w-full max-w-md" onClick={e => e.stopPropagation()}
            style={{ background: 'var(--bc-navy)', borderColor: 'var(--bc-border)' }}>
            <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--bc-border)' }}>
              <div>
                <div className="font-bold">{holdMode ? 'Put Draw On Hold' : 'Decline Draw Request'}</div>
                <div className="text-xs mt-0.5" style={{ color: 'var(--bc-muted)' }}>
                  {reasonModal.draw.request_number} · {formatCurrency(reasonModal.draw.amount)}
                </div>
              </div>
              <button onClick={closeReasonModal} aria-label="Close"
                className="text-lg" style={{ color: 'var(--bc-muted)' }}>✕</button>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm" style={{ color: 'var(--bc-muted)' }}>
                {holdMode
                  ? 'The draw stays open and is not declined. The contractor is told it is on hold and sees this reason. You can take it off hold at any time.'
                  : 'The borrower will receive an email with this reason. Be specific: they need to know what to correct.'}
              </p>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--bc-muted)' }}>
                  {holdMode ? 'Reason for the hold *' : 'Decline Reason *'}
                </label>
                <textarea
                  value={reasonText}
                  onChange={e => setReasonText(e.target.value)}
                  rows={3}
                  placeholder={holdMode
                    ? 'e.g. Waiting on the revised inspection report for the framing line.'
                    : 'e.g. Inspection not yet completed. Please schedule and submit inspector report before resubmitting.'}
                  className="w-full rounded-lg px-3 py-2.5 text-sm outline-none resize-none"
                  style={{ background: 'rgba(13,27,42,0.05)', border: '1px solid var(--bc-border)', color: 'var(--bc-text)' }}
                />
              </div>
              <div className="flex gap-3 pt-1">
                {holdMode ? (
                  <button
                    onClick={async () => {
                      const { draw } = reasonModal
                      const reason = reasonText.trim()
                      if (!reason) return
                      closeReasonModal()
                      await act(draw.id, 'held', reason)
                    }}
                    disabled={!reasonText.trim() || !!actionLoading}
                    className="flex-1 py-2.5 rounded-lg text-sm font-bold disabled:opacity-50"
                    style={{ background: 'var(--bc-gold)', color: 'var(--bc-dark)' }}>
                    Put on hold
                  </button>
                ) : (
                  <button
                    onClick={async () => {
                      const { draw } = reasonModal
                      const reason = reasonText.trim() || 'Draw request did not meet approval requirements.'
                      closeReasonModal()
                      await act(draw.id, 'declined', reason)
                    }}
                    disabled={!!actionLoading}
                    className="flex-1 py-2.5 rounded-lg text-sm font-bold"
                    style={{ background: 'rgba(231,76,60,0.15)', color: '#c0392b', border: '1px solid rgba(231,76,60,0.3)' }}>
                    Confirm Decline
                  </button>
                )}
                <button onClick={closeReasonModal}
                  className="px-4 py-2.5 rounded-lg text-sm font-semibold border"
                  style={{ borderColor: 'var(--bc-border)', color: 'var(--bc-muted)' }}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="mb-6">
        <h1 className="text-2xl font-bold">Draw Requests</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--bc-muted)' }}>
          Review pending draws and track your full approval history
        </p>
      </div>

      <LenderWalletCard />

      {/* Tab bar */}
      <div className="flex flex-wrap gap-1 mb-6 p-1 rounded-xl" style={{ background: 'rgba(13,27,42,0.04)', border: '1px solid var(--bc-border)' }}>
        {TABS.map(t => {
          const count = draws[t.key].length
          const isActive = tab === t.key
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className="px-4 py-2 rounded-lg text-sm font-semibold transition-all flex items-center gap-2"
              style={{
                background: isActive ? 'rgba(201,164,87,0.12)' : 'transparent',
                color: isActive ? 'var(--bc-gold-ink)' : 'var(--bc-muted)',
                border: isActive ? '1px solid rgba(201,164,87,0.25)' : '1px solid transparent',
              }}>
              {t.label}
              {count > 0 && (
                <span className="text-xs px-1.5 py-0.5 rounded-full font-bold"
                  style={{
                    background: t.key === 'submitted' ? 'rgba(201,164,87,0.25)' : 'rgba(13,27,42,0.08)',
                    color: t.key === 'submitted' ? 'var(--bc-gold-ink)' : 'var(--bc-muted)',
                  }}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {errorMsg && (
        <div className="mb-4 p-4 rounded-xl border text-sm" style={{ background: 'rgba(231,76,60,0.1)', borderColor: 'rgba(231,76,60,0.3)', color: '#c0392b' }}>
          <strong>Error:</strong> {errorMsg}
        </div>
      )}

      {loading ? (
        <div className="p-8 text-center" style={{ color: 'var(--bc-muted)' }}>Loading…</div>
      ) : current.length === 0 ? (
        <div className="rounded-xl border p-12 text-center" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
          <p className="font-semibold mb-1">{activeTab.emptyTitle}</p>
          <p className="text-sm" style={{ color: 'var(--bc-muted)' }}>{activeTab.emptyMsg}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {current.map(draw => {
            const loan = draw.projects?.loan_amount ?? 0
            const drawnBefore = draw.projects?.amount_drawn ?? 0
            // A released draw is already counted in the amount drawn; the others are not yet
            const counted = tab === 'funded'
            const showAfter = tab === 'submitted' || tab === 'held' || tab === 'approved'
            const drawnTotal = counted || !showAfter ? drawnBefore : drawnBefore + draw.amount
            const drawnPct = draw.projects && loan > 0 ? Math.round(drawnTotal / loan * 100) : null
            const hasXrplRecords = draw.escrow_txn_hash || draw.nft_token_id || draw.lien_waiver_nft_id || draw.escrow_finish_hash
            const tokenSettled = isTokenMethod(draw.settlement_method ?? draw.projects?.settlement_method)
            const waiverRecorded = !!draw.lien_waiver_nft_id
            const bothRecorded = draw.inspection_done && waiverRecorded

            return (
              <div key={draw.id} className="rounded-xl border overflow-hidden" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>

                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-5 py-4 border-b" style={{ borderColor: 'var(--bc-border)' }}>
                  <div>
                    <div className="font-bold text-base">
                      {draw.request_number} — <span style={{ color: 'var(--bc-gold-ink)' }}>{formatCurrency(draw.amount)}</span>
                    </div>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--bc-muted)' }}>
                      {draw.projects?.name} · {draw.projects?.loan_number} ·{' '}
                      {tab === 'submitted'
                        ? `Submitted ${draw.submitted_at ? timeAgo(draw.submitted_at) : 'recently'}`
                        : tab === 'held'
                          ? `Put on hold ${draw.reviewed_at ? timeAgo(draw.reviewed_at) : 'recently'}`
                          : tab === 'funded'
                            ? (draw.funded_at ? `Released ${longDate(draw.funded_at)}` : 'Released')
                            : `Reviewed ${draw.reviewed_at ? timeAgo(draw.reviewed_at) : 'recently'}`
                      }
                    </div>
                  </div>
                  <span className={`badge self-start sm:self-auto ${activeTab.badgeCls}`}>
                    {activeTab.badge}
                  </span>
                </div>

                <div className="px-5 py-4">
                  {/* Hold reason */}
                  {tab === 'held' && (
                    <div className="text-sm p-3 rounded-lg mb-4" style={{ background: 'rgba(13,27,42,0.03)', border: '1px solid var(--bc-border)' }}>
                      <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--bc-muted)' }}>Reason for the hold</span>
                      <div className="mt-1">{draw.hold_reason || 'No reason was recorded.'}</div>
                    </div>
                  )}

                  {/* Decline reason */}
                  {tab === 'declined' && draw.decline_reason && (
                    <div className="text-sm p-3 rounded-lg mb-4" style={{ background: 'rgba(13,27,42,0.03)', border: '1px solid var(--bc-border)' }}>
                      <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--bc-muted)' }}>Decline reason</span>
                      <div className="mt-1">{draw.decline_reason}</div>
                    </div>
                  )}

                  {/* Draw details grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 mb-4">
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span style={{ color: 'var(--bc-muted)' }}>Phase</span>
                        <span className="font-semibold">{draw.phase || draw.purpose}</span>
                      </div>
                      <div className="flex justify-between">
                        <span style={{ color: 'var(--bc-muted)' }}>Amount</span>
                        <span className="font-bold bc-figure" style={{ color: 'var(--bc-gold-ink)' }}>{formatCurrency(draw.amount)}</span>
                      </div>
                      {draw.net_amount != null && draw.net_amount !== draw.amount && (
                        <div className="flex justify-between">
                          <span style={{ color: 'var(--bc-muted)' }}>Net of retainage</span>
                          <span className="font-semibold bc-figure">{formatCurrency(draw.net_amount)}</span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span style={{ color: 'var(--bc-muted)' }}>Inspection</span>
                        <span>{draw.inspection_done ? 'Passed' : 'Not yet passed'}</span>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span style={{ color: 'var(--bc-muted)' }}>Lien waivers</span>
                        <span className="text-right">
                          {waiverRecorded
                            ? 'Confirmed and recorded'
                            : draw.lien_waiver ? 'Contractor reports them signed' : 'Not reported signed'}
                        </span>
                      </div>
                    </div>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span style={{ color: 'var(--bc-muted)' }}>{showAfter ? 'Drawn after this draw' : 'Drawn to date'}</span>
                        {drawnPct == null
                          ? <span className="font-bold">—</span>
                          : <span className={`font-bold ${drawnPct > 100 ? 'text-red-700' : ''}`}>{drawnPct}% of loan</span>}
                      </div>
                      <div className="flex justify-between">
                        <span style={{ color: 'var(--bc-muted)' }}>{showAfter ? 'Remaining after' : 'Remaining'}</span>
                        <span className="font-semibold text-green-700">
                          {draw.projects ? formatCurrency(loan - drawnTotal) : '—'}
                        </span>
                      </div>
                      {tab === 'approved' && (
                        <div className="flex justify-between">
                          <span style={{ color: 'var(--bc-muted)' }}>Status</span>
                          <span className="text-amber-700 font-semibold">Waiting on release</span>
                        </div>
                      )}
                      {tab === 'funded' && (
                        <div className="flex justify-between">
                          <span style={{ color: 'var(--bc-muted)' }}>Released</span>
                          <span className="font-semibold">{draw.funded_at ? longDate(draw.funded_at) : '—'}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Ledger records: approved and released draws */}
                  {(tab === 'approved' || tab === 'funded') && hasXrplRecords && (
                    <div className="rounded-lg p-3 mb-4" style={{ background: 'rgba(201,164,87,0.05)', border: '1px solid rgba(201,164,87,0.15)' }}>
                      <p className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--bc-gold-ink)' }}>
                        Ledger records
                      </p>
                      <div className="space-y-1.5">
                        {draw.escrow_txn_hash && (
                          <div className="flex items-center justify-between text-xs">
                            <span style={{ color: 'var(--bc-muted)' }}>Escrow transaction</span>
                            <a href={`${XRPL_EXPLORER}/transactions/${draw.escrow_txn_hash}`}
                              target="_blank" rel="noopener noreferrer"
                              className="font-mono hover:underline" style={{ color: 'var(--bc-gold-ink)' }}>
                              {shortHash(draw.escrow_txn_hash)} ↗
                            </a>
                          </div>
                        )}
                        {draw.nft_token_id && (
                          <div className="flex items-center justify-between text-xs">
                            <span style={{ color: 'var(--bc-muted)' }}>Approval NFT</span>
                            <a href={`${XRPL_EXPLORER}/nft/${draw.nft_token_id}`}
                              target="_blank" rel="noopener noreferrer"
                              className="font-mono hover:underline" style={{ color: 'var(--bc-gold-ink)' }}>
                              {shortHash(draw.nft_token_id)} ↗
                            </a>
                          </div>
                        )}
                        {draw.lien_waiver_nft_id && (
                          <div className="flex items-center justify-between text-xs">
                            <span style={{ color: 'var(--bc-muted)' }}>Lien waiver record</span>
                            <a href={`${XRPL_EXPLORER}/nft/${draw.lien_waiver_nft_id}`}
                              target="_blank" rel="noopener noreferrer"
                              className="font-mono hover:underline" style={{ color: '#15803d' }}>
                              {shortHash(draw.lien_waiver_nft_id)} ↗
                            </a>
                          </div>
                        )}
                        {draw.escrow_finish_hash && (
                          <div className="flex items-center justify-between text-xs">
                            <span style={{ color: 'var(--bc-muted)' }}>Release transaction</span>
                            <a href={`${XRPL_EXPLORER}/transactions/${draw.escrow_finish_hash}`}
                              target="_blank" rel="noopener noreferrer"
                              className="font-mono hover:underline" style={{ color: '#15803d' }}>
                              {shortHash(draw.escrow_finish_hash)} ↗
                            </a>
                          </div>
                        )}
                      </div>
                      {!tokenSettled && (
                        <p className="text-xs mt-2" style={{ color: 'var(--bc-muted)' }}>
                          Pilot on the XRP Ledger test network: the escrow holds 1 test XRP from BuildChain&apos;s test wallet. No dollars move.
                        </p>
                      )}
                    </div>
                  )}

                  {/* Description */}
                  {draw.description && (
                    <div className="text-sm p-3 rounded-lg mb-4" style={{ background: 'rgba(13,27,42,0.03)', color: 'var(--bc-muted)' }}>
                      &ldquo;{draw.description}&rdquo;
                    </div>
                  )}

                  {/* G703 / Lien Waiver detail toggle */}
                  <div className="mb-4">
                    <button onClick={() => toggleDrawDetail(draw.id)}
                      className="text-xs font-semibold flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all"
                      style={{ background: 'rgba(13,27,42,0.04)', color: 'var(--bc-muted)', border: '1px solid var(--bc-border)' }}>
                      {expandedDrawId === draw.id ? '▲' : '▼'} G703 Line Items &amp; Lien Waivers
                    </button>

                    {expandedDrawId === draw.id && (
                      <div className="mt-3 rounded-xl border overflow-hidden" style={{ borderColor: 'var(--bc-border)' }}>
                        {detailLoading === draw.id ? (
                          <div className="p-4 text-xs text-center" style={{ color: 'var(--bc-muted)' }}>Loading…</div>
                        ) : detailError[draw.id] ? (
                          <div className="p-4 text-xs" style={{ color: '#c0392b' }}>{detailError[draw.id]}</div>
                        ) : (
                          <>
                            {/* G703 Line Items */}
                            {drawLines[draw.id]?.length > 0 ? (
                              <div className="overflow-x-auto">
                                <table className="w-full text-xs">
                                  <thead style={{ background: 'rgba(13,27,42,0.03)' }}>
                                    <tr style={{ borderBottom: '1px solid var(--bc-border)', color: 'var(--bc-muted)' }}>
                                      <th className="text-left px-4 py-2 font-semibold">#</th>
                                      <th className="text-left px-2 py-2 font-semibold">Description</th>
                                      <th className="text-right px-2 py-2 font-semibold">Scheduled</th>
                                      <th className="text-right px-2 py-2 font-semibold">This Period</th>
                                      <th className="text-right px-2 py-2 font-semibold">% Done</th>
                                      <th className="text-right px-4 py-2 font-semibold">Net Due</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {drawLines[draw.id].map(dl => (
                                      <tr key={dl.id} style={{ borderBottom: '1px solid rgba(13,27,42,0.04)' }}>
                                        <td className="px-4 py-2 font-mono" style={{ color: 'var(--bc-muted)' }}>{dl.budget_line_items.line_no}</td>
                                        <td className="px-2 py-2">{dl.budget_line_items.description}</td>
                                        <td className="px-2 py-2 text-right" style={{ color: 'var(--bc-muted)' }}>{formatCurrency(dl.budget_line_items.scheduled_value)}</td>
                                        <td className="px-2 py-2 text-right font-semibold" style={{ color: 'var(--bc-gold-ink)' }}>{formatCurrency(dl.work_completed_period)}</td>
                                        <td className="px-2 py-2 text-right" style={{ color: dl.percent_complete >= 100 ? '#15803d' : 'var(--bc-muted)' }}>{dl.percent_complete.toFixed(1)}%</td>
                                        <td className="px-4 py-2 text-right font-bold">{formatCurrency(dl.current_payment_due)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                  <tfoot style={{ background: 'rgba(13,27,42,0.03)', borderTop: '1px solid var(--bc-border)' }}>
                                    <tr>
                                      <td colSpan={3} className="px-4 py-2 font-bold" style={{ color: 'var(--bc-muted)' }}>TOTALS</td>
                                      <td className="px-2 py-2 text-right font-bold" style={{ color: 'var(--bc-gold-ink)' }}>
                                        {formatCurrency(drawLines[draw.id].reduce((s, l) => s + l.work_completed_period, 0))}
                                      </td>
                                      <td />
                                      <td className="px-4 py-2 text-right font-bold" style={{ color: 'var(--bc-text)' }}>
                                        {formatCurrency(drawLines[draw.id].reduce((s, l) => s + l.current_payment_due, 0))}
                                      </td>
                                    </tr>
                                  </tfoot>
                                </table>
                              </div>
                            ) : (
                              <div className="px-4 py-3 text-xs" style={{ color: 'var(--bc-muted)' }}>No G703 line items — single-amount draw.</div>
                            )}

                            {/* Lien Waivers */}
                            <div className="border-t px-4 py-3" style={{ borderColor: 'var(--bc-border)' }}>
                              <p className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--bc-muted)' }}>Lien Waivers</p>
                              {drawWaivers[draw.id]?.length > 0 ? (
                                <div className="space-y-1.5">
                                  {drawWaivers[draw.id].map(wv => {
                                    const signed = wv.status === 'signed' || wv.status === 'issued'
                                    return (
                                      <div key={wv.id} className="flex items-center justify-between text-xs py-1">
                                        <div>
                                          <span className="font-semibold">{wv.sub_name}</span>
                                          {wv.sub_code && <span className="ml-1.5" style={{ color: 'var(--bc-muted)' }}>{wv.sub_code}</span>}
                                          <span className="ml-2 px-1.5 py-0.5 rounded text-xs" style={{ background: 'rgba(13,27,42,0.06)', color: 'var(--bc-muted)' }}>
                                            {wv.waiver_type.replace(/_/g, ' ')}
                                          </span>
                                        </div>
                                        <div className="flex items-center gap-3">
                                          <span style={{ color: 'var(--bc-muted)' }}>{formatCurrency(wv.through_amount)}</span>
                                          <span style={{ color: signed ? '#15803d' : '#c0392b' }}>
                                            {signed ? 'Signed' : 'Not signed yet'}
                                          </span>
                                        </div>
                                      </div>
                                    )
                                  })}
                                </div>
                              ) : (
                                <p className="text-xs" style={{ color: 'var(--bc-muted)' }}>No lien waivers are on file for this draw yet.</p>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Pending action buttons */}
                  {tab === 'submitted' && (() => {
                    const openItems = !draw.inspection_done || !draw.lien_waiver
                    return (
                    <div className="space-y-3">
                      {openItems && (
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs px-3 py-2 rounded-lg" style={{ background: 'rgba(13,27,42,0.03)', border: '1px solid var(--bc-border)', color: 'var(--bc-muted)' }}>
                          {!draw.inspection_done && <span>The inspection has not passed yet.</span>}
                          {!draw.lien_waiver && <span>The contractor has not reported its lien waivers signed.</span>}
                          <span>You can approve now; the draw is released only after both are recorded.</span>
                        </div>
                      )}
                      <div className="flex flex-wrap gap-3 items-center">
                        <button onClick={() => setSignDrawId(draw.id)}
                          disabled={!!actionLoading}
                          className="px-5 py-2 rounded-lg text-sm font-bold transition-all"
                          style={{ background: 'var(--bc-gold)', color: 'var(--bc-dark)', opacity: actionLoading ? 0.7 : 1 }}>
                          {actionLoading === draw.id + 'approved' ? 'Recording approval…' : 'Approve Draw'}
                        </button>
                        <button onClick={() => { setReasonModal({ draw, mode: 'hold' }); setReasonText('') }}
                          disabled={!!actionLoading}
                          className="px-4 py-2 rounded-lg text-sm font-bold border transition-all"
                          style={{ borderColor: 'var(--bc-border)', color: 'var(--bc-text)' }}>
                          {actionLoading === draw.id + 'held' ? 'Putting on hold…' : 'Hold'}
                        </button>
                        <button onClick={() => { setReasonModal({ draw, mode: 'decline' }); setReasonText('') }}
                          disabled={!!actionLoading}
                          className="px-4 py-2 rounded-lg text-sm font-bold border transition-all"
                          style={{ background: 'rgba(231,76,60,0.1)', color: '#c0392b', borderColor: 'rgba(231,76,60,0.3)' }}>
                          {actionLoading === draw.id + 'declined' ? 'Declining…' : 'Decline'}
                        </button>
                      </div>
                      <p className="text-xs" style={{ color: 'var(--bc-muted)' }}>
                        {tokenSettled
                          ? 'You approve by signing in your wallet. The draw is released once the inspection and the lien waivers are both recorded.'
                          : 'Approving records the draw on the XRP Ledger test network: 1 test XRP is locked from BuildChain’s test wallet and no dollars move. It is released once the inspection and the lien waivers are both recorded.'}
                      </p>
                    </div>
                    )
                  })()}

                  {/* On hold: take it off hold */}
                  {tab === 'held' && (
                    <div className="flex flex-wrap gap-3 items-center">
                      <button onClick={() => act(draw.id, 'submitted')}
                        disabled={!!actionLoading}
                        className="px-5 py-2 rounded-lg text-sm font-bold transition-all"
                        style={{ background: 'var(--bc-gold)', color: 'var(--bc-dark)', opacity: actionLoading ? 0.7 : 1 }}>
                        {actionLoading === draw.id + 'submitted' ? 'Taking off hold…' : 'Take off hold'}
                      </button>
                      <span className="text-xs" style={{ color: 'var(--bc-muted)' }}>
                        The draw goes back to Pending Review, where you can approve or decline it.
                      </span>
                    </div>
                  )}

                  {/* Release conditions: approved, not yet released */}
                  {tab === 'approved' && !draw.funded_at && (
                    <div className="rounded-lg p-3 mt-1" style={{ background: 'rgba(13,27,42,0.02)', border: '1px solid var(--bc-border)' }}>
                      <p className="text-xs font-bold uppercase tracking-wider mb-2.5" style={{ color: 'var(--bc-muted)' }}>
                        Release conditions
                      </p>
                      <div className="space-y-2.5">
                        {/* Condition 1: inspection */}
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs" style={{ color: 'var(--bc-muted)' }}>1. Inspection</span>
                          {draw.inspection_done ? (
                            <span className="text-xs font-semibold" style={{ color: '#15803d' }}>Passed</span>
                          ) : (
                            <span className="text-xs font-semibold" style={{ color: '#b45309' }}>Not yet passed</span>
                          )}
                        </div>
                        {/* Condition 2: the lender's confirmation of the lien waivers */}
                        <div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs" style={{ color: 'var(--bc-muted)' }}>2. Lien waivers</span>
                            {waiverRecorded ? (
                              <span className="text-xs font-semibold" style={{ color: '#15803d' }}>Confirmed and recorded</span>
                            ) : (
                              <span className="flex flex-wrap items-center justify-end gap-2">
                                <span className="text-xs font-semibold" style={{ color: '#b45309' }}>
                                  {waiverSent[draw.id] ? 'Confirmed by you; not recorded on the ledger yet' : 'Not confirmed'}
                                </span>
                                <button
                                  onClick={() => confirmLienWaiver(draw.id)}
                                  disabled={lienWaiverLoading === draw.id}
                                  className="px-3 py-1 rounded-lg text-xs font-bold transition-all"
                                  style={{
                                    background: waiverSent[draw.id] ? 'transparent' : 'var(--bc-gold)',
                                    border: waiverSent[draw.id] ? '1px solid var(--bc-border)' : '1px solid transparent',
                                    color: waiverSent[draw.id] ? 'var(--bc-text)' : 'var(--bc-dark)',
                                    opacity: lienWaiverLoading === draw.id ? 0.7 : 1,
                                  }}>
                                  {lienWaiverLoading === draw.id
                                    ? 'Saving…'
                                    : waiverSent[draw.id] ? 'Confirm again' : 'Confirm lien waivers received'}
                                </button>
                              </span>
                            )}
                          </div>
                          {!waiverRecorded && (
                            <p className="text-xs mt-1" style={{ color: 'var(--bc-muted)' }}>
                              {waiverSent[draw.id]
                                ? 'Your confirmation is saved. The ledger record usually follows within a minute: use Check again below.'
                                : draw.lien_waiver
                                  ? 'The contractor reports its lien waivers are signed. Confirm you have them to record this on the ledger.'
                                  : 'The contractor has not reported its lien waivers signed. Confirm once you have them: this is your own confirmation and it is recorded on the ledger.'}
                            </p>
                          )}
                        </div>
                      </div>
                      {/* Status line */}
                      <div className="mt-2.5 pt-2 border-t flex flex-wrap items-center justify-between gap-2 text-xs" style={{ borderColor: 'var(--bc-border)' }}>
                        {bothRecorded ? (
                          <span className="font-semibold" style={{ color: '#15803d' }}>
                            Both conditions are recorded. Processing release.
                          </span>
                        ) : (
                          <span style={{ color: 'var(--bc-muted)' }}>
                            The draw is released once the inspection has passed and your lien waiver confirmation is recorded.
                          </span>
                        )}
                        {(bothRecorded || waiverSent[draw.id]) && (
                          <button
                            onClick={() => checkAgain(draw.id)}
                            disabled={checkLoading === draw.id}
                            className="px-3 py-1 rounded-lg text-xs font-bold border"
                            style={{ borderColor: 'var(--bc-border)', color: 'var(--bc-text)', opacity: checkLoading === draw.id ? 0.7 : 1 }}>
                            {checkLoading === draw.id ? 'Checking…' : 'Check again'}
                          </button>
                        )}
                      </div>
                      {checkNote[draw.id] && (
                        <p className="text-xs mt-2" style={{ color: '#b45309' }}>
                          Not released: {checkNote[draw.id]}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Released */}
                  {tab === 'funded' && (
                    <div className="rounded-lg px-3 py-2 mt-1" style={{ background: 'rgba(74,222,128,0.06)', border: '1px solid rgba(74,222,128,0.2)' }}>
                      {draw.verification_receipt ? (
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <span className="font-bold" style={{ color: '#15803d' }}>
                            Released automatically: inspection and lien waivers both recorded
                          </span>
                          <span style={{ color: 'var(--bc-muted)' }}>
                            Verified {timeAgo(draw.verification_receipt.verified_at)} · {draw.verification_receipt.patent_ref}
                          </span>
                        </div>
                      ) : (
                        <div className="text-xs font-bold" style={{ color: '#15803d' }}>
                          Released{draw.funded_at ? ` ${timeAgo(draw.funded_at)}` : ''}
                        </div>
                      )}
                      <p className="text-xs mt-1" style={{ color: 'var(--bc-muted)' }}>
                        {draw.escrow_finish_hash ? (
                          <>
                            Ledger transaction:{' '}
                            <a href={`${XRPL_EXPLORER}/transactions/${draw.escrow_finish_hash}`}
                              target="_blank" rel="noopener noreferrer"
                              className="font-mono hover:underline" style={{ color: 'var(--bc-blue)' }}>
                              {shortHash(draw.escrow_finish_hash)} ↗
                            </a>
                          </>
                        ) : 'No ledger release transaction is recorded for this draw.'}
                        {!tokenSettled && ' Pilot on the XRP Ledger test network: no dollars moved.'}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
