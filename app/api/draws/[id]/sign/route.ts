import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase/service'
import { NextRequest, NextResponse } from 'next/server'
import { createSignRequest, getSignResult, isXamanConfigured } from '@/lib/xaman'
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

/* eslint-disable @typescript-eslint/no-explicit-any */

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
function planPayees(draw: any): Array<{ payee_name: string; sub_code: string | null; bb_pay_app_id: number | null; wallet: string | null; amount: number }> {
  const net = Number(draw.net_amount ?? draw.amount)
  const listed = (Array.isArray(draw.payees) ? draw.payees : []).filter((p: any) => Number(p?.amount) > 0)
  if (listed.length) {
    return listed.map((p: any) => ({
      payee_name: String(p.sub_name ?? p.name ?? (p.sub_code ? `Subcontractor ${p.sub_code}` : 'General contractor')).slice(0, 200),
      sub_code: p.sub_code ?? null,
      bb_pay_app_id: p.bb_pay_app_id ?? null,
      wallet: typeof p.wallet === 'string' && p.wallet ? p.wallet : null,
      amount: Math.round(Number(p.amount) * 100) / 100,
    }))
  }
  return [{
    payee_name: draw.projects?.borrowers?.company_name ?? 'General contractor',
    sub_code: null, bb_pay_app_id: null,
    wallet: draw.gc_wallet ?? draw.projects?.borrowers?.xrp_address ?? null,
    amount: Math.round(net * 100) / 100,
  }]
}

function view(draw: any, rows: any[], method: string) {
  const sum = (f: (r: any) => boolean) => rows.filter(f).reduce((t, r) => t + Number(r.amount), 0)
  return {
    payments: rows.map(r => ({
      id: r.id, name: r.payee_name, amount: Number(r.amount), wallet: r.wallet,
      status: r.status, heldReason: r.held_reason ?? null,
    })),
    summary: {
      method, projectName: draw.projects?.name ?? null, requestNumber: draw.request_number,
      totalUsd: sum(() => true), payableUsd: sum(r => r.status !== 'held'), heldUsd: sum(r => r.status === 'held'),
      signed: rows.filter(r => ['locked', 'released'].includes(r.status)).length,
      toSign: rows.filter(r => r.status !== 'held').length,
    },
  }
}

/** Put a payment back to "waiting for the lender": its request is spent or was refused. */
async function resetPayment(admin: any, payment: any, payload: string | null) {
  const { data: cleared } = await admin.from('draw_payments')
    .update({ status: 'pending', release_ticket: null, updated_at: new Date().toISOString() })
    .eq('id', payment.id).eq('status', 'awaiting_signature').select('id')
  if (cleared?.length) {
    let q = admin.from('payment_signatures').delete().eq('payment_id', payment.id)
    if (payload) q = q.eq('payload', payload)
    await q
  }
}

/**
 * Open the sign request for the next payee still waiting. Returns the open
 * request, or null when nothing is left to sign. A payee whose wallet cannot
 * receive the token is put on hold and skipped, not treated as a failure.
 */
async function openNext(admin: any, draw: any, method: 'token_escrow' | 'two_signature', lenderWallet: string):
  Promise<{ paymentId: string; qrPng: string; url: string; pushed: boolean; cancelAfter: string | null } | null> {
  const { data: link } = await admin.from('lender_wallet_links').select('user_token').eq('lender_id', draw.projects?.lenders?.id).maybeSingle()

  for (;;) {
    const rows = await payments(admin, draw.id)
    const next = rows.find(r => r.status === 'pending')
    if (!next) return null

    // Money and tickets already promised on this loan, by this draw or others.
    const { data: busy } = await admin.from('draw_payments')
      .select('release_ticket, amount').eq('project_id', draw.project_id).neq('id', next.id)
      .in('status', ['awaiting_signature', 'locked'])
    const others: any[] = busy ?? []

    let plan
    try {
      plan = await prepareLenderSigning({
        method, drawRequestId: draw.id, paymentId: next.id, amountUsd: Number(next.amount),
        lenderWallet, payee: next.wallet, loanAccount: draw.projects?.loan_account,
        ticketsInUse: others.filter(o => o.release_ticket != null).map(o => Number(o.release_ticket)),
        committedUsd: others.reduce((t, o) => t + Number(o.amount ?? 0), 0),
      })
    } catch (err) {
      if (err instanceof PayeeNotReady) {
        await admin.from('draw_payments').update({
          status: 'held', held_reason: 'This wallet cannot receive the settlement token yet', updated_at: new Date().toISOString(),
        }).eq('id', next.id).eq('status', 'pending')
        continue
      }
      throw err
    }

    const position = rows.filter(r => r.status !== 'held').findIndex(r => r.id === next.id) + 1
    const of = rows.filter(r => r.status !== 'held').length
    const request = await createSignRequest({
      txjson: plan.txjson,
      submit: !plan.multisign,
      multisign: plan.multisign,
      userToken: link?.user_token ?? null,
      identifier: `pay-${next.id}`.slice(0, 40),
      instruction: `Draw ${draw.request_number}, ${draw.projects?.name}: ${plan.multisign ? 'authorize' : 'lock'} ${usd(Number(next.amount))} for ${next.payee_name}` +
        (of > 1 ? ` (${position} of ${of})` : '') + '. Paid only after inspection and lien waiver are both recorded.',
    })
    const { error: sigErr } = await admin.from('payment_signatures').upsert({
      payment_id: next.id, payload: request.uuid, qr_png: request.qrPng, open_url: request.url,
      txjson: plan.txjson, signed_blob: null, updated_at: new Date().toISOString(),
    }, { onConflict: 'payment_id' })
    if (sigErr) throw new Error(sigErr.message)
    const { data: claimed } = await admin.from('draw_payments')
      .update({ status: 'awaiting_signature', release_ticket: plan.releaseTicket, updated_at: new Date().toISOString() })
      .eq('id', next.id).eq('status', 'pending').select('id')
    if (!claimed?.length) continue   // another request got there first
    return { paymentId: next.id, qrPng: request.qrPng, url: request.url, pushed: request.pushed, cancelAfter: plan.cancelAfter }
  }
}

