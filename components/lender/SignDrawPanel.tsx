'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Loader2, ShieldCheck, Smartphone, X } from 'lucide-react'

interface Summary {
  method: 'token_escrow' | 'two_signature'
  amountUsd: number
  payee: string
  payeeName: string | null
  projectName: string | null
  requestNumber: string
  escrowTxnHash: string | null
}

type Phase = 'preparing' | 'waiting' | 'checking' | 'locked' | 'rejected' | 'expired' | 'error'

const usd = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-6)}`

/**
 * The lender approves a dollar-token draw by signing it in their own wallet.
 * Opens when the lender clicks Approve. A project on the pilot method needs no
 * signature: the panel hands straight back to the ordinary approval.
 */
export default function SignDrawPanel({ drawId, onApprove, onClose }: {
  drawId: string
  /** record the approval (the draw is locked, or needs no signature) */
  onApprove: () => void
  onClose: () => void
}) {
  const [phase, setPhase] = useState<Phase>('preparing')
  const [summary, setSummary] = useState<Summary | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [link, setLink] = useState<string | null>(null)
  const [cancelAfter, setCancelAfter] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [needsWallet, setNeedsWallet] = useState(false)
  const started = useRef(false)
  const done = useRef(false)

  const start = useCallback(async () => {
    setPhase('preparing'); setError(''); setNeedsWallet(false)
    const res = await fetch(`/api/draws/${drawId}/sign`, { method: 'POST' })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      setNeedsWallet(json.code === 'no_lender_wallet')
      setError(json.error || `Could not prepare the signature (${res.status})`)
      setPhase('error')
      return
    }
    if (!json.signatureNeeded) {           // pilot method, or already locked
      if (!done.current) { done.current = true; onApprove() }
      return
    }
    setSummary(json.summary); setQr(json.qrPng); setLink(json.url); setCancelAfter(json.cancelAfter ?? null)
    setPhase('waiting')
  }, [drawId, onApprove])

  useEffect(() => {
    if (started.current) return
    started.current = true
    start()
  }, [start])

  // While the request is open on the lender's phone, ask every 3 seconds.
  useEffect(() => {
    if (phase !== 'waiting' && phase !== 'checking') return
    let stop = false
    const tick = async () => {
      const res = await fetch(`/api/draws/${drawId}/sign`)
      const json = await res.json().catch(() => ({}))
      if (stop) return
      if (json.state === 'locked') {
        setSummary(json.summary ?? null); setPhase('locked')
        if (!done.current) { done.current = true; setTimeout(onApprove, 1800) }
      } else if (json.state === 'rejected') setPhase('rejected')
      else if (json.state === 'expired') setPhase('expired')
      else if (json.state === 'problem') { setError(json.error || 'The signature could not be confirmed'); setPhase('error') }
    }
    const id = setInterval(tick, 3000)
    return () => { stop = true; clearInterval(id) }
  }, [phase, drawId, onApprove])

  const escrow = summary?.method === 'token_escrow'
  const steps = [
    { label: escrow ? 'Review what you are locking' : 'Review what you are authorizing', done: phase !== 'preparing' },
    { label: 'Sign in Xaman on your phone', done: phase === 'locked' },
    { label: escrow ? 'Locked on the XRP Ledger' : 'Authorization held by BuildChain', done: phase === 'locked' },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40" role="dialog" aria-modal="true" aria-label="Sign draw approval">
      <div className="w-full max-w-[720px] rounded-lg border overflow-hidden" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
        <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: 'var(--bc-border)' }}>
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--bc-muted)' }}>
              Approve by signature
            </div>
            <h2 className="mt-0.5" style={{ fontSize: '1.15rem' }}>
              {summary ? `Draw ${summary.requestNumber} · ${summary.projectName ?? ''}` : 'Preparing your approval'}
            </h2>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded hover:bg-slate-900/5">
            <X size={18} style={{ color: 'var(--bc-muted)' }} />
          </button>
        </div>

        {phase === 'preparing' && (
          <div className="px-6 py-14 flex flex-col items-center gap-3 text-sm" style={{ color: 'var(--bc-muted)' }}>
            <Loader2 size={22} className="animate-spin" />
            Checking the ledger: wallet balance, the contractor&apos;s wallet, and the release terms.
          </div>
        )}

        {phase === 'error' && (
          <div className="px-6 py-10">
            <div className="rounded-lg border px-4 py-3 text-sm" style={{ borderColor: 'rgba(192,57,43,0.3)', background: 'rgba(192,57,43,0.06)', color: '#c0392b' }}>
              {error}
            </div>
            <p className="text-sm mt-4" style={{ color: 'var(--bc-muted)' }}>
              {needsWallet
                ? 'Connect your wallet at the top of this page, then approve again.'
                : 'Nothing was signed and nothing moved. You can close this and try again.'}
            </p>
            <div className="mt-6 flex gap-3">
              {!needsWallet && (
                <button onClick={start} className="px-4 py-2 rounded-lg text-sm font-bold" style={{ background: 'var(--bc-gold)', color: 'var(--bc-dark)' }}>Try again</button>
              )}
              <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-bold border" style={{ borderColor: 'var(--bc-border)' }}>Close</button>
            </div>
          </div>
        )}

        {(phase === 'rejected' || phase === 'expired') && (
          <div className="px-6 py-10">
            <p className="text-sm" style={{ color: 'var(--bc-text)' }}>
              {phase === 'rejected' ? 'You declined the request in Xaman.' : 'The request expired before it was signed.'}{' '}
              Nothing was signed and nothing moved. The draw is still awaiting your review.
            </p>
            <div className="mt-6 flex gap-3">
              <button onClick={start} className="px-4 py-2 rounded-lg text-sm font-bold" style={{ background: 'var(--bc-gold)', color: 'var(--bc-dark)' }}>Start again</button>
              <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-bold border" style={{ borderColor: 'var(--bc-border)' }}>Close</button>
            </div>
          </div>
        )}

        {summary && (phase === 'waiting' || phase === 'checking' || phase === 'locked') && (
          <div className="grid md:grid-cols-[1fr_260px]">
            <div className="px-6 py-6">
              <div className="bc-figure text-[40px] leading-none tabular-nums">{usd(summary.amountUsd)}</div>
              <div className="mt-2 text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--bc-muted)' }}>
                {escrow ? 'Locked in escrow from your wallet' : 'Authorized from the loan account'}
              </div>

              <dl className="mt-6 text-sm divide-y" style={{ borderColor: 'var(--bc-border)' }}>
                {[
                  ['Pays', `${summary.payeeName ?? 'Contractor'} · ${short(summary.payee)}`],
                  ['Released when', 'The inspection and the lien waiver are both recorded on the ledger'],
                  [escrow ? 'If never released' : 'Until then',
                    escrow
                      ? `You can take it back after ${cancelAfter ? new Date(cancelAfter).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'the deadline'}`
                      : 'It stays in the loan account; your signature alone moves nothing'],
                  ['BuildChain', 'Never holds these funds or your keys'],
                ].map(([k, v]) => (
                  <div key={k} className="flex gap-4 py-2.5" style={{ borderColor: 'var(--bc-border)' }}>
                    <dt className="w-32 shrink-0" style={{ color: 'var(--bc-muted)' }}>{k}</dt>
                    <dd style={{ color: 'var(--bc-text)' }}>{v}</dd>
                  </div>
                ))}
              </dl>

              <ol className="mt-6 space-y-2.5">
                {steps.map((s, i) => (
                  <li key={s.label} className="flex items-center gap-3 text-sm">
                    <span className="flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-bold shrink-0"
                      style={s.done
                        ? { background: '#15803d', color: '#fff' }
                        : { background: 'transparent', color: 'var(--bc-muted)', border: '1px solid var(--bc-border)' }}>
                      {s.done ? <Check size={13} /> : i + 1}
                    </span>
                    <span style={{ color: s.done ? 'var(--bc-text)' : 'var(--bc-muted)' }}>{s.label}</span>
                  </li>
                ))}
              </ol>
            </div>

            <div className="px-6 py-6 border-t md:border-t-0 md:border-l flex flex-col items-center justify-center text-center"
              style={{ borderColor: 'var(--bc-border)', background: 'var(--bc-page)' }}>
              {phase === 'locked' ? (
                <>
                  <ShieldCheck size={44} style={{ color: '#15803d' }} />
                  <div className="mt-3 text-sm font-bold" style={{ color: 'var(--bc-text)' }}>
                    {escrow ? 'Locked on the ledger' : 'Signature confirmed'}
                  </div>
                  <div className="mt-1 text-xs" style={{ color: 'var(--bc-muted)' }}>Recording your approval…</div>
                </>
              ) : (
                <>
                  {qr && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={qr} alt="QR code to open this request in Xaman" width={188} height={188} className="rounded-md border bg-white p-2" style={{ borderColor: 'var(--bc-border)' }} />
                  )}
                  <div className="mt-3 flex items-center gap-1.5 text-xs font-semibold" style={{ color: 'var(--bc-text)' }}>
                    <Smartphone size={14} /> Scan with Xaman
                  </div>
                  {link && (
                    <a href={link} target="_blank" rel="noopener noreferrer" className="mt-1 text-xs underline" style={{ color: 'var(--bc-blue)' }}>
                      On your phone? Open in Xaman
                    </a>
                  )}
                  <div className="mt-4 flex items-center gap-1.5 text-xs" style={{ color: 'var(--bc-muted)' }}>
                    <Loader2 size={12} className="animate-spin" /> Waiting for your signature
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
