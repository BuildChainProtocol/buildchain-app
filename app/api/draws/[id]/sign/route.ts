import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase/service'
import { NextRequest, NextResponse } from 'next/server'
import { createSignRequest, getSignResult, isXamanConfigured } from '@/lib/xaman'
import { confirmLenderSigning, isTokenMethod, prepareLenderSigning, SigningMismatch } from '@/lib/xrpl/release'

// The lender approves a dollar-token draw by signing it in their own wallet.
//   POST  build the transaction, check it can settle, open a Xaman sign request
//   GET   has the lender signed? If so, check what they signed and lock the draw
// A project on the pilot method (test_xrp) needs no signature: POST says so and
// the screen goes straight to the ordinary approval.
//
// The caller's own session decides whether they may act on the draw (a lender
// sees only draws on their projects). Everything is then written with the
// service key: the database refuses these writes from a signed-in user, and
// the sign request id and the signature are kept where no user can read them.
export const runtime = 'nodejs'
export const maxDuration = 60

const DRAW_SELECT = `
  id, status, amount, net_amount, request_number, project_id, gc_wallet,
  settlement_method, settlement_state, settlement_amount, settlement_payee,
  release_ticket, escrow_txn_hash,
  projects ( name, settlement_method, loan_account,
    lenders ( xrp_address, company_name, profile_id ),
    borrowers ( xrp_address, company_name ) )
`

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function load(id: string): Promise<{ admin: any; draw: any } | NextResponse> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!profile || !['admin', 'lender'].includes((profile as any).role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  // Row-level security limits a lender to draws on their own projects.
  const { data: draw, error } = await supabase.from('draw_requests').select(DRAW_SELECT).eq('id', id).single()
  if (error || !draw) return NextResponse.json({ error: 'Draw not found' }, { status: 404 })
  // Being able to read the draw is not enough (its borrower can too): only an
  // admin or this project's own lender approves it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((profile as any).role !== 'admin' && (draw as any).projects?.lenders?.profile_id !== user.id) {
    return NextResponse.json({ error: 'Only this loan\'s lender can approve its draws' }, { status: 403 })
  }
  return { admin: serviceClient(), draw }
}

function summary(draw: any) {  // eslint-disable-line @typescript-eslint/no-explicit-any
  return {
    method: draw.settlement_method,
    amountUsd: Number(draw.settlement_amount),
    payee: draw.settlement_payee,
    payeeName: draw.projects?.borrowers?.company_name ?? null,
    projectName: draw.projects?.name ?? null,
    requestNumber: draw.request_number,
    escrowTxnHash: draw.escrow_txn_hash ?? null,
  }
}

