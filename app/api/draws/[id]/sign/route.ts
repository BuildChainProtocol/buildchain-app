import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { createSignRequest, getSignResult, isXamanConfigured } from '@/lib/xaman'
import { confirmLenderSigning, isTokenMethod, prepareLenderSigning } from '@/lib/xrpl/release'

// The lender approves a dollar-token draw by signing it in their own wallet.
//   POST  build the transaction, check it can settle, open a Xaman sign request
//   GET   has the lender signed? If so, check what they signed and lock the draw
// A project on the pilot method (test_xrp) needs no signature: POST says so and
// the screen goes straight to the ordinary approval.
export const runtime = 'nodejs'
export const maxDuration = 60

const DRAW_SELECT = `
  id, status, amount, net_amount, request_number, project_id, gc_wallet,
  settlement_method, settlement_state, settlement_amount, settlement_payee,
  lender_sign_payload, lender_sign_tx, release_ticket, escrow_txn_hash,
  projects ( name, settlement_method, loan_account,
    lenders ( xrp_address, company_name ),
    borrowers ( xrp_address, company_name ) )
`

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function load(id: string): Promise<{ supabase: any; draw: any } | NextResponse> {
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
  return { supabase, draw }
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

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const loaded = await load(params.id)
  if (loaded instanceof NextResponse) return loaded
  const { supabase, draw } = loaded

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
    const { data: pending } = await supabase
      .from('draw_requests').select('release_ticket')
      .eq('project_id', draw.project_id).not('release_ticket', 'is', null)
      .neq('settlement_state', 'released').neq('id', draw.id)
    const plan = await prepareLenderSigning({
      method, drawRequestId: draw.id, amountUsd, lenderWallet, payee,
      loanAccount: draw.projects?.loan_account,
      ticketsInUse: (pending ?? []).map((p: { release_ticket: number }) => p.release_ticket),
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
    const { error: saveErr } = await supabase.from('draw_requests').update({
      settlement_method: method,
      settlement_state: 'awaiting_lender_signature',
      settlement_amount: amountUsd,
      settlement_payee: payee,
      lender_sign_payload: request.uuid,
      lender_sign_tx: plan.txjson,
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
  const { supabase, draw } = loaded

  if (draw.settlement_state === 'locked') return NextResponse.json({ state: 'locked', summary: summary(draw) })
  if (draw.settlement_state !== 'awaiting_lender_signature' || !draw.lender_sign_payload) {
    return NextResponse.json({ state: 'none' })
  }

  try {
    const result = await getSignResult(draw.lender_sign_payload)
    const clear = { settlement_state: null, lender_sign_payload: null, lender_sign_tx: null, release_ticket: null }
    if (!result.resolved) {
      if (result.expired) {
        await supabase.from('draw_requests').update(clear).eq('id', draw.id)
        return NextResponse.json({ state: 'expired' })
      }
      return NextResponse.json({ state: 'waiting' })
    }
    if (!result.signed) {
      await supabase.from('draw_requests').update(clear).eq('id', draw.id)
      return NextResponse.json({ state: 'rejected' })
    }

    const proof = await confirmLenderSigning({
      method: draw.settlement_method,
      drawRequestId: draw.id,
      amountUsd: Number(draw.settlement_amount),
      lenderWallet: draw.projects?.lenders?.xrp_address,
      payee: draw.settlement_payee,
      requestedTx: draw.lender_sign_tx,
      signedBy: result.account, txid: result.txid, hex: result.hex,
    })
    const { data: locked, error: saveErr } = await supabase.from('draw_requests').update({
      settlement_state: 'locked',
      ...(proof.escrowOwner ? { escrow_owner: proof.escrowOwner } : {}),
      ...(proof.escrowSequence != null ? { escrow_sequence: proof.escrowSequence } : {}),
      ...(proof.escrowTxnHash ? { escrow_txn_hash: proof.escrowTxnHash } : {}),
      ...(proof.lenderSignedBlob ? { lender_signed_blob: proof.lenderSignedBlob } : {}),
    }).eq('id', draw.id).eq('settlement_state', 'awaiting_lender_signature').select(DRAW_SELECT).single()
    if (saveErr) return NextResponse.json({ error: saveErr.message }, { status: 500 })
    return NextResponse.json({ state: 'locked', summary: summary(locked) })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ state: 'problem', error: message.slice(0, 300) }, { status: 409 })
  }
}
