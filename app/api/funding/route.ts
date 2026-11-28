import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase/service'
import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { Wallet, xrpToDrops } from 'xrpl'
import { COMMITTED_STATUSES, loanCommitments } from '@/lib/loan-commitments'
import { createSignRequest, getSignResult, isXamanConfigured } from '@/lib/xaman'
import { getConnectedClient } from '@/lib/xrpl/client'
import { isTokenMethod, settlementToken } from '@/lib/xrpl/release'
import {
  buildAddSlots, buildDeposit, buildEscrowCancel, buildRefundPayment, buildVoidTicket, countersignAndSubmit,
  loanTickets, submitAndConfirm, tokenBalance, usdValue, validatedResult, verifyLenderSigned,
} from '@/lib/xrpl/settlement'

// A lender's funding desk: what sits where on the ledger, and the things a
// lender signs outside a draw approval.
//   GET                 the lender's loans with live ledger balances
//   GET ?request=<id>   has the lender signed that request? If so, finish it
//   POST                open a request: { projectId, kind, amount?, paymentId? }
//
// kinds:  deposit           money into a two-signature loan account
//         refund            money back out of it (never money committed to approved payments)
//         escrow_cancel     take back one payee's escrow once its deadline has passed
//         withdraw_release  cancel one payee's release the lender already signed
//         add_slots         more release slots on a two-signature loan account
//
// Each payee on a draw is its own payment (draw_payments), so a take-back or a
// withdrawal is per payment. The caller's session decides what they may see;
// every write uses the service key.
export const runtime = 'nodejs'
export const maxDuration = 60
export const dynamic = 'force-dynamic'

const RIPPLE_EPOCH = 946684800
const dollars = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)

/* eslint-disable @typescript-eslint/no-explicit-any */

async function session(): Promise<{ supabase: any; userId: string; role: string } | NextResponse> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  const role = (profile as any)?.role
  if (!['admin', 'lender'].includes(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return { supabase, userId: user.id, role }
}

const PROJECT_SELECT = `
  id, name, loan_number, loan_amount, amount_drawn, settlement_method, loan_account,
  lenders ( xrp_address, company_name, profile_id ),
  draw_requests ( id, request_number, status, settlement_method, settlement_state )
`
// Signed for (or being signed for) and not yet paid: this money is committed.
// A release the ledger refused, or one being paid this minute, counts too.
const HELD_BY_LENDER = COMMITTED_STATUSES

export async function GET(req: NextRequest) {
  const s = await session()
  if (s instanceof NextResponse) return s
  const { supabase } = s
  const requestId = req.nextUrl.searchParams.get('request')
  if (requestId) return finish(supabase, requestId)

  // Row-level security limits a lender to their own projects and their payments.
  const { data: projects, error } = await supabase.from('projects').select(PROJECT_SELECT).is('archived_at', null).order('name')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const ids = (projects ?? []).map((p: any) => p.id)
  const { data: pays } = ids.length
    ? await supabase.from('draw_payments').select('*').in('project_id', ids).in('status', ['locked', 'awaiting_signature', 'held', 'failed', 'releasing']).order('seq')
    : { data: [] }
  const tokenReady = !!process.env.SETTLEMENT_TOKEN_ISSUER
  // Slots already promised to payments signed, or being signed, on a loan.
  const mineBusy = (projectId: string) => ((pays ?? []) as any[])
    .filter(x => x.project_id === projectId && x.release_ticket != null && HELD_BY_LENDER.includes(x.status)).length

  const loans: any[] = (projects ?? []).map((p: any) => {
    const mine = ((pays ?? []) as any[]).filter(x => x.project_id === p.id)
    const number = (drawId: string) => (p.draw_requests ?? []).find((d: any) => d.id === drawId)?.request_number ?? ''
    return {
      id: p.id, name: p.name, loanNumber: p.loan_number, loanAmount: Number(p.loan_amount), amountDrawn: Number(p.amount_drawn ?? 0),
      method: p.settlement_method ?? 'test_xrp', loanAccount: p.loan_account ?? null,
      lenderWallet: p.lenders?.xrp_address ?? null,
      // One line per payee the lender has signed for (or is signing for).
      locked: mine.filter(x => ['locked', 'failed', 'releasing'].includes(x.status)).map(x => ({
        releaseFailed: x.status === 'failed',
        releasing: x.status === 'releasing',
        paymentId: x.id, drawId: x.draw_request_id, requestNumber: number(x.draw_request_id), payee: x.payee_name,
        wallet: x.wallet, amount: Number(x.amount), method: p.settlement_method, cancelAfter: null as string | null,
        _owner: x.escrow_owner, _seq: x.escrow_sequence,
      })),
      // Payees that could not be signed for, so the lender knows who is still unpaid.
      held: mine.filter(x => x.status === 'held').map(x => ({
        paymentId: x.id, requestNumber: number(x.draw_request_id), payee: x.payee_name, amount: Number(x.amount),
        reason: x.held_reason ?? 'This payee cannot be paid yet',
      })),
      lockedTotal: mine.filter(x => HELD_BY_LENDER.includes(x.status)).reduce((t, x) => t + Number(x.amount), 0),
      walletBalance: null as string | null, loanAccountBalance: null as string | null,
      // two_signature: release slots left on the loan account (each payment uses one)
      slotsFree: null as number | null,
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
          if (loan.loanAccount) {
            loan.loanAccountBalance = await tokenBalance(client, loan.loanAccount, token)
            loan.slotsFree = Math.max(0, (await loanTickets(client, loan.loanAccount)).length - mineBusy(loan.id))
          }
          for (const line of loan.locked) {
            if (loan.method !== 'token_escrow' || !line._owner || line._seq == null) continue
            try {
              const entry = await client.request({ command: 'ledger_entry', escrow: { owner: line._owner, seq: line._seq }, ledger_index: 'validated' })
              const after = Number((entry.result.node as unknown as { CancelAfter?: number }).CancelAfter ?? 0)
              if (after) line.cancelAfter = new Date((after + RIPPLE_EPOCH) * 1000).toISOString()
            } catch { /* escrow no longer on the ledger */ }
          }
        }
      } finally { await client.disconnect() }
    } catch { /* balances stay null; the screen says they are unavailable */ }
  }
  for (const loan of loans) for (const line of loan.locked) { delete line._owner; delete line._seq }

  const { data: requests } = await supabase.from('settlement_requests')
    .select('id, project_id, kind, amount, state, txn_hash, error, created_at').order('created_at', { ascending: false }).limit(20)
  return NextResponse.json({ loans, requests: requests ?? [], walletSigning: isXamanConfigured(), tokenReady })
}

