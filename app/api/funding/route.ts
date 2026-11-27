import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase/service'
import { NextRequest, NextResponse } from 'next/server'
import { Wallet } from 'xrpl'
import { createSignRequest, getSignResult, isXamanConfigured } from '@/lib/xaman'
import { getConnectedClient } from '@/lib/xrpl/client'
import { isTokenMethod, settlementToken } from '@/lib/xrpl/release'
import {
  buildDeposit, buildEscrowCancel, buildRefundPayment, buildVoidTicket, countersignAndSubmit,
  loanTickets, tokenBalance, usdValue, validatedResult, verifyLenderSigned,
} from '@/lib/xrpl/settlement'

// A lender's funding desk: what sits where on the ledger, and the things a
// lender signs outside a draw approval (deposit, refund, take-backs).
//   GET                 the lender's loans with live ledger balances
//   GET ?request=<id>   has the lender signed that request? If so, finish it
//   POST                open a request: { projectId, kind, amount?, drawId? }
export const runtime = 'nodejs'
export const maxDuration = 60
export const dynamic = 'force-dynamic'

const RIPPLE_EPOCH = 946684800
const dollars = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function session(): Promise<{ supabase: any; userId: string } | NextResponse> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!profile || !['admin', 'lender'].includes((profile as any).role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return { supabase, userId: user.id }
}

const PROJECT_SELECT = `
  id, name, loan_number, loan_amount, amount_drawn, settlement_method, loan_account,
  lenders ( xrp_address, company_name ),
  draw_requests ( id, request_number, status, settlement_method, settlement_state, settlement_amount,
                  settlement_payee, escrow_owner, escrow_sequence, release_ticket )
`

export async function GET(req: NextRequest) {
  const s = await session()
  if (s instanceof NextResponse) return s
  const { supabase } = s
  const requestId = req.nextUrl.searchParams.get('request')
  if (requestId) return finish(supabase, requestId)

  // Row-level security limits a lender to their own projects.
  const { data: projects, error } = await supabase.from('projects').select(PROJECT_SELECT).is('archived_at', null).order('name')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const tokenReady = !!process.env.SETTLEMENT_TOKEN_ISSUER
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const loans: any[] = (projects ?? []).map((p: any) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const locked = (p.draw_requests ?? []).filter((d: any) => d.settlement_state === 'locked')
    return {
      id: p.id, name: p.name, loanNumber: p.loan_number, loanAmount: Number(p.loan_amount), amountDrawn: Number(p.amount_drawn ?? 0),
      method: p.settlement_method ?? 'test_xrp', loanAccount: p.loan_account ?? null,
      lenderWallet: p.lenders?.xrp_address ?? null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      locked: locked.map((d: any) => ({
        drawId: d.id, requestNumber: d.request_number, amount: Number(d.settlement_amount), payee: d.settlement_payee,
        method: d.settlement_method, cancelAfter: null as string | null,
      })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      lockedTotal: locked.reduce((sum: number, d: any) => sum + Number(d.settlement_amount ?? 0), 0),
      walletBalance: null as string | null, loanAccountBalance: null as string | null,
      _draws: locked,
    }
  })

  if (tokenReady && loans.some(l => isTokenMethod(l.method))) {
    try {
      const token = settlementToken()
      const client = await getConnectedClient()
      try {
        for (const loan of loans) {
          if (!isTokenMethod(loan.method)) continue
          if (loan.lenderWallet) loan.walletBalance = await tokenBalance(client, loan.lenderWallet, token)
          if (loan.loanAccount) loan.loanAccountBalance = await tokenBalance(client, loan.loanAccount, token)
          for (let i = 0; i < loan.locked.length; i++) {
            const d = loan._draws[i]
            if (d.settlement_method !== 'token_escrow' || !d.escrow_owner || d.escrow_sequence == null) continue
            try {
              const entry = await client.request({ command: 'ledger_entry', escrow: { owner: d.escrow_owner, seq: d.escrow_sequence }, ledger_index: 'validated' })
              const after = Number((entry.result.node as unknown as { CancelAfter?: number }).CancelAfter ?? 0)
              if (after) loan.locked[i].cancelAfter = new Date((after + RIPPLE_EPOCH) * 1000).toISOString()
            } catch { /* escrow no longer on the ledger */ }
          }
        }
      } finally { await client.disconnect() }
    } catch { /* balances stay null; the screen says they are unavailable */ }
  }
  for (const loan of loans) delete loan._draws

  const { data: requests } = await supabase.from('settlement_requests')
    .select('id, project_id, kind, amount, state, txn_hash, error, created_at').order('created_at', { ascending: false }).limit(20)
  return NextResponse.json({ loans, requests: requests ?? [], walletSigning: isXamanConfigured(), tokenReady })
}

