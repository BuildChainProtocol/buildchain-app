import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase/service'
import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { isValidClassicAddress } from 'xrpl'
import { cancelSignRequest, createSignRequest, getSignResult, isXamanConfigured } from '@/lib/xaman'
import { loanCommitments } from '@/lib/loan-commitments'
import {
  confirmLenderSigning, isTokenMethod, PayeeNotReady, prepareLenderSigning, SigningMismatch,
} from '@/lib/xrpl/release'

// The lender approves a dollar-token draw by signing it in their own wallet:
// one signature per payee, because each payee is paid by its own ledger
// transaction. After the first signature Xaman sends the rest straight to the
// lender's phone, so it is a few approvals in a row, not a QR code each.
//
//   POST  set up the draw's payments if needed and open the next sign request
//   GET   has the lender signed the open request? If so, check it, lock that
//         payment and open the next; when none are left, the draw is locked
//
// A project on the pilot method (test_xrp) needs no signature: POST says so.
//
// The caller's own session decides whether they may act on the draw. Writes
// use the service key: the database refuses them from a signed-in user, and
// sign request ids and signatures are kept where no user can read them.
//
// Two rules keep overlapping calls (two tabs, a double click, the panel's own
// polling) from ever putting two live requests in front of the lender for one
// payment, which on an escrow would lock the money twice:
//   1. A payment is CLAIMED (pending -> awaiting_signature, one winner) before
//      any request is created for it.
//   2. Only one payment of a draw is out for signature at a time.
export const runtime = 'nodejs'
export const maxDuration = 60

const DRAW_SELECT = `
  id, status, amount, net_amount, request_number, project_id, gc_wallet, payees,
  settlement_method, settlement_state, settlement_amount,
  projects ( name, settlement_method, loan_account,
    lenders ( id, xrp_address, company_name, profile_id ),
    borrowers ( xrp_address, company_name ) )
`
const cents = (n: unknown) => Math.round(Number(n) * 100)
const usd = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
const now = () => new Date().toISOString()
// Signed for and not yet paid, or paid: these make up what the draw settles.
const SIGNED = ['locked', 'releasing', 'failed', 'released']
// A draw can be signed while it awaits review, and, for payees left over
// (held, or needing a new signature), while it is approved and not yet paid.
const SIGNABLE_DRAW = ['submitted', 'pending', 'approved']

/* eslint-disable @typescript-eslint/no-explicit-any */

type Open = { paymentId: string; qrPng: string | null; url: string | null; pushed: boolean; cancelAfter: string | null }

async function load(id: string): Promise<{ admin: any; draw: any } | NextResponse> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !['admin', 'lender'].includes((profile as any).role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  // Row-level security limits a lender to draws on their own projects.
  const { data: draw, error } = await supabase.from('draw_requests').select(DRAW_SELECT).eq('id', id).single()
  if (error || !draw) return NextResponse.json({ error: 'Draw not found' }, { status: 404 })
  // Being able to read the draw is not enough (its borrower can too): only an
  // admin or this project's own lender approves it.
  if ((profile as any).role !== 'admin' && (draw as any).projects?.lenders?.profile_id !== user.id) {
    return NextResponse.json({ error: 'Only this loan\'s lender can approve its draws' }, { status: 403 })
  }
  return { admin: serviceClient(), draw }
}

async function payments(admin: any, drawId: string): Promise<any[]> {
  const { data } = await admin.from('draw_payments').select('*').eq('draw_request_id', drawId).order('seq')
  return data ?? []
}

