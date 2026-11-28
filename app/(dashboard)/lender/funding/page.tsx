'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, Loader2, QrCode, Smartphone, X } from 'lucide-react'
import LenderWalletCard from '@/components/lender/LenderWalletCard'
import FeeStatement from '@/components/shared/FeeStatement'
import FeeTermsCard from '@/components/lender/FeeTermsCard'
import LenderInvoices from '@/components/lender/LenderInvoices'

/** One payee the lender has signed for, still waiting to be released. */
interface Locked {
  paymentId: string; drawId: string; requestNumber: string; payee: string; wallet: string | null
  amount: number; method: string; cancelAfter: string | null
  /** the ledger refused this release; it is still signed for and will be tried again */
  releaseFailed?: boolean
  /** being paid this minute */
  releasing?: boolean
}
/** A payee that could not be signed for, or whose release the ledger refused. */
interface Held { paymentId: string; requestNumber: string; payee: string; amount: number; reason: string | null }
interface Loan {
  id: string; name: string; loanNumber: string | null; loanAmount: number; amountDrawn: number
  method: 'test_xrp' | 'token_escrow' | 'two_signature'
  loanAccount: string | null; lenderWallet: string | null
  locked: Locked[]; held?: Held[]; lockedTotal: number
  walletBalance: string | null; loanAccountBalance: string | null
  /** two_signature: release slots left on the loan account; null when unknown or not applicable. */
  slotsFree: number | null
}
interface Funding { loans: Loan[]; walletSigning: boolean; tokenReady: boolean }
interface Open { title: string; requestId: string; qrPng: string; url: string; pushed?: boolean; instruction: string }

