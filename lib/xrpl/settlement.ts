/**
 * Dollar-token settlement on the XRP Ledger (RLUSD).
 *
 * Draws are dollar amounts and the company's ruling (2026-11-27) is that real
 * settlement is in RLUSD. This file holds the two release methods, built so
 * that BuildChain never holds the lender's funds or keys:
 *
 *   A. Native token escrow (TokenEscrow / XLS-85).
 *      The LENDER signs an EscrowCreate from its own wallet. The escrow pays
 *      the contractor, carries BuildChain's crypto-condition and a CancelAfter
 *      date. BuildChain releases it by submitting EscrowFinish with the
 *      fulfillment once both draw conditions are recorded. Needs the token's
 *      issuer to have enabled Allow Trust Line Locking; the mainnet RLUSD
 *      issuer has not (checked 2026-11-27).
 *
 *   B. Two-signature loan account.
 *      One ledger account per loan whose master key is disabled and whose
 *      signer list is {lender, BuildChain}, quorum 2. The lender deposits
 *      RLUSD. At approval the lender signs the release payment; BuildChain
 *      adds the second signature only when both draw conditions are recorded.
 *      Works with RLUSD on mainnet today. Limits: returning unreleased funds
 *      also needs both signatures (there is no ledger-enforced deadline).
 *
 * Nothing here reads environment variables or the database: callers pass a
 * connected client and plain values, so both methods can be proved on the
 * test network by scripts/prove-rlusd-settlement.js. The app's approve and
 * release routes do not call this file yet.
 */

import { multisign } from 'xrpl'
import type { Client, Wallet } from 'xrpl'

const RIPPLE_EPOCH = 946684800
/** lsfAllowTrustLineLocking: the issuer lets its token be held in escrow. */
const LSF_ALLOW_TRUST_LINE_LOCKING = 0x40000000
/** asfAllowTrustLineLocking, for AccountSet.SetFlag. */
export const ASF_ALLOW_TRUST_LINE_LOCKING = 17
const ASF_DISABLE_MASTER = 4
const LSF_DISABLE_MASTER = 0x00100000

export interface TokenSpec {
  /** 'USD', 'RLUSD', or a 40-character hex currency code */
  currency: string
  issuer: string
}

type Tx = Record<string, unknown>

// ── Amounts ───────────────────────────────────────────────────────────────────

/** XRPL currency code: 3 characters as-is, anything else as 40 hex characters. */
export function currencyCode(code: string): string {
  if (/^[0-9A-Fa-f]{40}$/.test(code)) return code.toUpperCase()
  if (code.length === 3) return code
  if (code.length > 20) throw new Error(`Currency code too long: ${code}`)
  return Buffer.from(code, 'ascii').toString('hex').toUpperCase().padEnd(40, '0')
}

/** A dollar amount as the ledger's token value: whole cents, never rounded up silently. */
export function usdValue(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) throw new Error(`Not a positive dollar amount: ${usd}`)
  const cents = Math.round(usd * 100)
  if (Math.abs(usd * 100 - cents) > 1e-6) throw new Error(`Dollar amount has fractions of a cent: ${usd}`)
  return (cents / 100).toFixed(2)
}

export function tokenAmount(token: TokenSpec, usd: number) {
  return { currency: currencyCode(token.currency), issuer: token.issuer, value: usdValue(usd) }
}

export function toRippleTime(date: Date): number {
  return Math.floor(date.getTime() / 1000) - RIPPLE_EPOCH
}

function memo(data: Record<string, unknown>) {
  const hex = (s: string) => Buffer.from(s, 'utf8').toString('hex').toUpperCase()
  return [{ Memo: { MemoType: hex('application/json'), MemoData: hex(JSON.stringify(data)) } }]
}

// ── Ledger reads ──────────────────────────────────────────────────────────────

/** Has the token's issuer enabled Allow Trust Line Locking (required for method A)? */
export async function issuerAllowsEscrow(client: Client, issuer: string): Promise<boolean> {
  const info = await client.request({ command: 'account_info', account: issuer, ledger_index: 'validated' })
  const flags = Number((info.result.account_data as unknown as { Flags: number }).Flags)
  // Bit 30 set; compare as unsigned.
  return ((flags >>> 0) & LSF_ALLOW_TRUST_LINE_LOCKING) !== 0
}

/** The account's balance of the token, or null when it has no trust line for it. */
export async function tokenBalance(client: Client, account: string, token: TokenSpec): Promise<string | null> {
  const res = await client.request({
    command: 'account_lines', account, peer: token.issuer, ledger_index: 'validated',
  })
  const code = currencyCode(token.currency)
  const line = (res.result.lines as Array<{ currency: string; balance: string }>).find(l => l.currency === code)
  return line ? line.balance : null
}

