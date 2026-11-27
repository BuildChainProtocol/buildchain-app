/**
 * How a draw settles, by method. The routes and the orchestrator call these
 * three steps and never touch the ledger details themselves:
 *
 *   prepareLenderSigning  what the lender must sign to approve a draw
 *   confirmLenderSigning  check what the lender signed against the draw
 *   releaseDraw           pay the draw out once both conditions are recorded
 *
 * See lib/xrpl/settlement.ts for the two dollar-token methods.
 */

import { Wallet } from 'xrpl'
import type { Client } from 'xrpl'
import { getConnectedClient } from './client'
import { escrowConditionFor, finishDrawEscrow, isTestnet } from './escrow'
import {
  buildLenderEscrowCreate, buildReleasePayment, countersignAndSubmit, finishTokenEscrow,
  issuerAllowsEscrow, loanTickets, tokenAmount, tokenBalance, usdValue, verifyLenderEscrow,
  verifyLenderSignedRelease, verifyLoanAccount,
} from './settlement'
import type { TokenSpec } from './settlement'

export type SettlementMethod = 'test_xrp' | 'token_escrow' | 'two_signature'
type Tx = Record<string, unknown>

export function isTokenMethod(method: string | null | undefined): method is 'token_escrow' | 'two_signature' {
  return method === 'token_escrow' || method === 'two_signature'
}

/** The dollar token draws settle in (RLUSD in production; a test token on the test network). */
export function settlementToken(): TokenSpec {
  const issuer = process.env.SETTLEMENT_TOKEN_ISSUER
  if (!issuer) throw new Error('SETTLEMENT_TOKEN_ISSUER is not set, so dollar-token settlement is not available')
  return { currency: process.env.SETTLEMENT_TOKEN_CURRENCY ?? 'RLUSD', issuer }
}

/** Real-money guard: dollar-token settlement runs on mainnet only when explicitly switched on. */
function assertNetworkAllowed(): void {
  if (!isTestnet() && process.env.SETTLEMENT_MAINNET_ENABLED !== 'true') {
    throw new Error('Dollar-token settlement on mainnet is switched off (SETTLEMENT_MAINNET_ENABLED is not true)')
  }
}

function platformWallet(): Wallet {
  const seed = process.env.XRPL_WALLET_SEED
  if (!seed) throw new Error('XRPL_WALLET_SEED is not set in environment variables')
  return Wallet.fromSeed(seed)
}

/** BuildChain's own ledger address: the second signer on a loan account. */
export function buildchainAddress(): string {
  return platformWallet().address
}

function cancelAfterDate(): Date {
  const days = Math.max(1, parseInt(process.env.XRPL_ESCROW_CANCEL_AFTER_DAYS ?? '90', 10) || 90)
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000)
}

async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = await getConnectedClient()
  try { return await fn(client) } finally { await client.disconnect() }
}

export interface SigningPlan {
  method: 'token_escrow' | 'two_signature'
  /** the transaction the lender signs */
  txjson: Tx
  /** two_signature: the lender signs as one of two signers and nothing is submitted yet */
  multisign: boolean
  amountUsd: number
  payee: string
  releaseTicket: number | null
  /** token_escrow: when an unreleased draw can be taken back by the lender */
  cancelAfter: string | null
}

/**
 * Everything is checked on the ledger before the lender is asked to sign, so
 * a request that could not settle never reaches their phone.
 */