/** Who this draw pays: Building Block's payee list, or the contractor alone. */
function planPayees(draw: any) {
  const net = Number(draw.net_amount ?? draw.amount)
  const wallet = (w: unknown) => (typeof w === 'string' && isValidClassicAddress(w) ? w : null)
  const reason = (w: unknown) => (!w ? 'No wallet on file for this payee' : 'The wallet address on file for this payee is not a valid XRP Ledger address')
  const listed = (Array.isArray(draw.payees) ? draw.payees : []).filter((p: any) => Number(p?.amount) > 0)
  const rows = listed.length
    ? listed.map((p: any) => ({
        payee_name: String(p.sub_name ?? p.name ?? (p.sub_code ? `Subcontractor ${p.sub_code}` : 'General contractor')).slice(0, 200),
        sub_code: p.sub_code ?? null, bb_pay_app_id: p.bb_pay_app_id ?? null,
        raw: p.wallet, amount: Math.round(Number(p.amount) * 100) / 100,
      }))
    : [{
        payee_name: draw.projects?.borrowers?.company_name ?? 'General contractor',
        sub_code: null, bb_pay_app_id: null,
        raw: draw.gc_wallet ?? draw.projects?.borrowers?.xrp_address ?? null,
        amount: Math.round(net * 100) / 100,
      }]
  return rows.map((r: any) => {
    const w = wallet(r.raw)
    return {
      payee_name: r.payee_name, sub_code: r.sub_code, bb_pay_app_id: r.bb_pay_app_id, amount: r.amount,
      wallet: w, status: w ? 'pending' : 'held', held_reason: w ? null : reason(r.raw),
    }
  })
}

function view(draw: any, rows: any[], method: string) {
  const sum = (f: (r: any) => boolean) => rows.filter(f).reduce((t, r) => t + Number(r.amount), 0)
  const out = (r: any) => r.status === 'held' || r.status === 'withdrawn'
  return {
    payments: rows.map(r => ({
      id: r.id, name: r.payee_name, amount: Number(r.amount), wallet: r.wallet,
      // The screen knows: pending, awaiting_signature, locked, released, held, failed.
      status: r.status === 'releasing' ? 'locked' : r.status === 'withdrawn' ? 'held' : r.status,
      heldReason: r.status === 'withdrawn' ? 'You withdrew your approval for this payee' : r.held_reason ?? null,
    })),
    summary: {
      method, projectName: draw.projects?.name ?? null, requestNumber: draw.request_number,
      totalUsd: sum(() => true), payableUsd: sum(r => !out(r)), heldUsd: sum(out),
      signed: rows.filter(r => SIGNED.includes(r.status)).length,
      toSign: rows.filter(r => !out(r)).length,
    },
  }
}

/**
 * A payment's sign request is spent, refused or abandoned.
 *
 * Before approval it simply goes back to "waiting for the lender". On a draw
 * that is already approved, a payee still waiting would hold up everyone
 * else's release, so there it goes on hold instead (the lender can sign for
 * it later by opening the draw again) and the rest of the draw moves on.
 */
async function resetPayment(admin: any, payment: any, payload: string | null, draw: any, method: string, spent = false): Promise<boolean> {
  // The record is cleared only once the request can never be signed. `spent`
  // means the wallet service has already said so (rejected, expired, or
  // signed and found wrong). Otherwise it is withdrawn first, and if that
  // cannot be confirmed (it is open on the phone, was just signed, or the
  // service did not answer) the payment stays exactly as it is. Clearing it
  // anyway is how money gets locked twice, or locked with no record.
  if (!spent && payload && !(await cancelSignRequest(payload))) return false
  const approved = draw.status === 'approved'
  const { data: cleared } = await admin.from('draw_payments')
    .update({
      status: approved ? 'held' : 'pending', release_ticket: null, updated_at: now(),
      held_reason: approved ? 'Not signed for yet. Open this draw to sign for this payee.' : null,
    })
    .eq('id', payment.id).eq('status', 'awaiting_signature').select('id')
  if (cleared?.length) {
    await admin.from('payment_signatures').delete().eq('payment_id', payment.id)
    if (approved) { try { await finalize(admin, draw, method) } catch { /* reported when the lender next opens the draw */ } }
  }
  return true
}

// A sign request lives 30 minutes. A payment claimed with no request on file
// (the call that claimed it died before saving one) is left alone for longer
// than that, so a request nobody can see can no longer be signed.
const ORPHAN_CLAIM_MS = 31 * 60 * 1000