/** Submit a signed blob and wait until it is in a validated ledger. */
export async function submitAndConfirm(client: Client, txBlob: string): Promise<{ hash: string; result: string; meta: Tx }> {
  const sub = await client.request({ command: 'submit', tx_blob: txBlob })
  const r = sub.result as unknown as { engine_result: string; engine_result_message?: string; tx_json: { hash: string } }
  const first = r.engine_result
  if (!(first === 'tesSUCCESS' || first === 'terQUEUED' || first.startsWith('tec'))) {
    throw new Error(`${first}: ${r.engine_result_message ?? 'transaction was not accepted'}`)
  }
  const hash = r.tx_json.hash
  for (let i = 0; i < 30; i++) {
    await new Promise(res => setTimeout(res, 1500))
    try {
      const tx = await client.request({ command: 'tx', transaction: hash })
      const t = tx.result as unknown as { validated?: boolean; meta?: Tx }
      if (t.validated) {
        const result = String(t.meta?.TransactionResult)
        if (result !== 'tesSUCCESS') throw new Error(result)
        return { hash, result, meta: t.meta as Tx }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (/^te[cfm]/.test(msg)) throw err
      // txnNotFound: not validated yet
    }
  }
  throw new Error(`Transaction ${hash} was not validated in time`)
}

async function signSubmit(client: Client, wallet: Wallet, tx: Tx): Promise<{ hash: string; meta: Tx; sequence: number }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prepared = await client.autofill(tx as any)
  const { tx_blob } = wallet.sign(prepared)
  const done = await submitAndConfirm(client, tx_blob)
  return { hash: done.hash, meta: done.meta, sequence: Number((prepared as unknown as Tx).Sequence) }
}

// ── Method A: native token escrow, funded and signed by the lender ───────────

/**
 * The EscrowCreate the LENDER signs in its own wallet. BuildChain only builds
 * it. A token escrow must carry CancelAfter; the condition makes it releasable
 * only with BuildChain's fulfillment.
 */
export function buildLenderEscrowCreate(o: {
  lender: string
  payee: string
  token: TokenSpec
  usd: number
  condition: string
  cancelAfter: Date
  finishAfter?: Date
  drawRequestId?: string
}): Tx {
  return {
    TransactionType: 'EscrowCreate',
    Account: o.lender,
    Destination: o.payee,
    Amount: tokenAmount(o.token, o.usd),
    Condition: o.condition.toUpperCase(),
    CancelAfter: toRippleTime(o.cancelAfter),
    ...(o.finishAfter ? { FinishAfter: toRippleTime(o.finishAfter) } : {}),
    Memos: memo({ platform: 'BuildChain', event: 'escrow_create', drid: o.drawRequestId ?? null, usd: usdValue(o.usd) }),
  }
}

/**
 * Before BuildChain records a draw as escrowed, it checks the escrow the
 * lender created against what was agreed. Returns every mismatch found.
 */
export async function verifyLenderEscrow(client: Client, o: {
  owner: string
  sequence: number
  payee: string
  token: TokenSpec
  usd: number
  condition: string
  /** the escrow must stay cancellable no earlier than this */
  minCancelAfter?: Date
}): Promise<string[]> {
  let node: Tx
  try {
    const entry = await client.request({
      command: 'ledger_entry', escrow: { owner: o.owner, seq: o.sequence }, ledger_index: 'validated',
    })
    node = entry.result.node as unknown as Tx
  } catch {
    return ['No escrow with that owner and sequence is on the ledger']
  }
  const problems: string[] = []
  const want = tokenAmount(o.token, o.usd)
  const amt = node.Amount as { currency?: string; issuer?: string; value?: string } | string
  if (typeof amt === 'string') {
    problems.push('The escrow holds XRP, not the settlement token')
  } else {
    if (amt.currency !== want.currency || amt.issuer !== want.issuer) problems.push('The escrow holds a different token')
    if (Number(amt.value) !== Number(want.value)) problems.push(`The escrow holds ${amt.value}, not ${want.value}`)
  }
  if (node.Destination !== o.payee) problems.push('The escrow pays a different account')
  if (String(node.Condition ?? '').toUpperCase() !== o.condition.toUpperCase()) problems.push('The escrow does not carry BuildChain\'s release condition')
  if (o.minCancelAfter && Number(node.CancelAfter ?? 0) < toRippleTime(o.minCancelAfter)) problems.push('The escrow can be cancelled too early')
  return problems
}

/** BuildChain releases the lender's escrow by revealing the fulfillment. Any account may submit this. */
export async function finishTokenEscrow(client: Client, releaser: Wallet, o: {
  owner: string
  sequence: number
  condition: string
  fulfillment: string
  drawRequestId?: string
}): Promise<{ hash: string }> {
  const done = await signSubmit(client, releaser, {
    TransactionType: 'EscrowFinish',
    Account: releaser.address,
    Owner: o.owner,
    OfferSequence: o.sequence,
    Condition: o.condition.toUpperCase(),
    Fulfillment: o.fulfillment.toUpperCase(),
    Memos: memo({ platform: 'BuildChain', event: 'escrow_finish', drid: o.drawRequestId ?? null }),
  })
  return { hash: done.hash }
}

// ── Method B: two-signature loan account ──────────────────────────────────────