export async function POST(req: NextRequest) {
  const s = await session()
  if (s instanceof NextResponse) return s
  const { supabase, userId, role } = s
  const body = await req.json().catch(() => ({}))
  const kind = String(body?.kind ?? '')
  if (!['deposit', 'refund', 'escrow_cancel', 'withdraw_release', 'add_slots'].includes(kind)) {
    return NextResponse.json({ error: 'Unknown request' }, { status: 400 })
  }
  if (!isXamanConfigured()) return NextResponse.json({ error: 'Wallet signing is not set up on this site yet (Xaman keys are missing)' }, { status: 503 })
  // A person opens a handful of these in a day; a script should not open hundreds.
  const { count: recent } = await supabase.from('settlement_requests').select('id', { count: 'exact', head: true })
    .eq('requested_by', userId).gte('created_at', new Date(Date.now() - 60 * 60 * 1000).toISOString())
  if ((recent ?? 0) >= 40) return NextResponse.json({ error: 'Too many requests in the last hour. Try again later.' }, { status: 429 })

  const { data: project } = await supabase.from('projects').select(PROJECT_SELECT).eq('id', String(body?.projectId ?? '')).single()
  if (!project) return NextResponse.json({ error: 'Loan not found' }, { status: 404 })
  // Only this loan's own lender (or an admin) moves its money.
  if (role !== 'admin' && project.lenders?.profile_id !== userId) {
    return NextResponse.json({ error: 'Only this loan\'s lender can do this' }, { status: 403 })
  }
  const lender = project.lenders?.xrp_address
  if (!lender) return NextResponse.json({ error: 'Connect the lender\'s wallet first' }, { status: 409 })
  if (!isTokenMethod(project.settlement_method)) return NextResponse.json({ error: 'This loan is on the pilot method; there is nothing to fund' }, { status: 409 })

  const admin = serviceClient()
  try {
    const token = settlementToken()
    const { data: lenderLink } = await admin.from('lender_wallet_links').select('user_token')
      .eq('lender_id', (await admin.from('projects').select('lender_id').eq('id', project.id).single()).data?.lender_id).maybeSingle()
    // Money and slots already promised on this loan (payments signed or being
    // signed, and funding requests still waiting on a signature).
    const busy = await loanCommitments(admin, project.id)
    let payment: any = null
    if (body?.paymentId) {
      const { data } = await admin.from('draw_payments').select('*').eq('id', String(body.paymentId)).eq('project_id', project.id).maybeSingle()
      payment = data
    }
    let txjson: Record<string, unknown>
    let multisign = false
    let amount: number | null = null
    let instruction = ''

    const client = await getConnectedClient()
    try {
      // Tickets already promised: payments signed or being signed, and requests still waiting on a signature.
      const freeTicket = async () => {
        const used = new Set<number>(busy.tickets)
        const t = (await loanTickets(client, project.loan_account)).find(x => !used.has(x))
        if (t === undefined) throw new Error('The loan account has no free slots left')
        return t
      }

      if (kind === 'add_slots') {
        if (project.settlement_method !== 'two_signature' || !project.loan_account) throw new Error('This loan has no two-signature account')
        // Counted the same way the funding desk shows it: slots on the ledger,
        // less those already promised to payments signed or being signed.
        const onLedger = await loanTickets(client, project.loan_account)
        const promised = new Set(busy.tickets)
        const free = onLedger.filter(t => !promised.has(t)).length
        if (free > 40) throw new Error(`This loan still has ${free} release slots; more can be added when 40 or fewer are left`)
        // One at a time: two open requests would both be valid and add twice.
        const { count: open } = await admin.from('settlement_requests').select('id', { count: 'exact', head: true })
          .eq('project_id', project.id).eq('kind', 'add_slots').eq('state', 'waiting')
        if (open) throw new Error('A request to add slots is already waiting for your signature. Sign or let it expire first.')
        // Nothing is spent here. The small XRP the new slots tie up is sent
        // only after the lender has signed (see finish).
        txjson = await buildAddSlots(client, { loanAccount: project.loan_account, count: 50 })
        multisign = true
        instruction = `Add 50 release slots to the loan account for ${project.name}. This moves no money; each payment to a payee uses one slot.`
      } else if (kind === 'deposit' || kind === 'refund') {
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
          const committed = busy.committedUsd
          if (amount > bal - committed) {
            throw new Error(`Only ${dollars(Math.max(0, bal - committed))} is free to take back: ${dollars(committed)} is committed to approved payments`)
          }
          txjson = buildRefundPayment({ loanAccount: project.loan_account, lender, token, usd: amount, ticketSequence: await freeTicket() })
          multisign = true
          instruction = `Take ${dollars(amount)} back from the loan account for ${project.name} to your wallet.`
        }
      } else {
        if (!payment || !['locked', 'failed'].includes(payment.status)) throw new Error('That payment is not locked')
        const number = (project.draw_requests ?? []).find((d: any) => d.id === payment.draw_request_id)?.request_number ?? ''
        if (kind === 'escrow_cancel') {
          if (project.settlement_method !== 'token_escrow' || payment.escrow_sequence == null) throw new Error('That payment has no escrow')
          const entry = await client.request({ command: 'ledger_entry', escrow: { owner: payment.escrow_owner, seq: payment.escrow_sequence }, ledger_index: 'validated' })
          const after = Number((entry.result.node as unknown as { CancelAfter?: number }).CancelAfter ?? 0)
          const when = new Date((after + RIPPLE_EPOCH) * 1000)
          if (when.getTime() > Date.now()) {
            throw new Error(`This escrow can be taken back on or after ${when.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}. The ledger enforces that date.`)
          }
          txjson = buildEscrowCancel({ lender, sequence: payment.escrow_sequence })
          instruction = `Take back the escrow for ${payment.payee_name} on Draw ${number}, ${project.name}: ${dollars(Number(payment.amount))} returns to your wallet.`
        } else {
          if (project.settlement_method !== 'two_signature' || payment.release_ticket == null) throw new Error('That payment has no signed release')
          txjson = buildVoidTicket({ loanAccount: project.loan_account, ticketSequence: Number(payment.release_ticket), drawRequestId: payment.draw_request_id })
          multisign = true
          instruction = `Withdraw your approval of ${dollars(Number(payment.amount))} for ${payment.payee_name} on Draw ${number}, ${project.name}. The money stays in the loan account and your earlier signature can never be used.`
        }
        amount = Number(payment.amount)
      }
    } finally { await client.disconnect() }

    const request = await createSignRequest({
      txjson, submit: !multisign, multisign, instruction,
      identifier: `${kind}-${project.id}`.slice(0, 40), userToken: lenderLink?.user_token ?? null,
    })
    const { data: row, error } = await admin.from('settlement_requests').insert({
      project_id: project.id, draw_request_id: payment?.draw_request_id ?? null, kind, amount,
      txjson, payload: request.uuid, requested_by: userId, payment_id: payment?.id ?? null,
    }).select('id').single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ requestId: row.id, qrPng: request.qrPng, url: request.url, pushed: request.pushed, instruction })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message.slice(0, 300) : 'Ledger error' }, { status: 409 })
  }
}