/** The request already out for a payment, to show again. Null while its request is still being created. */
async function showOpen(admin: any, payment: any): Promise<Open | null> {
  const { data: sig } = await admin.from('payment_signatures').select('qr_png, open_url').eq('payment_id', payment.id).maybeSingle()
  if (!sig?.qr_png) return null
  return { paymentId: payment.id, qrPng: sig.qr_png, url: sig.open_url, pushed: false, cancelAfter: null }
}

/**
 * Open the sign request for the next payee still waiting. Returns the open
 * request; 'busy' when another call is in the middle of opening one; or null
 * when nothing is left to sign. A payee whose wallet cannot receive the token
 * is put on hold and skipped, not treated as a failure.
 */
async function openNext(admin: any, draw: any, method: 'token_escrow' | 'two_signature', lenderWallet: string): Promise<Open | 'busy' | null> {
  const { data: link } = await admin.from('lender_wallet_links').select('user_token').eq('lender_id', draw.projects?.lenders?.id).maybeSingle()

  for (let guard = 0; guard < 50; guard++) {
    const rows = await payments(admin, draw.id)
    // Rule 2: one payment of a draw out for signature at a time.
    const out = rows.find(r => r.status === 'awaiting_signature')
    if (out) return (await showOpen(admin, out)) ?? 'busy'
    const next = rows.find(r => r.status === 'pending')
    if (!next) return null

    // Rule 1: claim it before creating anything. One caller wins.
    const { data: claimed } = await admin.from('draw_payments')
      .update({ status: 'awaiting_signature', updated_at: now() })
      .eq('id', next.id).eq('status', 'pending').select('id')
    if (!claimed?.length) continue
    const release = async (to: 'pending' | 'held', heldReason?: string) => {
      await admin.from('draw_payments').update({ status: to, held_reason: heldReason ?? null, release_ticket: null, updated_at: now() })
        .eq('id', next.id).eq('status', 'awaiting_signature')
    }

    let request: Awaited<ReturnType<typeof createSignRequest>> | null = null
    try {
      // Money and slots already promised on this loan, by this draw or others.
      const busy = await loanCommitments(admin, draw.project_id, next.id)
      let plan
      try {
        plan = await prepareLenderSigning({
          method, drawRequestId: draw.id, paymentId: next.id, amountUsd: Number(next.amount),
          lenderWallet, payee: next.wallet, loanAccount: draw.projects?.loan_account,
          ticketsInUse: busy.tickets, committedUsd: busy.committedUsd,
        })
      } catch (err) {
        if (err instanceof PayeeNotReady) { await release('held', err.message); continue }
        throw err
      }

      const payable = rows.filter(r => r.status !== 'held' && r.status !== 'withdrawn')
      const position = payable.findIndex(r => r.id === next.id) + 1
      request = await createSignRequest({
        txjson: plan.txjson,
        submit: !plan.multisign,
        multisign: plan.multisign,
        userToken: link?.user_token ?? null,
        identifier: `pay-${next.id}`.slice(0, 40),
        instruction: `Draw ${draw.request_number}, ${draw.projects?.name}: ${plan.multisign ? 'authorize' : 'lock'} ${usd(Number(next.amount))} for ${next.payee_name}` +
          (payable.length > 1 ? ` (${position} of ${payable.length})` : '') + '. Paid only after inspection and lien waiver are both recorded.',
      })
      const { error: sigErr } = await admin.from('payment_signatures').upsert({
        payment_id: next.id, payload: request.uuid, qr_png: request.qrPng, open_url: request.url,
        txjson: plan.txjson, signed_blob: null, updated_at: now(),
      }, { onConflict: 'payment_id' })
      if (sigErr) throw new Error(sigErr.message)
      // Still ours? (A status check may have given up on this claim meanwhile.)
      const { data: kept } = await admin.from('draw_payments')
        .update({ release_ticket: plan.releaseTicket, updated_at: now() })
        .eq('id', next.id).eq('status', 'awaiting_signature').select('id')
      if (!kept?.length) {
        await cancelSignRequest(request.uuid)
        await admin.from('payment_signatures').delete().eq('payment_id', next.id).eq('payload', request.uuid)
        continue
      }
      return { paymentId: next.id, qrPng: request.qrPng, url: request.url, pushed: request.pushed, cancelAfter: plan.cancelAfter }
    } catch (err) {
      // Nothing is left half-open: withdraw the request and hand the payment
      // back. If the request cannot be withdrawn it could still be signed, so
      // the payment stays claimed until that request has expired.
      if (await cancelSignRequest(request?.uuid)) {
        await admin.from('payment_signatures').delete().eq('payment_id', next.id)
        await release('pending')
      }
      throw err
    }
  }
  return null
}

