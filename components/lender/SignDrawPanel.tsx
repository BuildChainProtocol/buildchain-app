'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, Clock, Loader2, Pause, QrCode, ShieldCheck, Smartphone, X } from 'lucide-react'

type PaymentStatus = 'pending' | 'awaiting_signature' | 'locked' | 'released' | 'held' | 'failed'

interface Payment {
  id: string
  name: string
  amount: number
  wallet: string | null
  status: PaymentStatus
  heldReason: string | null
}

interface Summary {
  method: 'token_escrow' | 'two_signature'
  projectName: string | null
  requestNumber: string
  totalUsd: number
  payableUsd: number
  heldUsd: number
  signed: number
  toSign: number
}

/** The sign request that is open right now: one payee's payment. */
interface Current {
  paymentId: string
  qrPng: string | null
  url: string | null
  pushed: boolean
  cancelAfter: string | null
}

type Phase =
  | 'preparing' | 'waiting' | 'checking' | 'locked'
  | 'rejected' | 'expired' | 'problem' | 'none' | 'error'

const GREEN = '#15803d'
const RED = '#c0392b'
const LABEL = 'text-[10px] font-semibold uppercase tracking-[0.12em]'

const usd = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n) || 0)
const short = (a: string) => (a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-6)}` : a)
const longDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
const isSigned = (p: Payment) => p.status === 'locked' || p.status === 'released'
const nameOf = (id: string | null | undefined, rows: Payment[]) => rows.find(p => p.id === id)?.name ?? ''

function PayeeRow({ p, signingNow, confirming }: { p: Payment; signingNow: boolean; confirming: boolean }) {
  const signed = isSigned(p)
  const held = p.status === 'held'
  const failed = p.status === 'failed'
  const active = signingNow || confirming

  let label = 'Waiting'
  let color = 'var(--bc-muted)'
  if (signed) { label = 'Signed'; color = GREEN }
  else if (held) label = `On hold: ${p.heldReason || 'this payee cannot be paid yet'}`
  else if (failed) { label = 'Failed'; color = RED }
  else if (signingNow) { label = 'Signing now'; color = 'var(--bc-text)' }
  else if (confirming) { label = 'Confirming signature'; color = 'var(--bc-text)' }
  else if (p.status === 'awaiting_signature') label = 'Signature requested'

  return (
    <li
      className="flex items-start gap-3 px-3 py-2.5 border-t first:border-t-0"
      aria-current={active ? 'step' : undefined}
      style={{
        borderColor: 'var(--bc-border)',
        ...(active ? { background: 'var(--bc-page)', boxShadow: 'inset 3px 0 0 var(--bc-gold)' } : {}),
        ...(held ? { opacity: 0.75 } : {}),
      }}
    >
      <span
        className="mt-0.5 flex items-center justify-center w-5 h-5 rounded-full shrink-0"
        style={signed
          ? { background: GREEN, color: '#fff' }
          : { color: failed ? RED : active ? 'var(--bc-text)' : 'var(--bc-muted)', border: '1px solid var(--bc-border)' }}
      >
        {signed ? <Check size={12} />
          : held ? <Pause size={10} />
          : failed ? <AlertTriangle size={10} />
          : active ? <Loader2 size={11} className="animate-spin" />
          : <Clock size={10} />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm font-semibold truncate" style={{ color: held ? 'var(--bc-muted)' : 'var(--bc-text)' }}>{p.name}</span>
          <span className="text-sm tabular-nums shrink-0" style={{ color: held ? 'var(--bc-muted)' : 'var(--bc-text)' }}>{usd(p.amount)}</span>
        </div>
        <div className="mt-0.5 text-xs break-words" style={{ color: 'var(--bc-muted)' }}>
          <span className="font-mono">{p.wallet ? short(p.wallet) : 'No wallet on file'}</span>
          <span aria-hidden="true"> · </span>
          <span className={active || signed || failed ? 'font-semibold' : ''} style={{ color }}>{label}</span>
        </div>
      </div>
    </li>
  )
}

function PayeeList({ payments, signingId, checking }: { payments: Payment[]; signingId: string | null; checking: boolean }) {
  const inApproval = payments.filter(p => p.status !== 'held')
  const onHold = payments.filter(p => p.status === 'held')
  const row = (p: Payment) => (
    <PayeeRow
      key={p.id}
      p={p}
      signingNow={!!signingId && p.id === signingId}
      confirming={checking && p.status === 'awaiting_signature'}
    />
  )
  return (
    <>
      {inApproval.length > 0 && (
        <ul className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--bc-border)' }}>
          {inApproval.map(row)}
        </ul>
      )}
      {onHold.length > 0 && (
        <>
          <div className={`${LABEL} mt-4 mb-2`} style={{ color: 'var(--bc-muted)' }}>
            On hold · not part of this approval
          </div>
          <ul className="rounded-lg border border-dashed overflow-hidden" style={{ borderColor: 'var(--bc-border)' }}>
            {onHold.map(row)}
          </ul>
        </>
      )}
    </>
  )
}

/**
 * The lender approves a dollar-token draw by signing it in their own wallet,
 * once per payee: each payee is paid by its own ledger transaction. Opens when
 * the lender clicks Approve. A project on the pilot method needs no signature:
 * the panel hands straight back to the ordinary approval.
 */
export default function SignDrawPanel({ drawId, onApprove, onClose }: {
  drawId: string
  /** record the approval (every payable payee is signed for, or no signature is needed) */
  onApprove: () => void
  onClose: () => void
}) {
  const [phase, setPhase] = useState<Phase>('preparing')
  const [summary, setSummary] = useState<Summary | null>(null)
  const [payments, setPayments] = useState<Payment[]>([])
  const [current, setCurrent] = useState<Current | null>(null)
  const [cancelAfter, setCancelAfter] = useState<string | null>(null)
  const [showQr, setShowQr] = useState(false)
  const [confirming, setConfirming] = useState(false)   // signed; the ledger has not confirmed it yet
  const [moved, setMoved] = useState('')                // "Signed for A. Next: B."
  const [pausedFor, setPausedFor] = useState('')        // the payee whose request was declined / expired
  const [error, setError] = useState('')
  const [errorCode, setErrorCode] = useState('')

  const started = useRef(false)
  const done = useRef(false)
  const busy = useRef(false)      // one request to the sign route at a time
  const alive = useRef(true)
  const phaseRef = useRef<Phase>('preparing')
  const currentRef = useRef<Current | null>(null)
  const paymentsRef = useRef<Payment[]>([])
  const onApproveRef = useRef(onApprove)
  useEffect(() => { onApproveRef.current = onApprove }, [onApprove])
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  const go = useCallback((p: Phase) => { phaseRef.current = p; setPhase(p) }, [])

  /** Take the payee list and totals from any response that carries them. */
  const absorb = useCallback((json: { payments?: unknown; summary?: unknown }) => {
    if (Array.isArray(json.payments)) { paymentsRef.current = json.payments as Payment[]; setPayments(json.payments as Payment[]) }
    if (json.summary) setSummary(json.summary as Summary)
  }, [])

  const show = useCallback((next: Current | null) => {
    if (next?.paymentId !== currentRef.current?.paymentId) setShowQr(false)
    currentRef.current = next
    setCurrent(next)
    if (next?.cancelAfter) setCancelAfter(next.cancelAfter)
  }, [])

  const approveOnce = useCallback((delay: number) => {
    if (done.current) return
    done.current = true
    if (delay) setTimeout(() => onApproveRef.current(), delay)
    else onApproveRef.current()
  }, [])

  /**
   * POST: set the draw's payments up if needed and open (or show again) the
   * sign request for the next payee. `quiet` keeps the panel on screen.
   */
  const open = useCallback(async (quiet = false) => {
    if (!quiet) { go('preparing'); setMoved(''); setConfirming(false) }
    setError(''); setErrorCode(''); setPausedFor('')
    let res: Response
    try { res = await fetch(`/api/draws/${drawId}/sign`, { method: 'POST' }) } catch {
      if (!alive.current) return
      setError('Could not reach BuildChain. Check your connection and try again.')
      go('error')
      return
    }
    const json = await res.json().catch(() => ({}))
    if (!alive.current) return
    absorb(json)
    if (!res.ok) {
      show(null)
      setErrorCode(typeof json.code === 'string' ? json.code : '')
      setError(json.error || `Could not prepare the signature (${res.status})`)
      go('error')
      return
    }
    if (!json.signatureNeeded) {           // pilot method, or everything payable is already signed
      approveOnce(0)
      return
    }
    // Already signed earlier: go straight to confirming it, never to a second signature.
    if (json.state === 'checking' || !json.current) { show(null); go('checking'); return }
    show(json.current as Current)
    go('waiting')
  }, [drawId, go, absorb, show, approveOnce])

  const start = useCallback(async () => {
    if (busy.current) return
    busy.current = true
    try { await open(false) } finally { busy.current = false }
  }, [open])

  useEffect(() => {
    if (started.current) return
    started.current = true
    start()
  }, [start])

  // While a request is open on the lender's phone, ask every 3 seconds.
  const polling = phase === 'waiting' || phase === 'checking'
  useEffect(() => {
    if (!polling) return
    const tick = async () => {
      if (busy.current) return
      busy.current = true
      try {
        let res: Response
        try { res = await fetch(`/api/draws/${drawId}/sign`) } catch { return }   // offline for a moment: ask again
        const json = await res.json().catch(() => ({}))
        if (!alive.current) return
        if (phaseRef.current !== 'waiting' && phaseRef.current !== 'checking') return

        const before = paymentsRef.current
        const previousId = currentRef.current?.paymentId ?? before.find(p => p.status === 'awaiting_signature')?.id ?? null
        absorb(json)

        switch (json.state) {
          case 'locked':
            show(null); setConfirming(false); go('locked')
            approveOnce(1800)
            break
          case 'rejected':
          case 'expired':
          case 'none':
            setPausedFor(nameOf(previousId, before))
            show(null); setConfirming(false); go(json.state)
            break
          case 'problem':
            setPausedFor(nameOf(previousId, before))
            setError(json.error || 'The signature could not be confirmed')
            show(null); setConfirming(false); go('problem')
            break
          case 'waiting': {
            setConfirming(!!json.note)
            if (json.current) {
              // The previous payee was just confirmed: this is the next payee's request.
              const next = json.current as Current
              if (next.paymentId !== previousId) {
                const was = nameOf(previousId, before)
                const now = nameOf(next.paymentId, paymentsRef.current)
                setMoved(was && now ? `Signed for ${was}. Next: ${now}.` : now ? `Next: ${now}.` : '')
              }
              show(next); setConfirming(false); go('waiting')
            } else if (phaseRef.current === 'waiting') {
              // The open request is not the one on screen (it moved on in
              // another tab, or an answer was lost): fetch the one that is open.
              const openRow = paymentsRef.current.find(p => p.status === 'awaiting_signature')
              if (openRow && openRow.id !== currentRef.current?.paymentId) await open(true)
            }
            break
          }
          default:
            // No state: signed out, or the draw can no longer be read. Anything
            // else (a server hiccup) is asked again on the next tick.
            if ([401, 403, 404].includes(res.status)) {
              setError(json.error || `Could not check the signature (${res.status})`)
              show(null); go('error')
            }
        }
      } finally { busy.current = false }
    }
    const id = setInterval(tick, 3000)
    return () => clearInterval(id)
  }, [polling, drawId, absorb, show, go, open, approveOnce])

  const escrow = summary?.method === 'token_escrow'
  const paused = phase === 'rejected' || phase === 'expired' || phase === 'problem' || phase === 'none'
  const signingId = phase === 'waiting' ? current?.paymentId ?? null : null
  const signing = payments.find(p => p.id === signingId) ?? null
  const held = payments.filter(p => p.status === 'held')
  const toSign = summary?.toSign ?? 0
  const signed = summary?.signed ?? 0
  const position = signing ? payments.filter(p => p.status !== 'held').findIndex(p => p.id === signing.id) + 1 : 0
  const waitingOnLedger = phase === 'checking' || confirming
  const needsWallet = errorCode === 'no_lender_wallet'

  const primaryBtn = 'px-4 py-2 rounded-lg text-sm font-bold'
  const plainBtn = 'px-4 py-2 rounded-lg text-sm font-bold border'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-900/40" role="dialog" aria-modal="true" aria-label="Sign draw approval">
      <div className="w-full max-w-[760px] max-h-full flex flex-col rounded-lg border overflow-hidden" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
        <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-4 border-b shrink-0" style={{ borderColor: 'var(--bc-border)' }}>
          <div className="min-w-0">
            <div className={LABEL} style={{ color: 'var(--bc-muted)' }}>
              Approve by signature
            </div>
            <h2 className="mt-0.5 break-words" style={{ fontSize: '1.15rem' }}>
              {summary
                ? `Draw ${summary.requestNumber}${summary.projectName ? ` · ${summary.projectName}` : ''}`
                : phase === 'error' ? 'Draw approval' : 'Preparing your approval'}
            </h2>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded hover:bg-slate-900/5 shrink-0">
            <X size={18} style={{ color: 'var(--bc-muted)' }} />
          </button>
        </div>

        <div className="overflow-y-auto overflow-x-hidden">
          {phase === 'preparing' && (
            <div className="px-4 sm:px-6 py-14 flex flex-col items-center gap-3 text-sm text-center" style={{ color: 'var(--bc-muted)' }}>
              <Loader2 size={22} className="animate-spin" />
              Checking the ledger: your wallet balance, each payee&apos;s wallet, and the release terms.
            </div>
          )}

          {phase === 'error' && (
            <div className="px-4 sm:px-6 py-8">
              <div className="rounded-lg border px-4 py-3 text-sm break-words" role="alert" style={{ borderColor: 'rgba(192,57,43,0.3)', background: 'rgba(192,57,43,0.06)', color: RED }}>
                {error}
              </div>
              <p className="text-sm mt-4" style={{ color: 'var(--bc-muted)' }}>
                {needsWallet
                  ? 'Connect your wallet at the top of this page, then approve again.'
                  : errorCode === 'no_payable_payee'
                    ? 'Nothing was signed. A payee needs a wallet that can receive the settlement token before this draw can be approved.'
                    : signed > 0
                      ? 'Nothing new was recorded. Payees you have already signed for stay signed. You can close this and try again.'
                      : 'Nothing new was recorded. You can close this and try again.'}
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                {!needsWallet && (
                  <button onClick={start} className={primaryBtn} style={{ background: 'var(--bc-gold)', color: 'var(--bc-dark)' }}>Try again</button>
                )}
                <button onClick={onClose} className={plainBtn} style={{ borderColor: 'var(--bc-border)' }}>Close</button>
              </div>
              {payments.length > 0 && (
                <div className="mt-6">
                  <div className={`${LABEL} mb-2`} style={{ color: 'var(--bc-muted)' }}>Payees on this draw</div>
                  <PayeeList payments={payments} signingId={null} checking={false} />
                </div>
              )}
            </div>
          )}

          {paused && !summary && (
            <div className="px-4 sm:px-6 py-8">
              <p className="text-sm" style={{ color: 'var(--bc-text)' }}>
                No signature request is open for this draw right now. Payees you have already signed for stay signed.
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <button onClick={start} className={primaryBtn} style={{ background: 'var(--bc-gold)', color: 'var(--bc-dark)' }}>Continue signing</button>
                <button onClick={onClose} className={plainBtn} style={{ borderColor: 'var(--bc-border)' }}>Close</button>
              </div>
            </div>
          )}

          {summary && (polling || paused || phase === 'locked') && (
            <div className="grid md:grid-cols-[minmax(0,1fr)_260px]">
              {/* What is being approved, and for whom */}
              <div className="px-4 sm:px-6 py-6 min-w-0">
                <div className="bc-figure text-[34px] sm:text-[40px] leading-none tabular-nums break-words">{usd(summary.payableUsd)}</div>
                <div className={`mt-2 ${LABEL}`} style={{ color: 'var(--bc-muted)' }}>
                  {escrow ? 'Locked in escrow from your wallet' : 'Authorized from the loan account'}
                </div>
                {toSign > 1 && (
                  <div className="mt-1 text-xs" style={{ color: 'var(--bc-muted)' }}>{toSign} payees, one signature each</div>
                )}

                <div className="mt-6 flex items-baseline justify-between gap-3">
                  <div className={LABEL} style={{ color: 'var(--bc-muted)' }}>Payees</div>
                  <div className="text-xs font-semibold tabular-nums" style={{ color: 'var(--bc-text)' }}>{signed} of {toSign} signed</div>
                </div>
                <div className="mt-2 mb-3 h-1 rounded-full overflow-hidden" style={{ background: 'var(--bc-border)' }}
                  role="progressbar" aria-label="Payees signed" aria-valuemin={0} aria-valuemax={toSign} aria-valuenow={signed}>
                  <div className="h-full rounded-full" style={{ width: `${toSign ? Math.min(100, (signed / toSign) * 100) : 0}%`, background: GREEN, transition: 'width 300ms' }} />
                </div>
                <PayeeList payments={payments} signingId={signingId} checking={phase === 'checking'} />

                {summary.heldUsd > 0 && (
                  <p className="mt-3 text-xs" style={{ color: 'var(--bc-muted)' }}>
                    {usd(summary.heldUsd)} for {held.length === 1 ? '1 payee' : `${held.length} payees`} is on hold and is not part of this approval.
                    It is not locked and will not be paid by this draw until {held.length === 1 ? 'that payee’s wallet is' : 'those payees’ wallets are'} ready.
                  </p>
                )}

                <dl className="mt-6 text-sm divide-y border-t" style={{ borderColor: 'var(--bc-border)' }}>
                  {[
                    ['Paid when', 'The inspection and the lien waivers are both recorded on the ledger.'],
                    escrow
                      ? ['If never released', `You can take each escrow back after ${cancelAfter ? longDate(cancelAfter) : 'its deadline'}.`]
                      : ['Until then', 'The money stays in the loan account. Your signature alone moves nothing.'],
                    ['Custody', 'BuildChain never holds these funds or your keys.'],
                  ].map(([k, v]) => (
                    <div key={k} className="flex flex-col sm:flex-row gap-0.5 sm:gap-4 py-2.5" style={{ borderColor: 'var(--bc-border)' }}>
                      <dt className="sm:w-32 shrink-0" style={{ color: 'var(--bc-muted)' }}>{k}</dt>
                      <dd style={{ color: 'var(--bc-text)' }}>{v}</dd>
                    </div>
                  ))}
                </dl>
              </div>

              {/* The request that is open now. First on a phone, where the list is long. */}
              <div className="order-first md:order-none px-4 sm:px-6 py-6 border-b md:border-b-0 md:border-l flex flex-col items-center justify-center text-center min-w-0"
                style={{ borderColor: 'var(--bc-border)', background: 'var(--bc-page)' }}>
                {phase === 'locked' && (
                  <>
                    <ShieldCheck size={44} style={{ color: GREEN }} />
                    <div className="mt-3 text-sm font-bold" style={{ color: 'var(--bc-text)' }}>
                      {toSign > 1
                        ? `All ${toSign} payees signed`
                        : escrow ? 'Locked on the ledger' : 'Signature confirmed'}
                    </div>
                    <div className="mt-1 text-xs" style={{ color: 'var(--bc-muted)' }}>Recording your approval…</div>
                  </>
                )}

                {paused && (
                  <div className="w-full text-left">
                    <p className="text-sm font-semibold break-words" style={{ color: phase === 'problem' ? RED : 'var(--bc-text)' }}>
                      {phase === 'rejected' ? `You declined the request${pausedFor ? ` for ${pausedFor}` : ''} in Xaman.`
                        : phase === 'expired' ? `The request${pausedFor ? ` for ${pausedFor}` : ''} expired before it was signed.`
                        : phase === 'problem' ? error
                        : 'No signature request is open right now.'}
                    </p>
                    <p className="mt-2 text-xs" style={{ color: 'var(--bc-muted)' }}>
                      {phase !== 'none' && `${pausedFor || 'That payee'} is back to waiting for your signature. `}
                      {signed > 0
                        ? `The ${signed === 1 ? 'payee' : `${signed} payees`} you have already signed for ${signed === 1 ? 'stays' : 'stay'} signed.`
                        : phase === 'problem' ? 'No payee is signed for yet.' : 'Nothing was signed and nothing moved.'}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-3">
                      <button onClick={start} className={primaryBtn} style={{ background: 'var(--bc-gold)', color: 'var(--bc-dark)' }}>Continue signing</button>
                      <button onClick={onClose} className={plainBtn} style={{ borderColor: 'var(--bc-border)', background: 'var(--bc-card)' }}>Close</button>
                    </div>
                  </div>
                )}

                {polling && (
                  <>
                    {moved && (
                      <div className="mb-4 w-full rounded-lg border px-3 py-2 text-xs font-semibold text-left flex items-start gap-2"
                        style={{ borderColor: 'rgba(21,128,61,0.3)', background: 'rgba(21,128,61,0.06)', color: GREEN }}>
                        <Check size={14} className="shrink-0 mt-px" /> <span className="break-words min-w-0">{moved}</span>
                      </div>
                    )}

                    {signing && (
                      <div className="mb-3 w-full">
                        <div className={LABEL} style={{ color: 'var(--bc-muted)' }}>
                          {toSign > 1 && position > 0 ? `Signature ${position} of ${toSign}` : 'Your signature'}
                        </div>
                        <div className="mt-1 text-sm font-semibold break-words" style={{ color: 'var(--bc-text)' }}>{signing.name}</div>
                        <div className="text-sm tabular-nums" style={{ color: 'var(--bc-text)' }}>{usd(signing.amount)}</div>
                      </div>
                    )}

                    {phase === 'waiting' && current && (
                      <>
                        {current.pushed && (
                          <>
                            <Smartphone size={36} style={{ color: 'var(--bc-text)' }} />
                            <div className="mt-2 text-sm font-bold" style={{ color: 'var(--bc-text)' }}>
                              Sent to your phone. Open Xaman to approve.
                            </div>
                            {current.qrPng && (
                              <button type="button" onClick={() => setShowQr(v => !v)} aria-expanded={showQr}
                                className="mt-2 inline-flex items-center gap-1.5 text-xs underline" style={{ color: 'var(--bc-muted)' }}>
                                <QrCode size={12} /> {showQr ? 'Hide QR code' : 'Show QR code'}
                              </button>
                            )}
                          </>
                        )}
                        {current.qrPng && (!current.pushed || showQr) && (
                          <>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={current.qrPng} alt="QR code to open this request in Xaman" width={188} height={188}
                              className={`rounded-md border bg-white p-2 max-w-full h-auto ${current.pushed ? 'mt-3' : ''}`} style={{ borderColor: 'var(--bc-border)' }} />
                            <div className="mt-3 flex items-center gap-1.5 text-xs font-semibold" style={{ color: 'var(--bc-text)' }}>
                              <Smartphone size={14} /> Scan with Xaman
                            </div>
                          </>
                        )}
                        {current.url && (
                          <a href={current.url} target="_blank" rel="noopener noreferrer" className="mt-1 text-xs underline" style={{ color: 'var(--bc-blue)' }}>
                            On your phone? Open in Xaman
                          </a>
                        )}
                      </>
                    )}

                    <div className="mt-4 flex items-center gap-1.5 text-xs" role="status" aria-live="polite" style={{ color: 'var(--bc-muted)' }}>
                      <Loader2 size={12} className="animate-spin shrink-0" />
                      {waitingOnLedger ? 'Confirming your signature on the ledger' : 'Waiting for your signature'}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {phase !== 'preparing' && phase !== 'locked' && (
          <div className="px-4 sm:px-6 py-2.5 border-t text-[11px] shrink-0" style={{ borderColor: 'var(--bc-border)', color: 'var(--bc-muted)' }}>
            You can close this and continue later. Payees you have signed for stay signed.
          </div>
        )}
      </div>
    </div>
  )
}
