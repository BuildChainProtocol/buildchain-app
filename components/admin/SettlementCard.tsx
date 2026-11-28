'use client'

import { useCallback, useEffect, useState } from 'react'

interface Info {
  method: 'test_xrp' | 'token_escrow' | 'two_signature'
  loanAccount: string | null
  lenderWallet: string | null
  network: 'testnet' | 'mainnet'
  tokenConfigured: boolean
  feeTermsAccepted: boolean
  token?: { currency: string; issuer: string }
  issuerAllowsEscrow?: boolean
  lenderBalance?: string | null
  loanAccountBalance?: string | null
  loanAccountProblems?: string[]
  ledgerError?: string
}

const LABEL: Record<Info['method'], { name: string; what: string }> = {
  test_xrp: { name: 'Pilot (test XRP)', what: 'BuildChain\'s test wallet locks 1 test XRP per draw. No dollars move.' },
  token_escrow: { name: 'Lender escrow (dollar token)', what: 'The lender locks each draw in a ledger escrow from its own wallet. Needs the token\'s issuer to allow escrow.' },
  two_signature: { name: 'Two-signature loan account', what: 'The lender deposits into a loan account that pays out only with both the lender\'s and BuildChain\'s signature.' },
}
const money = (v?: string | null) =>
  v == null ? 'no trust line' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(v))

/** Admin: how this project's draws settle, with what the ledger says right now. */
export default function SettlementCard({ projectId }: { projectId: string }) {
  const [info, setInfo] = useState<Info | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}/settlement`)
    if (res.ok) setInfo(await res.json())
  }, [projectId])
  useEffect(() => { load() }, [load])

  async function choose(method: Info['method']) {
    setBusy(method); setError('')
    const res = await fetch(`/api/projects/${projectId}/settlement`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) setError(json.error || `Could not change the method (${res.status})`)
    await load()
    setBusy('')
  }

  if (!info) return null
  const rows: [string, string][] = [
    ['Network', info.network === 'testnet' ? 'XRP Ledger test network' : 'XRP Ledger mainnet'],
    ['Lender wallet', info.lenderWallet ?? 'not connected yet'],
    ['Fee terms', info.feeTermsAccepted ? 'Accepted by the lender' : 'Not accepted yet (the lender accepts them on their Funding page)'],
  ]
  if (info.tokenConfigured && info.token) {
    rows.push(['Settlement token', `${info.token.currency} · issuer ${info.token.issuer}`])
    rows.push(['Issuer allows escrow', info.issuerAllowsEscrow ? 'Yes' : 'No'])
    if (info.lenderWallet) rows.push(['Lender wallet balance', money(info.lenderBalance)])
    if (info.loanAccount) {
      rows.push(['Loan account', info.loanAccount])
      rows.push(['Loan account balance', money(info.loanAccountBalance)])
      rows.push(['Loan account check', info.loanAccountProblems?.length ? info.loanAccountProblems.join('; ') : 'Master key disabled; lender and BuildChain both required'])
    }
  } else {
    rows.push(['Settlement token', 'not configured on this site (dollar-token methods are unavailable)'])
  }

  return (
    <div className="rounded-lg border mb-5" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
      <div className="px-6 py-4 border-b" style={{ borderColor: 'var(--bc-border)' }}>
        <h3 className="uppercase">Settlement</h3>
        <div className="mt-1 text-sm" style={{ color: 'var(--bc-text)' }}>
          <strong>{LABEL[info.method].name}.</strong> {LABEL[info.method].what}
        </div>
      </div>
      <dl className="px-6 py-3 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex gap-4 py-1.5">
            <dt className="w-44 shrink-0" style={{ color: 'var(--bc-muted)' }}>{k}</dt>
            <dd className="break-all" style={{ color: 'var(--bc-text)' }}>{v}</dd>
          </div>
        ))}
        {info.ledgerError && <div className="py-1.5 text-xs" style={{ color: '#c0392b' }}>{info.ledgerError}</div>}
      </dl>
      <div className="px-6 py-4 border-t flex flex-wrap items-center gap-2" style={{ borderColor: 'var(--bc-border)' }}>
        {(Object.keys(LABEL) as Info['method'][]).filter(m => m !== info.method).map(m => (
          <button key={m} onClick={() => choose(m)} disabled={!!busy || (m !== 'test_xrp' && !info.tokenConfigured)}
            title={LABEL[m].what}
            className="px-3 py-1.5 rounded-lg text-xs font-bold border disabled:opacity-50"
            style={{ borderColor: 'var(--bc-border)', color: 'var(--bc-text)' }}>
            {busy === m ? (m === 'two_signature' && !info.loanAccount ? 'Opening the loan account (about 30 s)…' : 'Switching…') : `Switch to ${LABEL[m].name}`}
          </button>
        ))}
        {error && <span className="text-xs" style={{ color: '#c0392b' }}>{error}</span>}
        {info.network === 'mainnet' && !info.feeTermsAccepted && (
          <div className="w-full text-xs" style={{ color: 'var(--bc-muted)' }}>
            A loan can move to real settlement only after its lender has accepted the fee terms.
          </div>
        )}
      </div>
    </div>
  )
}
