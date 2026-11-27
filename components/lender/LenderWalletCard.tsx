'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Wallet } from 'lucide-react'

type State = 'loading' | 'unavailable' | 'none' | 'waiting' | 'connected' | 'not_lender'

/**
 * The lender's own wallet. Connecting it is a sign-in approved in Xaman: it
 * proves the lender controls the account and moves nothing.
 */
export default function LenderWalletCard() {
  const [state, setState] = useState<State>('loading')
  const [wallet, setWallet] = useState<string | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [link, setLink] = useState<string | null>(null)
  const [note, setNote] = useState('')

  const read = useCallback(async () => {
    const res = await fetch('/api/lenders/wallet')
    if (res.status === 403) { setState('not_lender'); return }
    const json = await res.json().catch(() => ({}))
    if (!res.ok) { setNote(json.error || 'Could not read the wallet'); setState('none'); return }
    setWallet(json.wallet ?? null)
    if (json.state === 'waiting') { setState('waiting'); return }
    if (json.state === 'rejected') setNote('The request was declined in Xaman.')
    if (json.state === 'expired') setNote('The request expired.')
    if (json.state === 'connected') { setQr(null); setNote('') }
    setState(json.wallet ? 'connected' : json.available ? 'none' : 'unavailable')
  }, [])

  useEffect(() => { read() }, [read])
  useEffect(() => {
    if (state !== 'waiting') return
    const id = setInterval(read, 3000)
    return () => clearInterval(id)
  }, [state, read])

  async function connect() {
    setNote('')
    const res = await fetch('/api/lenders/wallet', { method: 'POST' })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) { setNote(json.error || 'Could not start the connection'); return }
    setQr(json.qrPng); setLink(json.url); setState('waiting')
  }

  // Admins reviewing this page, and sites without wallet signing, see nothing.
  if (state === 'loading' || state === 'not_lender' || state === 'unavailable') return null

  return (
    <div className="rounded-lg border px-5 py-4 mb-6 flex flex-wrap items-center gap-4" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
      <Wallet size={20} style={{ color: 'var(--bc-gold-ink)' }} />
      <div className="flex-1 min-w-[220px]">
        <div className="text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--bc-muted)' }}>Lending wallet</div>
        {state === 'connected' && wallet ? (
          <div className="text-sm font-mono mt-0.5" style={{ color: 'var(--bc-text)' }}>{wallet}</div>
        ) : (
          <div className="text-sm mt-0.5" style={{ color: 'var(--bc-text)' }}>
            {state === 'waiting'
              ? 'Approve the sign-in request in Xaman. It moves nothing and costs nothing.'
              : 'Connect the wallet you fund draws from. You approve each draw by signing in it.'}
          </div>
        )}
        {note && <div className="text-xs mt-1" style={{ color: '#c0392b' }}>{note}</div>}
      </div>
      {state === 'waiting' && qr && (
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="QR code to connect your wallet in Xaman" width={96} height={96} className="rounded border bg-white p-1" style={{ borderColor: 'var(--bc-border)' }} />
          <div className="text-xs" style={{ color: 'var(--bc-muted)' }}>
            <div className="flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Waiting for Xaman</div>
            {link && <a href={link} target="_blank" rel="noopener noreferrer" className="underline" style={{ color: 'var(--bc-blue)' }}>Open in Xaman</a>}
          </div>
        </div>
      )}
      {(state === 'none' || state === 'connected') && (
        <button onClick={connect} className="px-4 py-2 rounded-lg text-sm font-bold border" style={{ borderColor: 'var(--bc-border)', color: 'var(--bc-text)' }}>
          {state === 'connected' ? 'Change wallet' : 'Connect Xaman wallet'}
        </button>
      )}
    </div>
  )
}