/**
 * Every payee that can be paid is signed for: the draw is locked, for the
 * total actually signed. Returns false while anything is still to sign.
 */
async function finalize(admin: any, draw: any, method: string): Promise<boolean> {
  const rows = await payments(admin, draw.id)
  if (rows.some(r => r.status === 'pending' || r.status === 'awaiting_signature')) return false
  const signed = rows.filter(r => SIGNED.includes(r.status))
  if (!signed.length) return false
  // Every payee on the draw must be on the list, paid or not, before it is
  // locked: a payee missing from it would be missing from every report.
  const net = Number(draw.net_amount ?? draw.amount)
  const listed = rows.reduce((t, r) => t + Number(r.amount), 0)
  if (cents(listed) !== cents(net)) {
    throw new Error(`This draw's payment list adds up to ${usd(listed)}, not its net amount of ${usd(net)}, so it was not locked. Close this and open the draw again; if it repeats, contact BuildChain.`)
  }
  await admin.from('draw_requests').update({
    settlement_method: method, settlement_state: 'locked',
    settlement_amount: signed.reduce((t, r) => t + Number(r.amount), 0),
  }).eq('id', draw.id).in('status', SIGNABLE_DRAW).neq('settlement_state', 'released')
  // A draw that was already approved (a payee signed for afterwards) has
  // nobody left to press Approve: try the release now.
  if (draw.status === 'approved') {
    waitUntil((async () => {
      try { const { checkConditions } = await import('@/lib/xrpl/conditions'); await checkConditions(admin, draw.id) }
      catch (err) { console.warn('[sign] release check after a late signature failed:', err instanceof Error ? err.message : err) }
    })())
  }
  return true
}

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const loaded = await load(params.id)
  if (loaded instanceof NextResponse) return loaded
  const { admin, draw } = loaded

  const method = draw.projects?.settlement_method ?? 'test_xrp'
  if (!isTokenMethod(method)) return NextResponse.json({ method: 'test_xrp', signatureNeeded: false })

  let rows = await payments(admin, draw.id)
  const leftToSign = rows.some(r => r.status === 'pending' || r.status === 'awaiting_signature' || (r.status === 'held' && r.wallet))
  if (draw.settlement_state === 'locked' && !leftToSign) {
    return NextResponse.json({ method, signatureNeeded: false, state: 'locked', ...view(draw, rows, method) })
  }
  if (!SIGNABLE_DRAW.includes(draw.status)) {
    return NextResponse.json({ error: `This draw is ${draw.status}; it can no longer be signed`, ...view(draw, rows, method) }, { status: 409 })
  }
  if (draw.status === 'approved' && !rows.length) {
    return NextResponse.json({ error: 'This draw was approved without a signature and has nothing to sign' }, { status: 409 })
  }
  if (!isXamanConfigured()) {
    return NextResponse.json({ error: 'Wallet signing is not set up on this site yet (Xaman keys are missing)' }, { status: 503 })
  }
  const lenderWallet = draw.projects?.lenders?.xrp_address
  if (!lenderWallet) {
    return NextResponse.json({ error: 'Connect the lender\'s wallet first', code: 'no_lender_wallet' }, { status: 409 })
  }

  try {
    // Write down who this draw pays. Until the lender has started signing,
    // the list is rebuilt each time, so it always matches the draw as it
    // stands now (its amounts or payees may have changed since last time).
    const started = rows.some(r => r.status !== 'pending' && r.status !== 'held')
    if (!started) {
      const planned = planPayees(draw)
      const net = Number(draw.net_amount ?? draw.amount)
      const total = planned.reduce((t: number, p: any) => t + p.amount, 0)
      if (cents(total) !== cents(net)) {
        return NextResponse.json({ error: `The payees on this draw add up to ${usd(total)}, not its net amount of ${usd(net)}. It cannot be signed until they agree.` }, { status: 409 })
      }
      // Marking the draw as "being signed" first closes its line items to
      // changes; the payment list is then written against a draw that no
      // longer moves. Only a draw still awaiting review can start.
      if (!['submitted', 'pending'].includes(draw.status)) {
        return NextResponse.json({ error: `This draw is ${draw.status}; it can no longer be signed` }, { status: 409 })
      }
      const { data: marked } = await admin.from('draw_requests').update({
        settlement_method: method, settlement_state: 'awaiting_lender_signature', settlement_amount: null,
      }).eq('id', draw.id).in('status', ['submitted', 'pending']).select('id')
      if (!marked?.length) return NextResponse.json({ error: 'This draw changed while you were opening it. Reload and try again.' }, { status: 409 })
      await admin.from('draw_payments').delete().eq('draw_request_id', draw.id).in('status', ['pending', 'held'])
      // Two calls at once build the same list; neither may fail or leave a
      // gap, so a row the other call already wrote is kept, not an error.
      const { error: insErr } = await admin.from('draw_payments').upsert(planned.map((p: any, i: number) => ({
        draw_request_id: draw.id, project_id: draw.project_id, seq: i + 1, ...p,
      })), { onConflict: 'draw_request_id,seq', ignoreDuplicates: true })
      if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })
    } else {
      // A payee held because the wallet could not receive the token gets
      // another look each time: its owner may have set the wallet up since.
      await admin.from('draw_payments').update({ status: 'pending', held_reason: null, updated_at: now() })
        .eq('draw_request_id', draw.id).eq('status', 'held').not('wallet', 'is', null)
    }
    rows = await payments(admin, draw.id)

    // A request already out: show it again, or let the status check confirm it.
    const open = rows.find(r => r.status === 'awaiting_signature')
    if (open) {
      const { data: sig } = await admin.from('payment_signatures').select('payload').eq('payment_id', open.id).maybeSingle()
      if (sig?.payload) {
        const state = await getSignResult(sig.payload)
        if (!state.resolved && !state.expired) {
          return NextResponse.json({ method, signatureNeeded: true, state: 'waiting', current: await showOpen(admin, open), ...view(draw, rows, method) })
        }
        // Already signed (the tab was closed, or confirming was interrupted):
        // never ask for a second signature. The status check confirms this one.
        if (state.resolved && state.signed) {
          return NextResponse.json({ method, signatureNeeded: true, state: 'checking', current: null, ...view(draw, rows, method) })
        }
        // Rejected or expired: the wallet service says it can never be signed.
        await resetPayment(admin, open, sig.payload, draw, method, true)
      } else if (Date.now() - new Date(open.updated_at).getTime() < ORPHAN_CLAIM_MS) {
        // Another call is opening this request right now (or died doing so).
        return NextResponse.json({ method, signatureNeeded: true, state: 'checking', current: null, ...view(draw, rows, method) })
      } else {
        await resetPayment(admin, open, null, draw, method, true)
      }
    }

    const current = await openNext(admin, draw, method, lenderWallet)
    rows = await payments(admin, draw.id)
    if (current === 'busy') {
      return NextResponse.json({ method, signatureNeeded: true, state: 'checking', current: null, ...view(draw, rows, method) })
    }
    if (!current) {
      if (await finalize(admin, draw, method)) {
        return NextResponse.json({ method, signatureNeeded: false, state: 'locked', ...view(draw, rows, method) })
      }
      // Nobody could be signed for: leave the draw as it was before signing.
      await admin.from('draw_requests').update({ settlement_state: null })
        .eq('id', draw.id).eq('settlement_state', 'awaiting_lender_signature').in('status', ['submitted', 'pending'])
      return NextResponse.json({
        error: 'No payee on this draw can be paid yet: none has a wallet that can receive the settlement token.',
        code: 'no_payable_payee', ...view(draw, rows, method),
      }, { status: 409 })
    }
    // A payee being signed for on an approved draw: it is not fully locked
    // again until this signature is in.
    await admin.from('draw_requests').update({ settlement_state: 'awaiting_lender_signature' })
      .eq('id', draw.id).in('status', SIGNABLE_DRAW).neq('settlement_state', 'released')
    return NextResponse.json({ method, signatureNeeded: true, state: 'waiting', current, ...view(draw, rows, method) })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message.slice(0, 300), ...view(draw, await payments(admin, draw.id), method) }, { status: 409 })
  }
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const loaded = await load(params.id)
  if (loaded instanceof NextResponse) return loaded
  const { admin, draw } = loaded
  const method = draw.settlement_method ?? draw.projects?.settlement_method
  let rows = await payments(admin, draw.id)
  if (!isTokenMethod(method)) return NextResponse.json({ state: 'none' })

  const open = rows.find(r => r.status === 'awaiting_signature')
  if (!open) {
    if (draw.settlement_state === 'locked') return NextResponse.json({ state: 'locked', current: null, ...view(draw, rows, method) })
    try {
      if (draw.settlement_state === 'awaiting_lender_signature' && SIGNABLE_DRAW.includes(draw.status) && await finalize(admin, draw, method)) {
        return NextResponse.json({ state: 'locked', current: null, ...view(draw, await payments(admin, draw.id), method) })
      }
    } catch (err) {
      return NextResponse.json({ state: 'problem', error: err instanceof Error ? err.message.slice(0, 300) : 'The draw could not be locked', current: null, ...view(draw, rows, method) }, { status: 409 })
    }
    return NextResponse.json({ state: 'none', current: null, ...view(draw, rows, method) })
  }
  const { data: sig } = await admin.from('payment_signatures').select('payload, txjson').eq('payment_id', open.id).maybeSingle()
  const age = Date.now() - new Date(open.updated_at).getTime()
  if (!sig?.payload) {
    // Its request is still being created by another call (or that call died).
    if (age < ORPHAN_CLAIM_MS) return NextResponse.json({ state: 'waiting', note: 'Preparing the request', ...view(draw, rows, method) })
    await resetPayment(admin, open, null, draw, method, true)
    return NextResponse.json({ state: 'none', current: null, ...view(draw, await payments(admin, draw.id), method) })
  }
  const signable = SIGNABLE_DRAW.includes(draw.status)

  try {
    const result = await getSignResult(sig.payload)
    if (!result.resolved) {
      if (result.expired) { await resetPayment(admin, open, sig.payload, draw, method, true); return NextResponse.json({ state: 'expired', current: null, ...view(draw, await payments(admin, draw.id), method) }) }
      // A declined or released draw has nothing left to sign: withdraw the
      // request. If it cannot be withdrawn (it is open on the phone right
      // now), keep watching it; a signature must never go unrecorded.
      if (!signable && await resetPayment(admin, open, sig.payload, draw, method)) {
        return NextResponse.json({ state: 'none', current: null, ...view(draw, await payments(admin, draw.id), method) })
      }
      return NextResponse.json({ state: 'waiting', ...view(draw, rows, method) })
    }
    if (!result.signed) {
      await resetPayment(admin, open, sig.payload, draw, method, true)
      return NextResponse.json({ state: 'rejected', current: null, ...view(draw, await payments(admin, draw.id), method) })
    }
    // Signed. Whatever has happened to the draw since, what was signed is
    // confirmed and written down: for an escrow, money is locked on the ledger.

    const lenderWallet = draw.projects?.lenders?.xrp_address
    const proof = await confirmLenderSigning({
      method, drawRequestId: draw.id, paymentId: open.id, amountUsd: Number(open.amount),
      lenderWallet, payee: open.wallet, requestedTx: sig.txjson,
      signedBy: result.account, txid: result.txid, hex: result.hex,
    })
    if (proof.lenderSignedBlob) {
      const { error: sigErr } = await admin.from('payment_signatures')
        .update({ signed_blob: proof.lenderSignedBlob, updated_at: now() }).eq('payment_id', open.id).eq('payload', sig.payload)
      if (sigErr) return NextResponse.json({ error: sigErr.message }, { status: 500 })
    }
    await admin.from('draw_payments').update({
      status: 'locked', held_reason: null, updated_at: now(),
      ...(proof.escrowOwner ? { escrow_owner: proof.escrowOwner } : {}),
      ...(proof.escrowSequence != null ? { escrow_sequence: proof.escrowSequence } : {}),
      ...(proof.escrowTxnHash ? { lock_txn_hash: proof.escrowTxnHash } : {}),
    }).eq('id', open.id).eq('status', 'awaiting_signature')
    // With this, later requests go straight to the lender's phone.
    if (result.userToken && draw.projects?.lenders?.id) {
      await admin.from('lender_wallet_links').upsert({ lender_id: draw.projects.lenders.id, user_token: result.userToken }, { onConflict: 'lender_id' })
    }

    if (!signable) {
      // The draw closed while this was being signed. The payment is on record
      // as signed for (an escrow shows on the Funding page, where it can be
      // taken back once its deadline passes), and a person is told.
      const { alertOwner } = await import('@/lib/alerts')
      await alertOwner({
        title: 'A payee was signed for after its draw closed',
        body: `Draw ${draw.request_number}: the lender signed for ${open.payee_name ?? 'a payee'} (${usd(Number(open.amount))}) after the draw became ${draw.status}. It is recorded as signed for and was not paid.`,
        link: '/admin/draws', details: { draw: draw.id, payment: open.id },
      })
      return NextResponse.json({ state: 'none', current: null, ...view(draw, await payments(admin, draw.id), method) })
    }

    // On to the next payee, if any.
    const current = await openNext(admin, draw, method, lenderWallet)
    rows = await payments(admin, draw.id)
    if (current === 'busy') return NextResponse.json({ state: 'waiting', ...view(draw, rows, method) })
    if (current) return NextResponse.json({ state: 'waiting', advanced: true, current, ...view(draw, rows, method) })
    if (await finalize(admin, draw, method)) return NextResponse.json({ state: 'locked', current: null, ...view(draw, rows, method) })
    return NextResponse.json({ state: 'none', current: null, ...view(draw, rows, method) })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (err instanceof SigningMismatch) {
      // Signed, but definitely not what was asked for (or by another wallet,
      // or refused by the ledger): the request is spent, so clear it.
      await resetPayment(admin, open, sig.payload, draw, method, true)
      return NextResponse.json({ state: 'problem', error: message.slice(0, 300), current: null, ...view(draw, await payments(admin, draw.id), method) }, { status: 409 })
    }
    // Anything else (the wallet service or the ledger did not answer, or the
    // transaction is not in a validated ledger yet) says nothing about the
    // signature: keep it and let the screen ask again, for as long as it
    // takes. Only the ledger's own answer ends the wait (a signed escrow that
    // can no longer enter the ledger is reported above as a mismatch).
    console.warn('[sign] could not confirm yet:', message.slice(0, 200))
    return NextResponse.json({ state: 'waiting', note: 'Still confirming with the ledger', ...view(draw, rows, method) })
  }
}