const short = (a: string) => (a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-6)}` : a)
/** Locked lines grouped by the draw they belong to, in the order they arrive. */
function byDraw(lines: Locked[]): Array<{ drawId: string; requestNumber: string; lines: Locked[] }> {
  const groups: Array<{ drawId: string; requestNumber: string; lines: Locked[] }> = []
  for (const line of lines) {
    const group = groups.find(g => g.drawId === line.drawId)
    if (group) group.lines.push(line)
    else groups.push({ drawId: line.drawId, requestNumber: line.requestNumber, lines: [line] })
  }
  return groups
}

const usd = (n: number | string | null) =>
  n == null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n))
const METHOD: Record<Loan['method'], string> = {
  test_xrp: 'Pilot (test XRP)', token_escrow: 'Lender escrow', two_signature: 'Two-signature loan account',
}
const date = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

export default function LenderFundingPage() {
  const [data, setData] = useState<Funding | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const [open, setOpen] = useState<Open | null>(null)
  const [outcome, setOutcome] = useState<{ state: string; error?: string } | null>(null)
  const [showQr, setShowQr] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch('/api/funding')
    const json = await res.json().catch(() => ({}))
    if (res.ok) setData(json); else setError(json.error || 'Your loans could not be loaded')
  }, [])
  useEffect(() => { load() }, [load])

  async function request(title: string, body: Record<string, unknown>, key: string) {
    setBusy(key); setError('')
    const res = await fetch('/api/funding', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const json = await res.json().catch(() => ({}))
    setBusy('')
    if (!res.ok) { setError(json.error || `The request could not be opened (${res.status})`); return }
    setOutcome(null); setShowQr(false); setOpen({ title, ...json })
  }

  // While a request is open on the lender's phone, ask every 3 seconds.
  useEffect(() => {
    if (!open || outcome) return
    let busy = false   // one status check at a time
    const id = setInterval(async () => {
      if (busy) return
      busy = true
      let res: Response
      try { res = await fetch(`/api/funding?request=${open.requestId}`) } catch { busy = false; return }
      busy = false
      const json = await res.json().catch(() => ({}))
      if (json.state && json.state !== 'waiting') { setOutcome(json); load() }
    }, 3000)
    return () => clearInterval(id)
  }, [open, outcome, load])

  const tokenLoans = (data?.loans ?? []).filter(l => l.method !== 'test_xrp')
  const pilotLoans = (data?.loans ?? []).filter(l => l.method === 'test_xrp')

  return (
    <div>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40" role="dialog" aria-modal="true" aria-label={open.title}>
          <div className="w-full max-w-[440px] rounded-lg border" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
            <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: 'var(--bc-border)' }}>
              <h2 style={{ fontSize: '1.1rem' }}>{open.title}</h2>
              <button onClick={() => setOpen(null)} aria-label="Close" className="p-1.5 rounded hover:bg-slate-900/5"><X size={18} style={{ color: 'var(--bc-muted)' }} /></button>
            </div>
            <div className="px-6 py-6 text-center">
              <p className="text-sm text-left mb-5" style={{ color: 'var(--bc-text)' }}>{open.instruction}</p>
              {!outcome ? (
                <>
                  {open.pushed && (
                    <>
                      <Smartphone size={36} className="mx-auto" style={{ color: 'var(--bc-text)' }} />
                      <div className="mt-2 text-sm font-bold" style={{ color: 'var(--bc-text)' }}>Sent to your phone. Open Xaman to approve.</div>
                      {open.qrPng && (
                        <button type="button" onClick={() => setShowQr(v => !v)} aria-expanded={showQr}
                          className="mt-2 inline-flex items-center gap-1.5 text-xs underline" style={{ color: 'var(--bc-muted)' }}>
                          <QrCode size={12} /> {showQr ? 'Hide QR code' : 'Show QR code'}
                        </button>
                      )}
                    </>
                  )}
                  {open.qrPng && (!open.pushed || showQr) && (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={open.qrPng} alt="QR code to open this request in Xaman" width={188} height={188} className={`mx-auto rounded-md border bg-white p-2 max-w-full h-auto ${open.pushed ? 'mt-3' : ''}`} style={{ borderColor: 'var(--bc-border)' }} />
                      <div className="mt-3 flex items-center justify-center gap-1.5 text-xs font-semibold"><Smartphone size={14} /> Scan with Xaman</div>
                    </>
                  )}
                  <a href={open.url} target="_blank" rel="noopener noreferrer" className="block mt-1 text-xs underline" style={{ color: 'var(--bc-blue)' }}>On your phone? Open in Xaman</a>
                  <div className="mt-4 flex items-center justify-center gap-1.5 text-xs" style={{ color: 'var(--bc-muted)' }}><Loader2 size={12} className="animate-spin" /> Waiting for your signature</div>
                </>
              ) : outcome.state === 'done' ? (
                <div className="py-4">
                  <span className="inline-flex items-center justify-center w-11 h-11 rounded-full" style={{ background: '#15803d', color: '#fff' }}><Check size={22} /></span>
                  <div className="mt-3 text-sm font-bold">Done, and confirmed on the ledger</div>
                </div>
              ) : (
                <div className="py-4 text-sm text-left" style={{ color: '#c0392b' }}>
                  {outcome.state === 'rejected' ? 'You declined the request in Xaman.' : outcome.state === 'expired' ? 'The request expired before it was signed.' : outcome.error || 'The request did not go through.'}
                  <div className="mt-1" style={{ color: 'var(--bc-muted)' }}>Nothing moved.</div>
                </div>
              )}
              {outcome && <button onClick={() => setOpen(null)} className="mt-4 px-4 py-2 rounded-lg text-sm font-bold border" style={{ borderColor: 'var(--bc-border)' }}>Close</button>}
            </div>
          </div>
        </div>
      )}

      <div className="mb-6">
        <h1 className="text-2xl font-bold">Funding</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--bc-muted)' }}>
          Where your money sits on the ledger, loan by loan. BuildChain never holds it or your keys.
        </p>
      </div>

      <LenderWalletCard />
      <FeeTermsCard />
      {error && <div className="rounded-lg border px-4 py-3 mb-5 text-sm" style={{ borderColor: 'rgba(192,57,43,0.3)', background: 'rgba(192,57,43,0.06)', color: '#c0392b' }}>{error}</div>}
      {!data && !error && <div className="text-sm" style={{ color: 'var(--bc-muted)' }}>Reading the ledger…</div>}

      {tokenLoans.map(loan => {
        const free = loan.loanAccountBalance == null ? null : Number(loan.loanAccountBalance) - loan.lockedTotal
        return (
          <div key={loan.id} className="rounded-lg border mb-5" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
            <div className="px-6 py-4 border-b flex flex-wrap items-baseline justify-between gap-2" style={{ borderColor: 'var(--bc-border)' }}>
              <h2>{loan.name}{loan.loanNumber && <span className="ml-2 text-xs font-mono" style={{ color: 'var(--bc-muted)' }}>#{loan.loanNumber}</span>}</h2>
              <span className="badge badge-blue">{METHOD[loan.method]}</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 border-b" style={{ borderColor: 'var(--bc-border)' }}>
              {(loan.method === 'two_signature'
                ? [['In the loan account', usd(loan.loanAccountBalance)], ['Committed to approved payments', usd(loan.lockedTotal)], ['Free to take back', usd(free)], ['In your wallet', usd(loan.walletBalance)]]
                : [['In your wallet', usd(loan.walletBalance)], ['Locked in escrow', usd(loan.lockedTotal)], ['Loan amount', usd(loan.loanAmount)], ['Drawn to date', usd(loan.amountDrawn)]]
              ).map(([label, value]) => (
                <div key={label} className="px-6 py-4">
                  <div className="bc-figure text-[22px] tabular-nums">{value}</div>
                  <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--bc-muted)' }}>{label}</div>
                </div>
              ))}
            </div>

            {loan.method === 'two_signature' && (
              <div className="px-6 py-4 border-b flex flex-wrap items-center gap-3" style={{ borderColor: 'var(--bc-border)' }}>
                {!loan.loanAccount ? (
                  <span className="text-sm" style={{ color: 'var(--bc-muted)' }}>The loan account has not been opened yet.</span>
                ) : (
                  <>
                    <label className="text-sm" htmlFor={`amt-${loan.id}`} style={{ color: 'var(--bc-muted)' }}>Amount</label>
                    <input id={`amt-${loan.id}`} inputMode="decimal" placeholder="0.00" value={amounts[loan.id] ?? ''}
                      onChange={e => setAmounts(a => ({ ...a, [loan.id]: e.target.value.replace(/[^0-9.]/g, '') }))}
                      className="w-36 rounded-lg px-3 py-1.5 text-sm border tabular-nums" style={{ borderColor: 'var(--bc-border)', background: 'var(--bc-card)' }} />
                    <button disabled={!!busy || !(Number(amounts[loan.id]) > 0)}
                      onClick={() => request('Deposit into the loan account', { projectId: loan.id, kind: 'deposit', amount: Number(amounts[loan.id]) }, loan.id + 'deposit')}
                      className="px-4 py-1.5 rounded-lg text-sm font-bold disabled:opacity-50" style={{ background: 'var(--bc-gold)', color: 'var(--bc-dark)' }}>
                      {busy === loan.id + 'deposit' ? 'Checking…' : 'Deposit'}
                    </button>
                    <button disabled={!!busy || !(Number(amounts[loan.id]) > 0)}
                      onClick={() => request('Take money back', { projectId: loan.id, kind: 'refund', amount: Number(amounts[loan.id]) }, loan.id + 'refund')}
                      className="px-4 py-1.5 rounded-lg text-sm font-bold border disabled:opacity-50" style={{ borderColor: 'var(--bc-border)' }}>
                      {busy === loan.id + 'refund' ? 'Checking…' : 'Take back'}
                    </button>
                    <span className="text-xs font-mono break-all" style={{ color: 'var(--bc-muted)' }}>{loan.loanAccount}</span>
                    <div className="w-full flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      {loan.slotsFree == null ? (
                        <span className="text-sm" style={{ color: 'var(--bc-muted)' }}>Release slots: unavailable</span>
                      ) : (
                        <>
                          <span className={`text-sm tabular-nums ${loan.slotsFree <= 10 ? 'font-bold' : ''}`} style={{ color: loan.slotsFree <= 10 ? '#c0392b' : 'var(--bc-text)' }}>
                            Release slots left: {loan.slotsFree}
                          </span>
                          {loan.slotsFree <= 10 && (
                            <span className="text-xs font-semibold" role="status" style={{ color: '#c0392b' }}>Running low: approvals will stop when these run out.</span>
                          )}
                          <span className="text-xs" style={{ color: 'var(--bc-muted)' }}>Each payment to a payee uses one.</span>
                          {loan.slotsFree <= 40 && (
                            <button disabled={!!busy}
                              onClick={() => request('Add release slots', { projectId: loan.id, kind: 'add_slots' }, loan.id + 'add_slots')}
                              className="px-3 py-1.5 rounded-lg text-xs font-bold border disabled:opacity-50" style={{ borderColor: 'var(--bc-border)' }}>
                              {busy === loan.id + 'add_slots' ? 'Checking…' : 'Add 50 slots'}
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

            <div className="px-6 py-4">
              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] mb-2" style={{ color: 'var(--bc-muted)' }}>Approved payments awaiting release</div>
              {loan.locked.length === 0 ? (
                <div className="text-sm" style={{ color: 'var(--bc-muted)' }}>None. Money is committed only while an approved payment waits for its inspection and lien waiver.</div>
              ) : byDraw(loan.locked).map(group => (
                <div key={group.drawId} className="rounded-lg border mb-3 last:mb-0" style={{ borderColor: 'var(--bc-border)' }}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2 border-b" style={{ borderColor: 'var(--bc-border)', background: 'var(--bc-page)' }}>
                    <span className="text-sm font-semibold">Draw {group.requestNumber}</span>
                    <span className="text-xs tabular-nums" style={{ color: 'var(--bc-muted)' }}>
                      {group.lines.length === 1 ? '1 payee' : `${group.lines.length} payees`} · {usd(group.lines.reduce((t, l) => t + l.amount, 0))}
                    </span>
                  </div>
                  {group.lines.map(d => {
                    const escrow = d.method === 'token_escrow'
                    const due = d.cancelAfter ? new Date(d.cancelAfter).getTime() <= Date.now() : false
                    const blocked = escrow && !due
                    return (
                      <div key={d.paymentId} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5 border-t first:border-t-0" style={{ borderColor: 'var(--bc-border)' }}>
                        <div className="min-w-0 flex-1 basis-56">
                          <div className="flex items-baseline justify-between gap-3">
                            <span className="text-sm font-semibold truncate">{d.payee}</span>
                            <span className="text-sm tabular-nums shrink-0">{usd(d.amount)}</span>
                          </div>
                          <div className="mt-0.5 text-xs break-words" style={{ color: 'var(--bc-muted)' }}>
                            {d.wallet && <><span className="font-mono">{short(d.wallet)}</span><span aria-hidden="true"> · </span></>}
                            {d.releasing
                              ? 'Being paid now'
                              : d.releaseFailed
                                ? 'The ledger did not accept this payment when it was released. It is still signed for and nothing was paid; BuildChain has been alerted and it will be tried again.'
                                : escrow
                                  ? (d.cancelAfter ? `You can take it back on or after ${date(d.cancelAfter)}` : 'Locked in escrow')
                                  : 'You signed the release; it pays when both conditions are recorded'}
                          </div>
                        </div>
                        <button disabled={!!busy || blocked || !!d.releasing}
                          title={blocked
                            ? (d.cancelAfter
                              ? `The ledger allows the take-back on or after ${date(d.cancelAfter)}`
                              : 'The take-back date could not be read from the ledger')
                            : ''}
                          onClick={() => request(escrow ? 'Take back the escrow' : 'Withdraw your approval',
                            { projectId: loan.id, kind: escrow ? 'escrow_cancel' : 'withdraw_release', paymentId: d.paymentId }, d.paymentId)}
                          className="px-3 py-1.5 rounded-lg text-xs font-bold border disabled:opacity-50 shrink-0" style={{ borderColor: 'var(--bc-border)' }}>
                          {busy === d.paymentId ? 'Checking…' : escrow ? 'Take back' : 'Withdraw approval'}
                        </button>
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>

            {(loan.held ?? []).length > 0 && (
              <div className="px-6 py-4 border-t" style={{ borderColor: 'var(--bc-border)' }}>
                <div className="text-[10px] font-semibold uppercase tracking-[0.12em] mb-1" style={{ color: 'var(--bc-muted)' }}>On hold</div>
                <div className="text-xs mb-2" style={{ color: 'var(--bc-muted)' }}>Not locked and not paid by the protocol.</div>
                {(loan.held ?? []).map(h => (
                  <div key={h.paymentId} className="py-2 border-t first:border-t-0" style={{ borderColor: 'var(--bc-border)' }}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm font-semibold truncate min-w-0">{h.payee}</span>
                      <span className="text-sm tabular-nums shrink-0">{usd(h.amount)}</span>
                    </div>
                    <div className="mt-0.5 text-xs break-words" style={{ color: 'var(--bc-muted)' }}>
                      {h.requestNumber ? `Draw ${h.requestNumber} · ` : ''}{h.reason || 'This payee cannot be paid yet'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}

      {data && tokenLoans.length === 0 && (
        <div className="rounded-lg border px-6 py-6 mb-5 text-sm" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)', color: 'var(--bc-muted)' }}>
          {pilotLoans.length
            ? `Your ${pilotLoans.length === 1 ? 'loan is' : 'loans are'} on the pilot method: draws are recorded on the XRP Ledger test network and no dollars move, so there is nothing to fund.`
            : 'You have no loans yet.'}
        </div>
      )}

      <LenderInvoices />
      {data && <FeeStatement />}
    </div>
  )
}