export async function prepareLenderSigning(o: {
  method: 'token_escrow' | 'two_signature'
  drawRequestId: string
  amountUsd: number
  lenderWallet: string
  payee: string
  loanAccount?: string | null
  /** tickets already promised to other pending draws on this loan */
  ticketsInUse?: number[]
  /** dollars already committed to other approved draws on this loan */
  committedUsd?: number
}): Promise<SigningPlan> {
  assertNetworkAllowed()
  const token = settlementToken()
  usdValue(o.amountUsd)

  return withClient(async (client) => {
    if ((await tokenBalance(client, o.payee, token)) === null) {
      throw new Error('The payee\'s wallet is not set up to receive the settlement token yet (no trust line)')
    }

    if (o.method === 'token_escrow') {
      if (!(await issuerAllowsEscrow(client, token.issuer))) {
        throw new Error('The token\'s issuer has not enabled escrow for it. Use the two-signature method for this loan.')
      }
      const balance = Number(await tokenBalance(client, o.lenderWallet, token) ?? 0)
      if (balance < o.amountUsd) {
        throw new Error(`The lender\'s wallet holds ${balance.toFixed(2)}, less than this draw`)
      }
      const cancelAfter = cancelAfterDate()
      return {
        method: 'token_escrow', multisign: false, amountUsd: o.amountUsd, payee: o.payee,
        releaseTicket: null, cancelAfter: cancelAfter.toISOString(),
        txjson: buildLenderEscrowCreate({
          lender: o.lenderWallet, payee: o.payee, token, usd: o.amountUsd,
          condition: escrowConditionFor(o.drawRequestId).condition,
          cancelAfter, drawRequestId: o.drawRequestId,
        }),
      }
    }

    if (!o.loanAccount) throw new Error('This loan has no two-signature account yet')
    const problems = await verifyLoanAccount(client, o.loanAccount, {
      lender: o.lenderWallet, buildchain: buildchainAddress(), token,
    })
    if (problems.length) throw new Error(`The loan account is not ready: ${problems.join('; ')}`)
    const balance = Number(await tokenBalance(client, o.loanAccount, token) ?? 0)
    const free = balance - (o.committedUsd ?? 0)
    if (free < o.amountUsd) {
      throw new Error(
        `The loan account holds ${balance.toFixed(2)}` +
        ((o.committedUsd ?? 0) > 0 ? `, of which ${(o.committedUsd ?? 0).toFixed(2)} is committed to other approved draws` : '') +
        `. That is not enough for this draw; the lender needs to deposit first.`)
    }
    const used = new Set(o.ticketsInUse ?? [])
    const ticket = (await loanTickets(client, o.loanAccount)).find(t => !used.has(t))
    if (ticket === undefined) throw new Error('The loan account has no free release slots left')
    return {
      method: 'two_signature', multisign: true, amountUsd: o.amountUsd, payee: o.payee,
      releaseTicket: ticket, cancelAfter: null,
      txjson: buildReleasePayment({
        loanAccount: o.loanAccount, payee: o.payee, token, usd: o.amountUsd,
        ticketSequence: ticket, drawRequestId: o.drawRequestId,
      }),
    }
  })
}

export interface SigningProof {
  escrowOwner?: string
  escrowSequence?: number
  escrowTxnHash?: string
  lenderSignedBlob?: string
}

/**
 * The lender signed in their wallet. Before the draw is recorded as locked,
 * what they signed is checked against the draw: on the ledger for an escrow,
 * field by field for a two-signature release.
 */
export async function confirmLenderSigning(o: {
  method: 'token_escrow' | 'two_signature'
  drawRequestId: string
  amountUsd: number
  lenderWallet: string
  payee: string
  /** the transaction the lender was asked to sign */
  requestedTx: Tx
  signedBy: string | null
  txid: string | null
  hex: string | null
}): Promise<SigningProof> {
  if (o.signedBy !== o.lenderWallet) {
    throw new Error('The request was signed by a different wallet than the lender\'s registered wallet')
  }

  if (o.method === 'two_signature') {
    if (!o.hex) throw new Error('The wallet did not return the signed transaction')
    const problems = verifyLenderSignedRelease(o.hex, o.requestedTx, o.lenderWallet)
    if (problems.length) throw new Error(`The signed release does not match the draw: ${problems.join('; ')}`)
    return { lenderSignedBlob: o.hex }
  }

  if (!o.txid) throw new Error('The wallet did not return a transaction hash')
  const token = settlementToken()
  return withClient(async (client) => {
    let found: Tx | null = null
    for (let i = 0; i < 20 && !found; i++) {
      try {
        const res = await client.request({ command: 'tx', transaction: o.txid as string })
        const r = res.result as unknown as Tx
        if (r.validated) found = r
      } catch { /* not in a validated ledger yet */ }
      if (!found) await new Promise(res => setTimeout(res, 1500))
    }
    if (!found) throw new Error('The escrow transaction is not on the ledger yet. Try again in a moment.')
    const txj = (found.tx_json ?? found) as Tx
    const meta = found.meta as Tx | undefined
    if (meta?.TransactionResult !== 'tesSUCCESS') throw new Error(`The escrow transaction failed: ${String(meta?.TransactionResult)}`)
    const sequence = Number(txj.Sequence)
    const problems = await verifyLenderEscrow(client, {
      owner: o.lenderWallet, sequence, payee: o.payee, token, usd: o.amountUsd,
      condition: escrowConditionFor(o.drawRequestId).condition,
      minCancelAfter: new Date(Date.now() + 24 * 60 * 60 * 1000),
    })
    if (problems.length) throw new Error(`The escrow does not match the draw: ${problems.join('; ')}`)
    return { escrowOwner: o.lenderWallet, escrowSequence: sequence, escrowTxnHash: o.txid as string }
  })
}