/**
 * Turns a freshly funded account into a loan account: a trust line for the
 * token, a {lender, BuildChain} signer list with quorum 2, a batch of tickets
 * (one per future release), and then the master key disabled, after which the
 * key that created it controls nothing.
 */
export async function setUpLoanAccount(client: Client, loanWallet: Wallet, o: {
  lender: string
  buildchain: string
  token: TokenSpec
  tickets: number
  trustLimit?: string
}): Promise<{ address: string; ticketSequences: number[] }> {
  await signSubmit(client, loanWallet, {
    TransactionType: 'TrustSet',
    Account: loanWallet.address,
    LimitAmount: { currency: currencyCode(o.token.currency), issuer: o.token.issuer, value: o.trustLimit ?? '1000000000' },
  })
  await signSubmit(client, loanWallet, {
    TransactionType: 'SignerListSet',
    Account: loanWallet.address,
    SignerQuorum: 2,
    SignerEntries: [
      { SignerEntry: { Account: o.lender, SignerWeight: 1 } },
      { SignerEntry: { Account: o.buildchain, SignerWeight: 1 } },
    ],
  })
  await signSubmit(client, loanWallet, {
    TransactionType: 'TicketCreate',
    Account: loanWallet.address,
    TicketCount: o.tickets,
  })
  await signSubmit(client, loanWallet, {
    TransactionType: 'AccountSet',
    Account: loanWallet.address,
    SetFlag: ASF_DISABLE_MASTER,
  })
  return { address: loanWallet.address, ticketSequences: await loanTickets(client, loanWallet.address) }
}

/** Unused ticket sequences on the loan account, lowest first. */
export async function loanTickets(client: Client, loanAccount: string): Promise<number[]> {
  const res = await client.request({
    command: 'account_objects', account: loanAccount, type: 'ticket', ledger_index: 'validated',
  })
  return (res.result.account_objects as unknown as Array<{ TicketSequence: number }>)
    .map(t => t.TicketSequence).sort((a, b) => a - b)
}

/** What a lender (or anyone) can check on the ledger before depositing. Returns every problem found. */
export async function verifyLoanAccount(client: Client, loanAccount: string, o: {
  lender: string
  buildchain: string
  token: TokenSpec
}): Promise<string[]> {
  const problems: string[] = []
  const info = await client.request({
    command: 'account_info', account: loanAccount, ledger_index: 'validated', signer_lists: true,
  })
  const data = info.result.account_data as unknown as Tx
  if (((Number(data.Flags) >>> 0) & LSF_DISABLE_MASTER) === 0) problems.push('The master key is still enabled')
  if (data.RegularKey) problems.push('A regular key is set')
  const lists = ((info.result as unknown as Tx).signer_lists ?? (data as Tx).signer_lists ?? []) as Array<{
    SignerQuorum: number; SignerEntries: Array<{ SignerEntry: { Account: string; SignerWeight: number } }>
  }>
  const list = lists[0]
  if (!list) {
    problems.push('No signer list')
  } else {
    const signers = list.SignerEntries.map(e => e.SignerEntry)
    const ok = list.SignerQuorum === 2 && signers.length === 2 &&
      signers.every(s => s.SignerWeight === 1) &&
      signers.some(s => s.Account === o.lender) && signers.some(s => s.Account === o.buildchain)
    if (!ok) problems.push('The signer list is not exactly {lender, BuildChain} with both required')
  }
  if ((await tokenBalance(client, loanAccount, o.token)) === null) problems.push('No trust line for the settlement token')
  return problems
}

/**
 * The release payment for one draw, ready to be signed by both signers. It
 * uses a ticket so several draws can be pending at once, and has no expiry so
 * the lender can sign at approval and BuildChain can add its signature later.
 */
export function buildReleasePayment(o: {
  loanAccount: string
  payee: string
  token: TokenSpec
  usd: number
  ticketSequence: number
  drawRequestId?: string
  /** drops; a two-signature transaction costs three times the base fee */
  fee?: string
}): Tx {
  return {
    TransactionType: 'Payment',
    Account: o.loanAccount,
    Destination: o.payee,
    Amount: tokenAmount(o.token, o.usd),
    Sequence: 0,
    TicketSequence: o.ticketSequence,
    Fee: o.fee ?? '1000',
    SigningPubKey: '',
    Memos: memo({ platform: 'BuildChain', event: 'draw_release', drid: o.drawRequestId ?? null, usd: usdValue(o.usd) }),
  }
}

/** One signer's signature over a transaction (the lender's wallet does the same thing on its side). */
export function signAsSigner(signer: Wallet, tx: Tx): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return signer.sign(tx as any, true).tx_blob
}

/** Combine the signers' blobs and submit. Fails on the ledger unless the quorum is met. */
export async function submitMultisigned(client: Client, signedBlobs: string[]): Promise<{ hash: string }> {
  const combined = signedBlobs.length > 1 ? multisign(signedBlobs) : signedBlobs[0]
  const done = await submitAndConfirm(client, combined)
  return { hash: done.hash }
}