/**
 * After a payment is taken back or withdrawn: if nothing on its draw is still
 * signed for, the draw goes back to "awaiting review" with a clean slate, so
 * the lender can decline it or approve it again.
 */
async function settleDrawAfterTakeBack(admin: any, drawId: string, how: 'withdrawn' | 'taken_back') {
  const { data: left } = await admin.from('draw_payments').select('id, status, amount').eq('draw_request_id', drawId)
  const rows: any[] = left ?? []
  const stillSigned = rows.filter(r => ['locked', 'failed', 'releasing', 'released'].includes(r.status))
  if (stillSigned.length || rows.some(r => r.status === 'awaiting_signature')) {
    // Other payees are still signed for: the draw stands, for less money.
    const { data: d } = await admin.from('draw_requests').update({
      settlement_amount: Math.round(stillSigned.reduce((t, r) => t + Number(r.amount), 0) * 100) / 100,
    }).eq('id', drawId).in('status', ['submitted', 'pending', 'approved', 'held']).select('status')
    // If it is approved and this was the last payee holding it up, release now.
    if (d?.[0]?.status === 'approved') {
      waitUntil((async () => {
        try { const { checkConditions } = await import('@/lib/xrpl/conditions'); await checkConditions(admin, drawId) }
        catch (err) { console.warn('[funding] release check after a take-back failed:', err instanceof Error ? err.message : err) }
      })())
    }
    return
  }
  if (how === 'withdrawn') {
    // Nothing is signed for any more: back to review with a clean slate.
    const { data: back } = await admin.from('draw_requests')
      .update({ status: 'submitted', settlement_state: null, settlement_amount: null, approved_by: null })
      .eq('id', drawId).in('status', ['submitted', 'pending', 'approved', 'held']).select('id')
    if (back?.length) await admin.from('draw_payments').delete().eq('draw_request_id', drawId).in('status', ['pending', 'held', 'withdrawn'])
  } else {
    await admin.from('draw_requests')
      .update({ status: 'declined', settlement_state: null, settlement_amount: null, decline_reason: 'The lender took back the escrow after its deadline passed.' })
      .eq('id', drawId).in('status', ['submitted', 'pending', 'approved', 'held'])
  }
}