/** Every payee that can be paid is signed for: the draw is locked. */
async function finalize(admin: any, draw: any, method: string) {
  const rows = await payments(admin, draw.id)
  const payable = rows.filter(r => r.status !== 'held')
  if (!payable.length || payable.some(r => !['locked', 'released'].includes(r.status))) return false
  await admin.from('draw_requests').update({
    settlement_method: method, settlement_state: 'locked',
    settlement_amount: payable.reduce((t, r) => t + Number(r.amount), 0),
  }).eq('id', draw.id).neq('settlement_state', 'released')
  return true
}

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const loaded = await load(params.id)
  if (loaded instanceof NextResponse) return loaded
  const { admin, draw } = loaded

  const method = draw.projects?.settlement_method ?? 'test_xrp'
  if (!isTokenMethod(method)) return NextResponse.json({ method: 'test_xrp', signatureNeeded: false })

  let rows = await payments(admin, draw.id)
  if (draw.settlement_state === 'locked') {
    return NextResponse.json({ method, signatureNeeded: false, state: 'locked', ...view(draw, rows, method) })
  }
  if (!['submitted', 'pending'].includes(draw.status)) {
    return NextResponse.json({ error: `This draw is ${draw.status}; only a draw awaiting review can be signed` }, { status: 409 })
  }
  if (!isXamanConfigured()) {
    return NextResponse.json({ error: 'Wallet signing is not set up on this site yet (Xaman keys are missing)' }, { status: 503 })
  }
  const lenderWallet = draw.projects?.lenders?.xrp_address
  if (!lenderWallet) {
    return NextResponse.json({ error: 'Connect the lender\'s wallet first', code: 'no_lender_wallet' }, { status: 409 })
  }

  try {
    // First visit: write down who this draw pays.
    if (!rows.length) {
      const planned = planPayees(draw)
      const net = Number(draw.net_amount ?? draw.amount)
      if (cents(planned.reduce((t, p) => t + p.amount, 0)) !== cents(net)) {
        return NextResponse.json({ error: `The payees on this draw add up to ${usd(planned.reduce((t, p) => t + p.amount, 0))}, not its net amount of ${usd(net)}. It cannot be signed until they agree.` }, { status: 409 })
      }
      const { error: insErr } = await admin.from('draw_payments').insert(planned.map((p, i) => ({
        draw_request_id: draw.id, project_id: draw.project_id, seq: i + 1, ...p,
        status: p.wallet ? 'pending' : 'held',
        held_reason: p.wallet ? null : 'No wallet on file for this payee',
      })))
      if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })
      rows = await payments(admin, draw.id)
    }

    // A payee held because the wallet could not receive the token gets another
    // look each time: its owner may have set the wallet up since.
    await admin.from('draw_payments').update({ status: 'pending', held_reason: null, updated_at: new Date().toISOString() })
      .eq('draw_request_id', draw.id).eq('status', 'held').not('wallet', 'is', null)
    rows = await payments(admin, draw.id)

    // A request already out: show it again, or let the status check confirm it.
    const open = rows.find(r => r.status === 'awaiting_signature')
    if (open) {
      const { data: sig } = await admin.from('payment_signatures').select('payload, qr_png, open_url').eq('payment_id', open.id).maybeSingle()
      if (sig?.payload) {
        const state = await getSignResult(sig.payload)
        if (!state.resolved && !state.expired) {
          return NextResponse.json({
            method, signatureNeeded: true, state: 'waiting',
            current: { paymentId: open.id, qrPng: sig.qr_png, url: sig.open_url, pushed: false, cancelAfter: null },
            ...view(draw, rows, method),
          })
        }
        // Already signed (the tab was closed, or confirming was interrupted):
        // never ask for a second signature. The status check confirms this one.
        if (state.resolved && state.signed) {
          return NextResponse.json({ method, signatureNeeded: true, state: 'checking', current: null, ...view(draw, rows, method) })
        }
      }
      await resetPayment(admin, open, sig?.payload ?? null)
    }

    const current = await openNext(admin, draw, method, lenderWallet)
    rows = await payments(admin, draw.id)
    if (!current) {
      if (await finalize(admin, draw, method)) {
        return NextResponse.json({ method, signatureNeeded: false, state: 'locked', ...view(draw, rows, method) })
      }
      return NextResponse.json({
        error: 'No payee on this draw can be paid yet: none has a wallet that can receive the settlement token.',
        code: 'no_payable_payee', ...view(draw, rows, method),
      }, { status: 409 })
    }
    await admin.from('draw_requests').update({
      settlement_method: method, settlement_state: 'awaiting_lender_signature',
      settlement_amount: rows.filter(r => r.status !== 'held').reduce((t, r) => t + Number(r.amount), 0),
    }).eq('id', draw.id)
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

  if (draw.settlement_state === 'locked') return NextResponse.json({ state: 'locked', current: null, ...view(draw, rows, method) })
  if (draw.settlement_state !== 'awaiting_lender_signature' || !isTokenMethod(method)) return NextResponse.json({ state: 'none' })

  const open = rows.find(r => r.status === 'awaiting_signature')
  if (!open) {
    if (await finalize(admin, draw, method)) return NextResponse.json({ state: 'locked', current: null, ...view(draw, rows, method) })
    return NextResponse.json({ state: 'none', current: null, ...view(draw, rows, method) })
  }
  const { data: sig } = await admin.from('payment_signatures').select('payload, txjson').eq('payment_id', open.id).maybeSingle()
  if (!sig?.payload) { await resetPayment(admin, open, null); return NextResponse.json({ state: 'none', current: null, ...view(draw, await payments(admin, draw.id), method) }) }

  // A declined or released draw has nothing left to sign.
  if (['declined', 'funded'].includes(draw.status)) {
    await resetPayment(admin, open, sig.payload)
    return NextResponse.json({ state: 'none' })
  }

  try {
    const result = await getSignResult(sig.payload)
    if (!result.resolved) {
      if (result.expired) { await resetPayment(admin, open, sig.payload); return NextResponse.json({ state: 'expired', current: null, ...view(draw, await payments(admin, draw.id), method) }) }
      return NextResponse.json({ state: 'waiting', ...view(draw, rows, method) })
    }
    if (!result.signed) {
      await resetPayment(admin, open, sig.payload)
      return NextResponse.json({ state: 'rejected', current: null, ...view(draw, await payments(admin, draw.id), method) })
    }

    const lenderWallet = draw.projects?.lenders?.xrp_address
    const proof = await confirmLenderSigning({
      method, drawRequestId: draw.id, paymentId: open.id, amountUsd: Number(open.amount),
      lenderWallet, payee: open.wallet, requestedTx: sig.txjson,
      signedBy: result.account, txid: result.txid, hex: result.hex,
    })
    if (proof.lenderSignedBlob) {
      const { error: sigErr } = await admin.from('payment_signatures')
        .update({ signed_blob: proof.lenderSignedBlob, updated_at: new Date().toISOString() }).eq('payment_id', open.id)
      if (sigErr) return NextResponse.json({ error: sigErr.message }, { status: 500 })
    }
    await admin.from('draw_payments').update({
      status: 'locked', updated_at: new Date().toISOString(),
      ...(proof.escrowOwner ? { escrow_owner: proof.escrowOwner } : {}),
      ...(proof.escrowSequence != null ? { escrow_sequence: proof.escrowSequence } : {}),
      ...(proof.escrowTxnHash ? { lock_txn_hash: proof.escrowTxnHash } : {}),
    }).eq('id', open.id).eq('status', 'awaiting_signature')
    // With this, later requests go straight to the lender's phone.
    if (result.userToken && draw.projects?.lenders?.id) {
      await admin.from('lender_wallet_links').upsert({ lender_id: draw.projects.lenders.id, user_token: result.userToken }, { onConflict: 'lender_id' })
    }

    // On to the next payee, if any.
    const current = await openNext(admin, draw, method, lenderWallet)
    rows = await payments(admin, draw.id)
    if (current) return NextResponse.json({ state: 'waiting', advanced: true, current, ...view(draw, rows, method) })
    if (await finalize(admin, draw, method)) return NextResponse.json({ state: 'locked', current: null, ...view(draw, rows, method) })
    return NextResponse.json({ state: 'none', current: null, ...view(draw, rows, method) })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (err instanceof SigningMismatch) {
      // Signed, but definitely not what was asked for (or by another wallet,
      // or refused by the ledger): the request is spent, so clear it.
      await resetPayment(admin, open, sig.payload)
      return NextResponse.json({ state: 'problem', error: message.slice(0, 300), current: null, ...view(draw, await payments(admin, draw.id), method) }, { status: 409 })
    }
    // Anything else (the wallet service or the ledger did not answer, or the
    // transaction is not in a validated ledger yet) says nothing about the
    // signature. Keep it and let the screen ask again.
    console.warn('[sign] could not confirm yet:', message.slice(0, 200))
    return NextResponse.json({ state: 'waiting', note: 'Still confirming with the ledger', ...view(draw, rows, method) })
  }
}