/**
 * Pay the draw out. Called by the orchestrator when both conditions are
 * recorded, or by a lender's manual release of an approved draw.
 */
export async function releaseDraw(draw: {
  id: string
  settlement_method?: string | null
  escrow_sequence?: number | null
  escrow_owner?: string | null
  settlement_amount?: number | string | null
  settlement_payee?: string | null
  /** two_signature, from draw_signatures: what the lender was asked to sign, and their signature */
  lender_sign_tx?: Tx | null
  lender_signed_blob?: string | null
  /** the lender's registered wallet */
  lender_wallet?: string | null
}, trigger: 'manual' | 'orchestrator'): Promise<{ txnHash: string }> {
  const method = (draw.settlement_method ?? 'test_xrp') as SettlementMethod

  if (method === 'test_xrp') {
    if (draw.escrow_sequence == null) throw new Error('This draw has no escrow to release')
    return finishDrawEscrow({ escrowSequence: draw.escrow_sequence, drawRequestId: draw.id, trigger })
  }

  assertNetworkAllowed()
  if (method === 'token_escrow') {
    if (draw.escrow_sequence == null || !draw.escrow_owner) throw new Error('This draw has no lender escrow to release')
    const { condition, fulfillment } = escrowConditionFor(draw.id)
    const done = await withClient(client => finishTokenEscrow(client, platformWallet(), {
      owner: draw.escrow_owner as string, sequence: draw.escrow_sequence as number,
      condition, fulfillment, drawRequestId: draw.id,
    }))
    return { txnHash: done.hash }
  }

  if (!draw.lender_signed_blob || !draw.lender_sign_tx || !draw.lender_wallet) {
    throw new Error('The lender has not signed this draw\'s release')
  }
  // BuildChain's signature is the last lock, so nothing is taken on trust at
  // this point: the stored request must be this draw's payment (payee and
  // amount as recorded on the draw, in the settlement token), and the signed
  // transaction must be exactly that request, signed by the lender alone.
  const requested = draw.lender_sign_tx
  const amount = requested.Amount as { currency?: string; issuer?: string; value?: string } | undefined
  const token = settlementToken()
  const cents = (v: unknown) => Math.round(Number(v) * 100)
  if (requested.TransactionType !== 'Payment' || requested.Destination !== draw.settlement_payee ||
      !amount || typeof amount !== 'object' || amount.issuer !== token.issuer ||
      amount.currency !== tokenAmount(token, 1).currency ||
      !Number.isFinite(Number(amount.value)) || cents(amount.value) !== cents(draw.settlement_amount)) {
    throw new Error('The signed release on file is not this draw\'s payment, so it was not released')
  }
  const problems = verifyLenderSignedRelease(draw.lender_signed_blob, requested, draw.lender_wallet)
  if (problems.length) throw new Error(`The lender's signature no longer matches the draw: ${problems.join('; ')}`)
  const done = await withClient(client => countersignAndSubmit(client, platformWallet(), draw.lender_signed_blob as string))
  return { txnHash: done.hash }
}