async function finish(supabase: any, requestId: string) {
  const { data: r } = await supabase.from('settlement_requests')
    .select('*, projects ( id, loan_account, lenders ( xrp_address ) )').eq('id', requestId).single()
  if (!r) return NextResponse.json({ error: 'Request not found' }, { status: 404 })
  const paymentId: string | null = r.payment_id ?? null
  if (r.state !== 'waiting') return NextResponse.json({ state: r.state, txnHash: r.txn_hash, error: r.error })
  // The caller could read this request, so it is on one of their projects.
  // Its state, and the payment's, are written with the service key.
  const admin = serviceClient()

  const close = async (state: string, extra: Record<string, unknown> = {}) => {
    await admin.from('settlement_requests').update({ state, completed_at: new Date().toISOString(), ...extra }).eq('id', r.id).eq('state', 'waiting')
    return NextResponse.json({ state, ...('txn_hash' in extra ? { txnHash: extra.txn_hash } : {}), ...('error' in extra ? { error: extra.error } : {}) })
  }
  const unclaim = async () => {
    await admin.from('settlement_requests').update({ completed_at: null }).eq('id', r.id).eq('state', 'waiting')
    return NextResponse.json({ state: 'waiting' })
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
    if (r.kind === 'refund' || r.kind === 'withdraw_release' || r.kind === 'add_slots') {
      if (!result.hex) return close('failed', { error: 'The wallet did not return the signed transaction' })
      const problems = verifyLenderSigned(result.hex, r.txjson, lender)
      if (problems.length) return close('failed', { error: `The signature does not match the request: ${problems.join('; ')}` })
      if (r.kind === 'withdraw_release' && paymentId) {
        // Not while it is being paid (or after): the release wins.
        const { data: p } = await admin.from('draw_payments').select('status').eq('id', paymentId).maybeSingle()
        if (!p || !['locked', 'failed'].includes(p.status)) {
          return close('failed', { error: 'This payment is being paid or is no longer signed for, so the approval was not withdrawn.' })
        }
      }
      const client = await getConnectedClient()
      try {
        if (r.kind === 'refund') {
          // Payments may have been approved since this refund was opened:
          // money committed to them cannot leave the loan account.
          const committed = (await loanCommitments(admin, r.project_id)).committedUsd
          const balance = Number(await tokenBalance(client, r.projects?.loan_account, settlementToken()) ?? 0)
          if (Number(r.amount) > balance - committed) {
            return close('failed', { error: `Not sent: ${dollars(committed)} is now committed to approved payments, which leaves ${dollars(Math.max(0, balance - committed))} free.` })
          }
        }
        const seed = process.env.XRPL_WALLET_SEED
        if (!seed) return close('failed', { error: 'BuildChain\'s signing wallet is not configured' })
        if (r.kind === 'add_slots') {
          // Each slot ties up a little XRP on the loan account. BuildChain
          // covers exactly what is missing, and only now that the lender has
          // signed. Working it out from the account's own balance means a
          // second try never pays twice.
          const loanAccount = r.projects?.loan_account
          const info = await client.request({ command: 'account_info', account: loanAccount, ledger_index: 'validated' })
          const acct = (info.result as unknown as { account_data: { Balance: string; OwnerCount: number } }).account_data
          const server = await client.request({ command: 'server_info' })
          const ledger = (server.result as unknown as { info: { validated_ledger?: { reserve_base_xrp?: number; reserve_inc_xrp?: number } } }).info.validated_ledger
          const base = Number(ledger?.reserve_base_xrp ?? 1), inc = Number(ledger?.reserve_inc_xrp ?? 0.2)
          const adding = Number((r.txjson as any)?.TicketCount ?? 50)
          const needed = base + inc * (Number(acct.OwnerCount) + adding) + 1 - Number(acct.Balance) / 1_000_000
          if (needed > 0) {
            if (needed > 50) return close('failed', { error: 'The loan account needs more XRP for new slots than BuildChain tops up automatically. Nothing was changed.' })
            const platform = Wallet.fromSeed(seed)
            const topUp: any = await client.autofill({
              TransactionType: 'Payment', Account: platform.address, Destination: loanAccount,
              Amount: xrpToDrops(needed.toFixed(6)),
            })
            await submitAndConfirm(client, platform.sign(topUp).tx_blob)
          }
        }
        hash = (await countersignAndSubmit(client, Wallet.fromSeed(seed), result.hex)).hash
      } finally { await client.disconnect() }
    }

    if (r.kind === 'deposit' || r.kind === 'escrow_cancel') {
      // The lender's wallet submitted it: make sure the ledger accepted it.
      if (!hash) return close('failed', { error: 'The wallet did not return a transaction hash' })
      const client = await getConnectedClient()
      let outcome: string | null
      try { outcome = await validatedResult(client, hash) } finally { await client.disconnect() }
      if (outcome === null) return unclaim()   // not validated yet: let the next check look again
      if (outcome !== 'tesSUCCESS') return close('failed', { txn_hash: hash, error: `The ledger refused it: ${outcome}` })
    }

    if (paymentId && (r.kind === 'withdraw_release' || r.kind === 'escrow_cancel')) {
      // The payment is no longer signed for. Its row stays, marked withdrawn,
      // so the record (and Building Block) still shows this payee as unpaid.
      await admin.from('draw_payments').update({
        status: 'withdrawn', release_ticket: null, updated_at: new Date().toISOString(),
        held_reason: r.kind === 'withdraw_release' ? 'The lender withdrew approval for this payee' : 'The lender took this escrow back after its deadline',
      }).eq('id', paymentId).in('status', ['locked', 'failed', 'releasing', 'pending'])
      await admin.from('payment_signatures').delete().eq('payment_id', paymentId)
      if (r.draw_request_id) await settleDrawAfterTakeBack(admin, r.draw_request_id, r.kind === 'withdraw_release' ? 'withdrawn' : 'taken_back')
    }
    await admin.from('activity_log').insert({
      project_id: r.project_id, action: `funding_${r.kind}`, entity_type: 'project', entity_id: r.project_id,
      details: { amount: r.amount, txn_hash: hash, draw_request_id: r.draw_request_id, payment_id: paymentId },
    })
    return close('done', { txn_hash: hash })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Ledger error'
    // The ledger refusing the transaction is final. Anything else (no answer
    // from the wallet service or the ledger) is not: release the claim and
    // let the next check try again, so a success is never recorded as a failure.
    if (/^te[cfm][A-Z_]|: te[cfm][A-Z_]/.test(message)) return close('failed', { error: message.slice(0, 300) })
    console.warn('[funding] could not finish yet:', message.slice(0, 200))
    return unclaim()
  }
}
