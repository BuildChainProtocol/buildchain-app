'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { BuildChainLogo } from '@/components/shared/BuildChainLogo'

type Phase = 'intro' | 'starting' | 'waiting' | 'confirming' | 'ready' | 'stopped' | 'unavailable'

/**
 * A contractor or subcontractor gets their wallet ready to be paid: one
 * approval in Xaman. Open to anyone; no account on this site is needed.
 */
export default function WalletSetupPage() {
  const [phase, setPhase] = useState<Phase>('intro')
  const [qr, setQr] = useState('')
  const [link, setLink] = useState('')
  const [requestId, setRequestId] = useState('')
  const [currency, setCurrency] = useState('the settlement token')
  const [address, setAddress] = useState('')
  const [note, setNote] = useState('')
  const [checkAddress, setCheckAddress] = useState('')
  const [checkResult, setCheckResult] = useState('')
  const busy = useRef(false)

  async function start() {
    setPhase('starting'); setNote('')
    const res = await fetch('/api/wallet/trustline', { method: 'POST' })
    const json = await res.json().catch(() => ({}))
    if (res.status === 503) { setPhase('unavailable'); return }
    if (!res.ok) { setNote(json.error || 'Could not start. Please try again.'); setPhase('intro'); return }
    setQr(json.qrPng); setLink(json.url); setRequestId(json.requestId); setCurrency(json.currency || currency)
    setPhase('waiting')
  }

  useEffect(() => {
    if (phase !== 'waiting' && phase !== 'confirming') return
    const id = setInterval(async () => {
      if (busy.current) return
      busy.current = true
      try {
        const res = await fetch(`/api/wallet/trustline?request=${requestId}`)
        const json = await res.json().catch(() => ({}))
        if (json.state === 'ready') { setAddress(json.address); setPhase('ready') }
        else if (json.state === 'confirming') { setAddress(json.address); setPhase('confirming') }
        else if (json.state === 'rejected') { setNote('You declined the request in Xaman. Nothing changed.'); setPhase('stopped') }
        else if (json.state === 'expired') { setNote('The request expired before it was approved.'); setPhase('stopped') }
      } catch { /* try again on the next tick */ }
      busy.current = false
    }, 3000)
    return () => clearInterval(id)
  }, [phase, requestId])

  async function check(e: React.FormEvent) {
    e.preventDefault()
    setCheckResult('Checking…')
    const res = await fetch(`/api/wallet/trustline?address=${encodeURIComponent(checkAddress.trim())}`)
    const json = await res.json().catch(() => ({}))
    if (!res.ok) { setCheckResult(json.error || 'Could not check that address.'); return }
    setCheckResult(json.ready ? 'This wallet is ready to be paid.' : (json.note || 'This wallet is not ready yet. Use the button above to set it up.'))
  }

  const gold = { background: 'var(--bc-gold)', color: 'var(--bc-dark)' }
  return (
    <div className="min-h-screen" style={{ background: 'var(--bc-dark)' }}>
      <main className="mx-auto px-4 sm:px-8 py-12" style={{ maxWidth: 620 }}>
        <Link href="/"><BuildChainLogo variant="lockup" height={72} alt="BuildChain Protocol" /></Link>
        <h1 className="text-2xl font-bold mt-8 mb-3">Get your wallet ready to be paid</h1>
        <p className="text-sm mb-6" style={{ color: 'var(--bc-muted)', lineHeight: 1.7 }}>
          Draw payments on BuildChain arrive in your own wallet as {currency}, a dollar token on the XRP Ledger.
          A wallet has to accept a token before it can receive it. You do that once, by approving one request in the
          Xaman wallet app. It moves nothing and gives nobody access to your wallet.
        </p>

        <div className="rounded-xl p-6 border" style={{ background: 'var(--bc-navy)', borderColor: 'var(--bc-border)' }}>
          {phase === 'unavailable' && (
            <p className="text-sm" style={{ color: 'var(--bc-muted)' }}>Wallet set-up is not available on this site yet. Please check back later.</p>
          )}

          {(phase === 'intro' || phase === 'starting' || phase === 'stopped') && (
            <>
              <ol className="text-sm space-y-2 mb-5" style={{ color: '#e8edf2', lineHeight: 1.6 }}>
                <li>1. Install Xaman on your phone and create or import your wallet.</li>
                <li>2. Press the button below and scan the code with Xaman.</li>
                <li>3. Approve the request. Your wallet can then be paid.</li>
              </ol>
              {note && <p className="text-sm mb-4" style={{ color: '#e74c3c' }}>{note}</p>}
              <button onClick={start} disabled={phase === 'starting'} className="px-5 py-2.5 rounded-lg font-bold text-sm" style={gold}>
                {phase === 'starting' ? 'Preparing…' : phase === 'stopped' ? 'Try again' : 'Set up my wallet'}
              </button>
            </>
          )}

          {(phase === 'waiting' || phase === 'confirming') && (
            <div className="flex flex-col sm:flex-row gap-6 items-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qr} alt="QR code to open this request in Xaman" width={188} height={188} className="rounded-md bg-white p-2" />
              <div className="text-sm" style={{ color: '#e8edf2', lineHeight: 1.7 }}>
                <p className="font-bold mb-1">{phase === 'confirming' ? 'Approved. Confirming on the ledger…' : 'Scan with Xaman and approve'}</p>
                <p style={{ color: 'var(--bc-muted)' }}>
                  {phase === 'confirming' ? 'This takes a few seconds.' : 'Keep this page open. It updates by itself.'}
                </p>
                {phase === 'waiting' && link && (
                  <a href={link} target="_blank" rel="noopener noreferrer" className="underline" style={{ color: 'var(--bc-gold)' }}>On your phone? Open in Xaman</a>
                )}
              </div>
            </div>
          )}

          {phase === 'ready' && (
            <>
              <p className="font-bold mb-2" style={{ color: '#2ecc71' }}>Your wallet is ready to be paid.</p>
              <p className="text-sm mb-3" style={{ color: 'var(--bc-muted)' }}>Give this address to your general contractor or enter it where you are asked for your wallet:</p>
              <p className="font-mono text-sm break-all p-3 rounded-lg" style={{ background: 'rgba(255,255,255,0.05)', color: '#e8edf2' }}>{address}</p>
            </>
          )}
        </div>

        <form onSubmit={check} className="mt-8">
          <label htmlFor="addr" className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--bc-muted)' }}>
            Already set up? Check a wallet address
          </label>
          <div className="flex gap-2">
            <input id="addr" value={checkAddress} onChange={e => setCheckAddress(e.target.value)} placeholder="r…" required
              className="flex-1 rounded-lg px-3 py-2.5 text-sm outline-none font-mono"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--bc-border)', color: '#e8edf2' }} />
            <button type="submit" className="px-4 py-2.5 rounded-lg font-bold text-sm border" style={{ borderColor: 'var(--bc-border)', color: '#e8edf2' }}>Check</button>
          </div>
          {checkResult && <p className="text-sm mt-2" style={{ color: 'var(--bc-muted)' }}>{checkResult}</p>}
        </form>

        <p className="text-xs mt-10" style={{ color: 'var(--bc-muted)' }}>
          BuildChain is in pilot on the XRP Ledger test network. BuildChain never holds your funds or your keys.
        </p>
      </main>
    </div>
  )
}