const CLEAR = { settlement_state: null, release_ticket: null }

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const loaded = await load(params.id)
  if (loaded instanceof NextResponse) return loaded
  const { admin, draw } = loaded

  const method = draw.projects?.settlement_method ?? 'test_xrp'
  if (!isTokenMethod(method)) return NextResponse.json({ method: 'test_xrp', signatureNeeded: false })

  if (draw.settlement_state === 'locked') {
    return NextResponse.json({ method, signatureNeeded: false, state: 'locked', summary: summary(draw) })
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
  const payee = draw.gc_wallet ?? draw.projects?.borrowers?.xrp_address
  if (!payee) {
    return NextResponse.json({ error: 'The contractor has no wallet on file to be paid to' }, { status: 409 })
  }
  const amountUsd = Number(draw.net_amount ?? draw.amount)

  try {
    // A request that is still open on the lender's phone is reused, so two
    // signable requests for one draw never exist at the same time.
    if (draw.settlement_state === 'awaiting_lender_signature') {
      const { data: open } = await admin.from('draw_signatures').select('payload').eq('draw_request_id', draw.id).maybeSingle()
      if (open?.payload) {
        const state = await getSignResult(open.payload)
        if (!state.resolved && !state.expired) {
          return NextResponse.json({ error: 'A signature request for this draw is already open in Xaman. Sign or decline it there, or wait for it to expire.' }, { status: 409 })
        }
        // Already signed (the tab was closed, or confirming was interrupted):
        // never ask for a second signature. For an escrow that would lock the
        // money twice. Hand back to the status check, which confirms this one.
        if (state.resolved && state.signed) {
          return NextResponse.json({
            method, signatureNeeded: true, state: 'checking', qrPng: null, url: null, cancelAfter: null,
            summary: summary(draw),
          })
        }
      }
    }

    // Other draws on this loan that already hold a ticket or committed money.
    const { data: others } = await admin
      .from('draw_requests').select('release_ticket, settlement_amount, settlement_state')
      .eq('project_id', draw.project_id).neq('id', draw.id)
      .in('settlement_state', ['awaiting_lender_signature', 'locked'])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: any[] = others ?? []
    // Draws out for signature count as committed too, so two approvals signed
    // side by side cannot promise the same money.
    const plan = await prepareLenderSigning({
      method, drawRequestId: draw.id, amountUsd, lenderWallet, payee,
      loanAccount: draw.projects?.loan_account,
      ticketsInUse: rows.filter(r => r.release_ticket != null).map(r => Number(r.release_ticket)),
      committedUsd: rows.reduce((sum, r) => sum + Number(r.settlement_amount ?? 0), 0),
    })
    const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amountUsd)
    const request = await createSignRequest({
      txjson: plan.txjson,
      submit: !plan.multisign,
      multisign: plan.multisign,
      identifier: `draw-${draw.id}`.slice(0, 40),
      instruction: plan.multisign
        ? `Approve Draw ${draw.request_number} on ${draw.projects?.name}: ${dollars}. Your signature authorizes this release; it is paid only after inspection and lien waiver are both recorded.`
        : `Approve Draw ${draw.request_number} on ${draw.projects?.name}: lock ${dollars} in escrow. It is paid only after inspection and lien waiver are both recorded.`,
    })
    const { error: sigErr } = await admin.from('draw_signatures').upsert({
      draw_request_id: draw.id, payload: request.uuid, txjson: plan.txjson, signed_blob: null, updated_at: new Date().toISOString(),
    }, { onConflict: 'draw_request_id' })
    if (sigErr) return NextResponse.json({ error: sigErr.message }, { status: 500 })
    const { error: saveErr } = await admin.from('draw_requests').update({
      settlement_method: method,
      settlement_state: 'awaiting_lender_signature',
      settlement_amount: amountUsd,
      settlement_payee: payee,
      release_ticket: plan.releaseTicket,
    }).eq('id', draw.id)
    if (saveErr) return NextResponse.json({ error: saveErr.message }, { status: 500 })

    return NextResponse.json({
      method, signatureNeeded: true, state: 'waiting',
      qrPng: request.qrPng, url: request.url, cancelAfter: plan.cancelAfter,
      summary: { ...summary({ ...draw, settlement_method: method, settlement_amount: amountUsd, settlement_payee: payee }) },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message.slice(0, 300) }, { status: 409 })
  }
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const loaded = await load(params.id)
  if (loaded instanceof NextResponse) return loaded
  const { admin, draw } = loaded

  if (draw.settlement_state === 'locked') return NextResponse.json({ state: 'locked', summary: summary(draw) })
  if (draw.settlement_state !== 'awaiting_lender_signature') return NextResponse.json({ state: 'none' })
  const { data: sig } = await admin.from('draw_signatures').select('payload, txjson').eq('draw_request_id', draw.id).maybeSingle()
  if (!sig?.payload) return NextResponse.json({ state: 'none' })

  // Clear the request only if this call is the one that moved the draw out of
  // "awaiting": a draw another call has just locked keeps its signature.
  const reset = async () => {
    const { data: cleared } = await admin.from('draw_requests').update(CLEAR)
      .eq('id', draw.id).eq('settlement_state', 'awaiting_lender_signature').select('id')
    if (cleared?.length) await admin.from('draw_signatures').delete().eq('draw_request_id', draw.id).eq('payload', sig.payload)
  }
  if (['declined', 'funded'].includes(draw.status)) { await reset(); return NextResponse.json({ state: 'none' }) }
  try {
    const result = await getSignResult(sig.payload)
    if (!result.resolved) {
      if (result.expired) { await reset(); return NextResponse.json({ state: 'expired' }) }
      return NextResponse.json({ state: 'waiting' })
    }
    if (!result.signed) { await reset(); return NextResponse.json({ state: 'rejected' }) }

    const proof = await confirmLenderSigning({
      method: draw.settlement_method,
      drawRequestId: draw.id,
      amountUsd: Number(draw.settlement_amount),
      lenderWallet: draw.projects?.lenders?.xrp_address,
      payee: draw.settlement_payee,
      requestedTx: sig.txjson,
      signedBy: result.account, txid: result.txid, hex: result.hex,
    })
    if (proof.lenderSignedBlob) {
      const { error: sigErr } = await admin.from('draw_signatures')
        .update({ signed_blob: proof.lenderSignedBlob, updated_at: new Date().toISOString() }).eq('draw_request_id', draw.id)
      if (sigErr) return NextResponse.json({ error: sigErr.message }, { status: 500 })
    }
    const { data: locked, error: saveErr } = await admin.from('draw_requests').update({
      settlement_state: 'locked',
      ...(proof.escrowOwner ? { escrow_owner: proof.escrowOwner } : {}),
      ...(proof.escrowSequence != null ? { escrow_sequence: proof.escrowSequence } : {}),
      ...(proof.escrowTxnHash ? { escrow_txn_hash: proof.escrowTxnHash } : {}),
    }).eq('id', draw.id).eq('settlement_state', 'awaiting_lender_signature').select(DRAW_SELECT).single()
    if (saveErr) return NextResponse.json({ error: saveErr.message }, { status: 500 })
    return NextResponse.json({ state: 'locked', summary: summary(locked) })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (err instanceof SigningMismatch) {
      // Signed, but definitely not what was asked for (or by another wallet,
      // or refused by the ledger): the request is spent, so clear it.
      await reset()
      return NextResponse.json({ state: 'problem', error: message.slice(0, 300) }, { status: 409 })
    }
    // Anything else (the wallet service or the ledger did not answer, or the
    // transaction is not in a validated ledger yet) says nothing about the
    // signature. Keep it and let the screen ask again.
    console.warn('[sign] could not confirm yet:', message.slice(0, 200))
    return NextResponse.json({ state: 'waiting', note: 'Still confirming with the ledger' })
  }
}
