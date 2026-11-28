/**
 * How a draw settles, by method. The routes and the orchestrator call these
 * steps and never touch the ledger details themselves.
 *
 *   test_xrp        the pilot: BuildChain's test wallet locks 1 test XRP for
 *                   the whole draw (lib/xrpl/escrow.ts). One escrow per draw.
 *   token_escrow    dollar token, one escrow PER PAYEE, each created and
 *   two_signature   signed by the lender; or one two-signature payment PER
 *                   PAYEE from the loan account (lib/xrpl/settlement.ts).
 *
 * For the dollar-token methods every payee has its own row in draw_payments,
 * its own lender signature and its own ledger transaction:
 *
 *   prepareLenderSigning  what the lender must sign for one payee
 *   confirmLenderSigning  check what the lender signed against that payment
 *   releasePayment        pay one payee once both draw conditions are recorded
 */

import { Wallet, decode } from 'xrpl'
import type { Client } from 'xrpl'
import { getConnectedClient } from './client'
import { escrowConditionFor, finishDrawEscrow, isTestnet } from './escrow'
import {
  buildLenderEscrowCreate, buildReleasePayment, countersignAndSubmit, finishTokenEscrow,
  issuerAllowsEscrow, ledgerErrorCode, loanTickets, SlotUsedUp, tokenAmount, tokenBalance, usdValue, verifyLenderEscrow,
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

/** The release condition for one payee's escrow: bound to the draw AND the payment. */
function paymentCondition(drawRequestId: string, paymentId: string) {
  return escrowConditionFor(`${drawRequestId}:${paymentId}`)
}

/**
 * The payee's wallet cannot be paid yet (no trust line for the token). Not an
 * error in the draw: that payee is put on hold and the others go ahead.
 */
export class PayeeNotReady extends Error {}

/**
 * What the lender signed is definitely not what was asked (wrong wallet,
 * wrong transaction, or the ledger refused it). Any OTHER error while
 * confirming a signature is treated as "not ready yet": the signature may be
 * perfectly good, so it must never be thrown away because of a network blip.
 */
export class SigningMismatch extends Error {}

export interface SigningPlan {
  method: 'token_escrow' | 'two_signature'
  /** the transaction the lender signs */
  txjson: Tx
  /** two_signature: the lender signs as one of two signers and nothing is submitted yet */
  multisign: boolean
  releaseTicket: number | null
  /** token_escrow: when an unreleased payment can be taken back by the lender */
  cancelAfter: string | null
}

/**
 * Everything is checked on the ledger before the lender is asked to sign, so
 * a request that could not settle never reaches their phone.
 */
export async function prepareLenderSigning(o: {
  method: 'token_escrow' | 'two_signature'
  drawRequestId: string
  paymentId: string
  amountUsd: number
  lenderWallet: string
  payee: string
  loanAccount?: string | null
  /** tickets already promised to other pending payments on this loan */
  ticketsInUse?: number[]
  /** dollars already committed to other payments on this loan */
  committedUsd?: number
}): Promise<SigningPlan> {
  assertNetworkAllowed()
  const token = settlementToken()
  usdValue(o.amountUsd)

  return withClient(async (client) => {
    // A wallet that does not exist on the ledger yet, or a mistyped address,
    // is that payee's problem alone: it is held, and the others go ahead.
    let payeeLine: string | null
    try {
      payeeLine = await tokenBalance(client, o.payee, token)
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err)
      if (/actNotFound|Account not found|actMalformed|malformed|invalid/i.test(m)) {
        throw new PayeeNotReady('This wallet is not active on the ledger yet, or its address is not valid')
      }
      throw err
    }
    if (payeeLine === null) {
      throw new PayeeNotReady('This wallet is not set up to receive the settlement token yet')
    }

    if (o.method === 'token_escrow') {
      if (!(await issuerAllowsEscrow(client, token.issuer))) {
        throw new Error('The token\'s issuer has not enabled escrow for it. Use the two-signature method for this loan.')
      }
      const balance = Number(await tokenBalance(client, o.lenderWallet, token) ?? 0)
      if (balance < o.amountUsd) {
        throw new Error(`The lender\'s wallet holds ${balance.toFixed(2)}, less than this payment of ${o.amountUsd.toFixed(2)}`)
      }
      const cancelAfter = cancelAfterDate()
      return {
        method: 'token_escrow', multisign: false, releaseTicket: null, cancelAfter: cancelAfter.toISOString(),
        txjson: buildLenderEscrowCreate({
          lender: o.lenderWallet, payee: o.payee, token, usd: o.amountUsd,
          condition: paymentCondition(o.drawRequestId, o.paymentId).condition,
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
        ((o.committedUsd ?? 0) > 0 ? `, of which ${(o.committedUsd ?? 0).toFixed(2)} is committed to other approved payments` : '') +
        `. That is not enough for this payment; the lender needs to deposit first.`)
    }
    const used = new Set(o.ticketsInUse ?? [])
    const ticket = (await loanTickets(client, o.loanAccount)).find(t => !used.has(t))
    if (ticket === undefined) throw new Error('The loan account has no free release slots left')
    return {
      method: 'two_signature', multisign: true, releaseTicket: ticket, cancelAfter: null,
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
 * The lender signed in their wallet. Before the payment is recorded as locked,
 * what they signed is checked against it: on the ledger for an escrow, field
 * by field for a two-signature release.
 */
export async function confirmLenderSigning(o: {
  method: 'token_escrow' | 'two_signature'
  drawRequestId: string
  paymentId: string
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
    throw new SigningMismatch('The request was signed by a different wallet than the lender\'s registered wallet')
  }

  if (o.method === 'two_signature') {
    if (!o.hex) throw new Error('The wallet did not return the signed transaction')
    const problems = verifyLenderSignedRelease(o.hex, o.requestedTx, o.lenderWallet)
    if (problems.length) throw new SigningMismatch(`The signed release does not match the payment: ${problems.join('; ')}`)
    return { lenderSignedBlob: o.hex }
  }

  if (!o.txid) throw new Error('The wallet did not return a transaction hash')
  const token = settlementToken()
  return withClient(async (client) => {
    let found: Tx | null = null
    for (let i = 0; i < 14 && !found; i++) {
      try {
        const res = await client.request({ command: 'tx', transaction: o.txid as string })
        const r = res.result as unknown as Tx
        if (r.validated) found = r
      } catch { /* not in a validated ledger yet */ }
      if (!found) await new Promise(res => setTimeout(res, 1500))
    }
    if (!found) {
      // Not there yet, or never will be? A signed transaction names the last
      // ledger it can enter. Once the validated ledger is past that and the
      // ledger itself says it has no such transaction, it is dead for good
      // and nothing was locked. Short of that certainty, keep waiting.
      let last = 0
      try { last = Number((decode(o.hex ?? '') as Tx).LastLedgerSequence ?? 0) } catch { /* no usable copy of the signed transaction */ }
      if (last > 0) {
        const validated = await client.getLedgerIndex()
        if (validated > last + 3) {
          try {
            const res = await client.request({ command: 'tx', transaction: o.txid as string })
            const r = res.result as unknown as Tx
            if (r.validated) found = r
          } catch (err) {
            if (ledgerErrorCode(err) === 'txnNotFound') {
              throw new SigningMismatch('The signed escrow never reached the ledger and no longer can. Nothing was locked.')
            }
          }
        }
      }
      if (!found) throw new Error('The escrow transaction is not on the ledger yet. Try again in a moment.')
    }
    const txj = (found.tx_json ?? found) as Tx
    const meta = found.meta as Tx | undefined
    if (meta?.TransactionResult !== 'tesSUCCESS') throw new SigningMismatch(`The escrow transaction failed on the ledger: ${String(meta?.TransactionResult)}`)
    const sequence = Number(txj.Sequence)
    const problems = await verifyLenderEscrow(client, {
      owner: o.lenderWallet, sequence, payee: o.payee, token, usd: o.amountUsd,
      condition: paymentCondition(o.drawRequestId, o.paymentId).condition,
      minCancelAfter: new Date(Date.now() + 24 * 60 * 60 * 1000),
    })
    if (problems.length) throw new SigningMismatch(`The escrow does not match the payment: ${problems.join('; ')}`)
    return { escrowOwner: o.lenderWallet, escrowSequence: sequence, escrowTxnHash: o.txid as string }
  })
}

/**
 * This payment's signed release can never be used (the ledger used up its
 * slot without paying). Nothing is owed on it and nothing is locked by it;
 * the lender has to sign for this payee again.
 */
export class ReleaseNeedsNewSignature extends Error {}

/**
 * The ledger gave a final refusal to release this payee's escrow (the payee
 * closed the trust line, or no longer accepts payments, or the escrow is
 * gone). The escrow, if still there, stays locked. Not a failure of the draw:
 * this payee goes on hold and the others are paid and reported.
 */
export class PaymentCannotRelease extends Error {}

/**
 * token_escrow: an escrow already on the ledger for this payment. Its release
 * condition is unique to the payment, so an escrow from the lender carrying
 * it can only be this payment's. Used to pick up an escrow whose sign request
 * was lost track of, instead of asking the lender to lock the money again.
 * A failed ledger read throws: no answer is never taken as "none".
 */
export async function findExistingEscrow(o: {
  drawRequestId: string
  paymentId: string
  amountUsd: number
  lenderWallet: string
  payee: string
}): Promise<SigningProof | null> {
  const token = settlementToken()
  const want = paymentCondition(o.drawRequestId, o.paymentId).condition.toUpperCase()
  return withClient(async (client) => {
    let marker: unknown = undefined
    for (let page = 0; page < 20; page++) {
      const res = await client.request({
        command: 'account_objects', account: o.lenderWallet, type: 'escrow', ledger_index: 'validated', limit: 200,
        ...(marker ? { marker } : {}),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)
      const result = res.result as unknown as { account_objects?: Tx[]; marker?: unknown }
      for (const obj of result.account_objects ?? []) {
        if (obj.Account !== o.lenderWallet || String(obj.Condition ?? '').toUpperCase() !== want) continue
        const created = await client.request({ command: 'tx', transaction: String(obj.PreviousTxnID) })
        const r = created.result as unknown as Tx
        const txj = (r.tx_json ?? r) as Tx
        if (txj.TransactionType !== 'EscrowCreate') continue
        const sequence = Number(txj.Sequence) || Number(txj.TicketSequence)
        const problems = await verifyLenderEscrow(client, {
          owner: o.lenderWallet, sequence, payee: o.payee, token, usd: o.amountUsd, condition: want,
          minCancelAfter: new Date(Date.now() + 60 * 60 * 1000),
        })
        if (problems.length) continue
        return { escrowOwner: o.lenderWallet, escrowSequence: sequence, escrowTxnHash: String(r.hash ?? obj.PreviousTxnID) }
      }
      marker = result.marker
      if (!marker) return null
    }
    throw new Error('The lender\'s wallet holds too many escrows to search in one go')
  })
}

/** One payee's payment, with what is needed to release it. */
export interface ReleasablePayment {
  id: string
  draw_request_id: string
  wallet: string
  amount: number | string
  escrow_owner?: string | null
  escrow_sequence?: number | null
  /** two_signature, from payment_signatures */
  lender_sign_tx?: Tx | null
  lender_signed_blob?: string | null
}

/**
 * Pay one payee. Called by the orchestrator when both draw conditions are
 * recorded. Nothing is taken on trust at this point: BuildChain's signature
 * (or its fulfillment) is the last lock.
 */
export async function releasePayment(
  payment: ReleasablePayment,
  method: 'token_escrow' | 'two_signature',
  lenderWallet: string | null,
  /** a ledger connection the caller already holds (it stays open); otherwise one is opened for this payment */
  shared?: Client,
): Promise<{ txnHash: string }> {
  assertNetworkAllowed()
  const onLedger = <T>(fn: (client: Client) => Promise<T>): Promise<T> => (shared ? fn(shared) : withClient(fn))

  if (method === 'token_escrow') {
    if (payment.escrow_sequence == null || !payment.escrow_owner) throw new Error('This payment has no lender escrow to release')
    const { condition, fulfillment } = paymentCondition(payment.draw_request_id, payment.id)
    try {
      const done = await onLedger(client => finishTokenEscrow(client, platformWallet(), {
        owner: payment.escrow_owner as string, sequence: payment.escrow_sequence as number,
        condition, fulfillment, drawRequestId: payment.draw_request_id,
      }))
      return { txnHash: done.hash }
    } catch (err) {
      // A "tec" code is the ledger's final answer from a validated ledger.
      const code = /^(tec[A-Z_]+)/.exec(err instanceof Error ? err.message : String(err))?.[1]
      if (code) {
        throw new PaymentCannotRelease(code === 'tecNO_TARGET'
          ? 'This escrow is no longer on the ledger and it was not released by BuildChain'
          : `The ledger refused to release this escrow to the payee (${code})`)
      }
      throw err
    }
  }

  if (!payment.lender_signed_blob || !payment.lender_sign_tx || !lenderWallet) {
    throw new Error('The lender has not signed this payment\'s release')
  }
  // The stored request must be this payment (payee and amount as recorded, in
  // the settlement token), and the signed transaction must be exactly that
  // request, signed by the lender alone.
  const requested = payment.lender_sign_tx
  const amount = requested.Amount as { currency?: string; issuer?: string; value?: string } | undefined
  const token = settlementToken()
  const cents = (v: unknown) => Math.round(Number(v) * 100)
  if (requested.TransactionType !== 'Payment' || requested.Destination !== payment.wallet ||
      !amount || typeof amount !== 'object' || amount.issuer !== token.issuer ||
      amount.currency !== tokenAmount(token, 1).currency ||
      !Number.isFinite(Number(amount.value)) || cents(amount.value) !== cents(payment.amount)) {
    throw new Error('The signed release on file is not this payment, so it was not released')
  }
  const problems = verifyLenderSignedRelease(payment.lender_signed_blob, requested, lenderWallet)
  if (problems.length) throw new Error(`The lender's signature no longer matches the payment: ${problems.join('; ')}`)
  try {
    const done = await onLedger(client => countersignAndSubmit(client, platformWallet(), payment.lender_signed_blob as string))
    return { txnHash: done.hash }
  } catch (err) {
    // Only a definite answer from the ledger's history (SlotUsedUp) sends the
    // payee back for a new signature. Anything unclear stays as it is.
    if (err instanceof SlotUsedUp) throw new ReleaseNeedsNewSignature(err.message)
    throw err
  }
}

/** The pilot method: finish the draw's single test escrow. */
export async function releaseDraw(draw: {
  id: string
  escrow_sequence?: number | null
  escrow_finish_after?: string | null
}, trigger: 'manual' | 'orchestrator'): Promise<{ txnHash: string }> {
  if (draw.escrow_sequence == null) throw new Error('This draw has no escrow to release')
  // The escrow cannot be finished before its hold period ends (30 seconds by
  // default). Both conditions can be met sooner than that: wait it out
  // rather than fail, since nothing would try again.
  const wait = draw.escrow_finish_after ? new Date(draw.escrow_finish_after).getTime() + 4000 - Date.now() : 0
  if (wait > 0 && wait <= 45000) await new Promise(res => setTimeout(res, wait))
  return finishDrawEscrow({ escrowSequence: draw.escrow_sequence, drawRequestId: draw.id, trigger })
}