export async function POST(req: NextRequest) {
  const s = await session()
  if (s instanceof NextResponse) return s
  const { supabase, userId } = s
  const body = await req.json().catch(() => ({}))
  const kind = String(body?.kind ?? '')
  if (!['deposit', 'refund', 'escrow_cancel', 'withdraw_release'].includes(kind)) {
    return NextResponse.json({ error: 'Unknown request' }, { status: 400 })
  }
  if (!isXamanConfigured()) return NextResponse.json({ error: 'Wallet signing is not set up on this site yet (Xaman keys are missing)' }, { status: 503 })
  // A person opens a handful of these in a day; a script should not open hundreds.
  const { count: recent } = await supabase.from('settlement_requests').select('id', { count: 'exact', head: true })
    .eq('requested_by', userId).gte('created_at', new Date(Date.now() - 60 * 60 * 1000).toISOString())
  if ((recent ?? 0) >= 20) return NextResponse.json({ error: 'Too many requests in the last hour. Try again later.' }, { status: 429 })

  const { data: project } = await supabase.from('projects').select(PROJECT_SELECT).eq('id', String(body?.projectId ?? '')).single()
  if (!project) return NextResponse.json({ error: 'Loan not found' }, { status: 404 })
  const lender = project.lenders?.xrp_address
  if (!lender) return NextResponse.json({ error: 'Connect the lender\'s wallet first' }, { status: 409 })
  if (!isTokenMethod(project.settlement_method)) return NextResponse.json({ error: 'This loan is on the pilot method; there is nothing to fund' }, { status: 409 })

  try {
    const token = settlementToken()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const draws: any[] = project.draw_requests ?? []
    const draw = body?.drawId ? draws.find(d => d.id === body.drawId) : null
    let txjson: Record<string, unknown>
    let multisign = false
    let amount: number | null = null
    let instruction = ''

    const client = await getConnectedClient()
    try {
      // Tickets already promised: pending draws, and requests still waiting on a signature.
      const freeTicket = async () => {
        const { data: waiting } = await supabase.from('settlement_requests').select('txjson').eq('project_id', project.id).eq('state', 'waiting')
        const used = new Set<number>([
          ...draws.filter(d => d.release_ticket != null && d.settlement_state !== 'released').map(d => Number(d.release_ticket)),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ...(waiting ?? []).map((w: any) => Number(w.txjson?.TicketSequence)).filter((n: number) => Number.isFinite(n)),
        ])
        const t = (await loanTickets(client, project.loan_account)).find(x => !used.has(x))
        if (t === undefined) throw new Error('The loan account has no free slots left')
        return t
      }

      if (kind === 'deposit' || kind === 'refund') {
        if (project.settlement_method !== 'two_signature' || !project.loan_account) throw new Error('This loan has no two-signature account')
        amount = Number(body?.amount)
        usdValue(amount)
        if (kind === 'deposit') {
          const bal = Number(await tokenBalance(client, lender, token) ?? 0)
          if (bal < amount) throw new Error(`Your wallet holds ${dollars(bal)}, less than this deposit`)
          txjson = buildDeposit({ lender, loanAccount: project.loan_account, token, usd: amount })
          instruction = `Deposit ${dollars(amount)} into the loan account for ${project.name}. It can leave only with both your signature and BuildChain's.`
        } else {
          const bal = Number(await tokenBalance(client, project.loan_account, token) ?? 0)
          const committed = draws.filter(d => d.settlement_state === 'locked').reduce((sum, d) => sum + Number(d.settlement_amount ?? 0), 0)
          if (amount > bal - committed) {
            throw new Error(`Only ${dollars(Math.max(0, bal - committed))} is free to take back: ${dollars(committed)} is committed to approved draws`)
          }
          txjson = buildRefundPayment({ loanAccount: project.loan_account, lender, token, usd: amount, ticketSequence: await freeTicket() })
          multisign = true
          instruction = `Take ${dollars(amount)} back from the loan account for ${project.name} to your wallet.`
        }
      } else {
        if (!draw || draw.settlement_state !== 'locked') throw new Error('That draw is not locked')
        if (kind === 'escrow_cancel') {
          if (draw.settlement_method !== 'token_escrow' || draw.escrow_sequence == null) throw new Error('That draw has no escrow')
          const entry = await client.request({ command: 'ledger_entry', escrow: { owner: draw.escrow_owner, seq: draw.escrow_sequence }, ledger_index: 'validated' })
          const after = Number((entry.result.node as unknown as { CancelAfter?: number }).CancelAfter ?? 0)
          const when = new Date((after + RIPPLE_EPOCH) * 1000)
          if (when.getTime() > Date.now()) {
            throw new Error(`This escrow can be taken back on or after ${when.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}. The ledger enforces that date.`)
          }
          txjson = buildEscrowCancel({ lender, sequence: draw.escrow_sequence })
          instruction = `Take back the escrow for Draw ${draw.request_number} on ${project.name}: ${dollars(Number(draw.settlement_amount))} returns to your wallet.`
        } else {
          if (draw.settlement_method !== 'two_signature' || draw.release_ticket == null) throw new Error('That draw has no signed release')
          txjson = buildVoidTicket({ loanAccount: project.loan_account, ticketSequence: Number(draw.release_ticket), drawRequestId: draw.id })
          multisign = true
          instruction = `Withdraw your approval of Draw ${draw.request_number} on ${project.name}. The money stays in the loan account and your earlier signature can never be used.`
        }
        amount = Number(draw.settlement_amount)
      }
    } finally { await client.disconnect() }

    const request = await createSignRequest({ txjson, submit: !multisign, multisign, instruction, identifier: `${kind}-${project.id}`.slice(0, 40) })
    const { data: row, error } = await serviceClient().from('settlement_requests').insert({
      project_id: project.id, draw_request_id: draw?.id ?? null, kind, amount, txjson, payload: request.uuid, requested_by: userId,
    }).select('id').single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ requestId: row.id, qrPng: request.qrPng, url: request.url, instruction })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message.slice(0, 300) : 'Ledger error' }, { status: 409 })
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function finish(supabase: any, requestId: string) {
  const { data: r } = await supabase.from('settlement_requests')
    .select('*, projects ( id, loan_account, lenders ( xrp_address ) )').eq('id', requestId).single()
  if (!r) return NextResponse.json({ error: 'Request not found' }, { status: 404 })
  if (r.state !== 'waiting') return NextResponse.json({ state: r.state, txnHash: r.txn_hash, error: r.error })
  // The caller could read this request, so it is on one of their projects.
  // Its state, and the draw's, are written with the service key.
  const admin = serviceClient()

  const close = async (state: string, extra: Record<string, unknown> = {}) => {
    await admin.from('settlement_requests').update({ state, completed_at: new Date().toISOString(), ...extra }).eq('id', r.id).eq('state', 'waiting')
    return NextResponse.json({ state, ...('txn_hash' in extra ? { txnHash: extra.txn_hash } : {}), ...('error' in extra ? { error: extra.error } : {}) })
  }
  try {
    const result = await getSignResult(r.payload)
    if (!result.resolved) return result.expired ? close('expired') : NextResponse.json({ state: 'waiting' })
    if (!result.signed) return close('rejected')
    const lender = r.projects?.lenders?.xrp_address
    if (result.account !== lender) return close('failed', { error: 'Signed by a different wallet than the lender\'s registered wallet' })

    // Claim the request before acting on it. The screen asks every few
    // seconds; without this, two checks could each countersign and the second
    // would record a failure for something that succeeded.
    const { data: claimed } = await admin.from('settlement_requests')
      .update({ completed_at: new Date().toISOString() })
      .eq('id', r.id).eq('state', 'waiting')
      .or(`completed_at.is.null,completed_at.lt.${new Date(Date.now() - 2 * 60 * 1000).toISOString()}`)
      .select('id')
    if (!claimed?.length) return NextResponse.json({ state: 'waiting' })

    let hash: string | null = result.txid
    if (r.kind === 'refund' || r.kind === 'withdraw_release') {
      if (!result.hex) return close('failed', { error: 'The wallet did not return the signed transaction' })
      const problems = verifyLenderSigned(result.hex, r.txjson, lender)
      if (problems.length) return close('failed', { error: `The signature does not match the request: ${problems.join('; ')}` })
      if (r.kind === 'refund') {
        // Draws may have been approved since this refund was opened: money
        // committed to them cannot leave the loan account.
        const { data: lockedDraws } = await admin.from('draw_requests')
          .select('settlement_amount').eq('project_id', r.project_id).eq('settlement_state', 'locked')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const committed = (lockedDraws ?? []).reduce((sum: number, d: any) => sum + Number(d.settlement_amount ?? 0), 0)
        const check = await getConnectedClient()
        let balance = 0
        try { balance = Number(await tokenBalance(check, r.projects?.loan_account, settlementToken()) ?? 0) } finally { await check.disconnect() }
        if (Number(r.amount) > balance - committed) {
          return close('failed', { error: `Not sent: ${dollars(committed)} is now committed to approved draws, which leaves ${dollars(Math.max(0, balance - committed))} free.` })
        }
      }
      const seed = process.env.XRPL_WALLET_SEED
      if (!seed) return close('failed', { error: 'BuildChain\'s signing wallet is not configured' })
      const client = await getConnectedClient()
      try { hash = (await countersignAndSubmit(client, Wallet.fromSeed(seed), result.hex)).hash } finally { await client.disconnect() }
    }

    if (r.kind === 'deposit' || r.kind === 'escrow_cancel') {
      // The lender's wallet submitted it: make sure the ledger accepted it.
      if (!hash) return close('failed', { error: 'The wallet did not return a transaction hash' })
      const client = await getConnectedClient()
      let outcome: string | null
      try { outcome = await validatedResult(client, hash) } finally { await client.disconnect() }
      if (outcome === null) {
        // Not validated yet: give the claim back so the next check can look again.
        await admin.from('settlement_requests').update({ completed_at: null }).eq('id', r.id).eq('state', 'waiting')
        return NextResponse.json({ state: 'waiting' })
      }
      if (outcome !== 'tesSUCCESS') return close('failed', { txn_hash: hash, error: `The ledger refused it: ${outcome}` })
    }

    if (r.draw_request_id && r.kind === 'withdraw_release') {
      await admin.from('draw_signatures').delete().eq('draw_request_id', r.draw_request_id)
      await admin.from('draw_requests').update({
        status: 'submitted', settlement_state: null, release_ticket: null, approved_by: null,
      }).eq('id', r.draw_request_id).eq('settlement_state', 'locked')
    }
    if (r.draw_request_id && r.kind === 'escrow_cancel') {
      await admin.from('draw_requests').update({
        status: 'declined', settlement_state: null, decline_reason: 'The lender took back the escrow after its deadline passed.',
      }).eq('id', r.draw_request_id).eq('settlement_state', 'locked')
    }
    await supabase.from('activity_log').insert({
      project_id: r.project_id, action: `funding_${r.kind}`, entity_type: 'project', entity_id: r.project_id,
      details: { amount: r.amount, txn_hash: hash, draw_request_id: r.draw_request_id },
    })
    return close('done', { txn_hash: hash })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Ledger error'
    // The ledger refusing the transaction is final. Anything else (no answer
    // from the wallet service or the ledger) is not: release the claim and
    // let the next check try again, so a success is never recorded as a failure.
    if (/^te[cfm][A-Z_]|: te[cfm][A-Z_]/.test(message)) return close('failed', { error: message.slice(0, 300) })
    await admin.from('settlement_requests').update({ completed_at: null }).eq('id', r.id).eq('state', 'waiting')
    console.warn('[funding] could not finish yet:', message.slice(0, 200))
    return NextResponse.json({ state: 'waiting' })
  }
}
