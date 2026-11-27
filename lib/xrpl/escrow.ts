import { createHash, createHmac } from 'crypto'
import { Wallet, xrpToDrops } from 'xrpl'
import type { EscrowCreate, EscrowFinish } from 'xrpl'
import { getConnectedClient } from './client'
import { nftUriHex, networkLabel } from './nft-uri'

// ── Settlement currency ───────────────────────────────────────────────────────
// Draw amounts are always recorded in US dollars. The company's ruling
// (2026-11-27) is that real settlement is in RLUSD, Ripple's dollar stablecoin.
//
// What the ledger allows today (checked on-ledger 2026-11-27):
//   - The TokenEscrow amendment is enabled on mainnet and testnet, so an
//     escrow can hold an issued token, but only when the token's issuer has
//     set the AllowTrustLineLocking flag on its account.
//   - The mainnet RLUSD issuer has NOT set that flag, so RLUSD cannot be
//     locked in a native escrow yet.
//
// So this file escrows XRP, and only on the test network, where each draw
// locks 1 test XRP as a stand-in. Mainnet escrow is refused (see
// assertNetworkAllowed) until RLUSD settlement is built and switched on.
export const ESCROW_CURRENCY = 'XRP'

/** True when XRPL_NETWORK points at the test network (the default). */
export function isTestnet(): boolean {
  const network = process.env.XRPL_NETWORK ?? ''
  return !network || network.includes('altnet') || network.includes('testnet')
}

/**
 * Real-money guard. The platform wallet must never lock mainnet funds by
 * accident: an XRP escrow would expose the contract amount to XRP's price,
 * and the company has ruled that settlement is in RLUSD.
 */
function assertNetworkAllowed(): void {
  if (!isTestnet()) {
    throw new Error(
      'Mainnet escrow is switched off: BuildChain settles in RLUSD, and RLUSD ' +
      'settlement is not live yet. XRPL_NETWORK must point at the test network.'
    )
  }
}

// ── Release condition ─────────────────────────────────────────────────────────
// A time-only escrow can be finished by ANY account once FinishAfter passes.
// Each draw's escrow therefore also carries a PREIMAGE-SHA-256 crypto-condition
// whose fulfillment only BuildChain's server can produce. The 32-byte preimage
// is derived from the platform wallet seed and the draw id, so nothing extra
// is stored and it can always be re-derived at release time.
function escrowPreimage(drawRequestId: string): Buffer {
  const seed = process.env.XRPL_WALLET_SEED
  if (!seed) throw new Error('XRPL_WALLET_SEED is not set in environment variables')
  return createHmac('sha256', seed).update(`buildchain:escrow-condition:${drawRequestId}`).digest()
}

/** DER-encoded PREIMAGE-SHA-256 condition and fulfillment (uppercase hex). */
export function escrowConditionFor(drawRequestId: string): { condition: string; fulfillment: string } {
  const preimage = escrowPreimage(drawRequestId)
  const fingerprint = createHash('sha256').update(preimage).digest()
  return {
    // A0 25 | 80 20 <fingerprint> | 81 01 <cost = 32>
    condition: ('A0258020' + fingerprint.toString('hex') + '810120').toUpperCase(),
    // A0 22 | 80 20 <preimage>
    fulfillment: ('A0228020' + preimage.toString('hex')).toUpperCase(),
  }
}
// Ripple epoch offset: Jan 1 2000 00:00:00 UTC = Unix 946684800
const RIPPLE_EPOCH = 946684800

// Helper: UTF-8 string → uppercase hex (XRPL Memo encoding)
function toHex(str: string): string {
  return Buffer.from(str, 'utf8').toString('hex').toUpperCase()
}

function toRippleTime(unixMs: number): number {
  return Math.floor(unixMs / 1000) - RIPPLE_EPOCH
}

function getPlatformWallet(): Wallet {
  const seed = process.env.XRPL_WALLET_SEED
  if (!seed) throw new Error('XRPL_WALLET_SEED is not set in environment variables')
  return Wallet.fromSeed(seed)
}

function getDestinationAddress(): string {
  const addr = process.env.XRPL_DEFAULT_DESTINATION
  if (!addr) throw new Error('XRPL_DEFAULT_DESTINATION is not set in environment variables')
  return addr
}

/**
 * Creates the XRPL escrow for an approved draw (test network only).
 *
 * The escrow locks 1 test XRP as a stand-in for the draw; the dollar amount
 * of the draw is recorded in the on-ledger memo. It carries three locks:
 *   - FinishAfter: cannot be released before the hold period ends.
 *   - Condition:   can only be released with BuildChain's fulfillment
 *                  (set when drawRequestId is given, which every caller does).
 *   - CancelAfter: if never released, the funds can be returned to the
 *                  funding wallet after the deadline (default 90 days).
 *
 * Returns the escrow sequence number (needed to finish later) and tx hash.
 */
export async function createDrawEscrow({
  destinationAddress,
  finishAfterSeconds,
  drawAmountUsd,
  drawRequestId,
  projectId,
}: {
  destinationAddress?: string
  finishAfterSeconds?: number
  /** USD value of the draw — recorded in the on-ledger memo */
  drawAmountUsd?: number
  /** Draw Request ID — recorded in on-ledger Memo and bound into the release condition */
  drawRequestId?: string
  /** Project ID — recorded in on-ledger Memo */
  projectId?: string
}): Promise<{ escrowSequence: number; txnHash: string; finishAfter: Date; cancelAfter: Date }> {
  assertNetworkAllowed()

  const wallet = getPlatformWallet()
  const destination = destinationAddress ?? getDestinationAddress()
  const delaySeconds = finishAfterSeconds ??
    parseInt(process.env.XRPL_ESCROW_FINISH_AFTER_SECONDS ?? '30', 10)
  const cancelDays = Math.max(
    1, parseInt(process.env.XRPL_ESCROW_CANCEL_AFTER_DAYS ?? '90', 10) || 90)

  const finishAfterMs = Date.now() + delaySeconds * 1000
  const cancelAfterMs = finishAfterMs + cancelDays * 24 * 60 * 60 * 1000

  // Test network: every draw locks exactly 1 test XRP.
  const amountDrops = xrpToDrops('1')

  // On-ledger audit memo — immutable record of escrow creation (Patent §VII)
  const auditMemo = {
    platform: 'BuildChain',
    event: 'escrow_create',
    drid: drawRequestId ?? null,
    project_id: projectId ?? null,
    usd: drawAmountUsd ?? null,
    currency: ESCROW_CURRENCY,
    cancel_after: new Date(cancelAfterMs).toISOString(),
    ts: new Date().toISOString(),
  }

  const client = await getConnectedClient()
  try {
    const txTemplate: EscrowCreate = {
      TransactionType: 'EscrowCreate',
      Account: wallet.address,
      Destination: destination,
      Amount: amountDrops,
      FinishAfter: toRippleTime(finishAfterMs),
      CancelAfter: toRippleTime(cancelAfterMs),
      ...(drawRequestId ? { Condition: escrowConditionFor(drawRequestId).condition } : {}),
      Memos: [{
        Memo: {
          MemoType: toHex('application/json'),
          MemoData: toHex(JSON.stringify(auditMemo)),
        },
      }],
    }

    const prepared = await client.autofill(txTemplate)
    const escrowSequence = prepared.Sequence as number

    const { tx_blob, hash } = wallet.sign(prepared)
    const result = await client.submitAndWait(tx_blob)

    const txResult = (result.result.meta as Record<string, unknown>)?.TransactionResult
    if (txResult !== 'tesSUCCESS') {
      throw new Error(`EscrowCreate failed: ${String(txResult)}`)
    }

    return {
      escrowSequence,
      txnHash: hash,
      finishAfter: new Date(finishAfterMs),
      cancelAfter: new Date(cancelAfterMs),
    }
  } finally {
    await client.disconnect()
  }
}

/**
 * Finishes (releases) a previously created escrow.
 * Sends the escrowed XRP to the original Destination address.
 *
 * Must be called after the escrow's FinishAfter time has passed. When the
 * escrow carries a release condition, the fulfillment is re-derived from the
 * draw id; an escrow made before conditions were added finishes without one.
 * Returns the EscrowFinish transaction hash.
 */
export async function finishDrawEscrow({
  escrowSequence,
  drawRequestId,
  trigger,
}: {
  escrowSequence: number
  /** Draw Request ID — recorded in on-ledger Memo and used to derive the fulfillment */
  drawRequestId?: string
  /** What triggered the finish: 'manual' (lender clicked Fund) or 'orchestrator' (dual-condition auto) */
  trigger?: 'manual' | 'orchestrator'
}): Promise<{ txnHash: string }> {
  const wallet = getPlatformWallet()

  // On-ledger audit memo for the EscrowFinish — records the dual-condition
  // satisfaction event referenced in Patent §V (Verification Orchestrator)
  const auditMemo = {
    platform: 'BuildChain',
    event: 'escrow_finish',
    drid: drawRequestId ?? null,
    trigger: trigger ?? 'manual',
    currency: ESCROW_CURRENCY,
    ts: new Date().toISOString(),
  }

  const client = await getConnectedClient()
  try {
    // Read the escrow as it stands on the ledger to learn whether it is
    // condition-locked.
    let ledgerCondition: string | null = null
    try {
      const entry = await client.request({
        command: 'ledger_entry',
        escrow: { owner: wallet.address, seq: escrowSequence },
        ledger_index: 'validated',
      })
      const node = entry.result.node as unknown as Record<string, unknown> | undefined
      ledgerCondition = typeof node?.Condition === 'string' ? node.Condition.toUpperCase() : null
    } catch (lookupErr) {
      const msg = lookupErr instanceof Error ? lookupErr.message : String(lookupErr)
      throw new Error(`Escrow ${escrowSequence} was not found on the ledger (${msg.slice(0, 120)})`)
    }

    let conditionFields: { Condition?: string; Fulfillment?: string } = {}
    if (ledgerCondition) {
      if (!drawRequestId) {
        throw new Error('This escrow is condition-locked; its draw id is needed to release it')
      }
      const { condition, fulfillment } = escrowConditionFor(drawRequestId)
      if (condition !== ledgerCondition) {
        throw new Error('The escrow on the ledger does not carry this draw\'s release condition')
      }
      conditionFields = { Condition: condition, Fulfillment: fulfillment }
    }

    const txTemplate: EscrowFinish = {
      TransactionType: 'EscrowFinish',
      Account: wallet.address,
      Owner: wallet.address,
      OfferSequence: escrowSequence,
      ...conditionFields,
      Memos: [{
        Memo: {
          MemoType: toHex('application/json'),
          MemoData: toHex(JSON.stringify(auditMemo)),
        },
      }],
    }

    const prepared = await client.autofill(txTemplate)
    const { tx_blob, hash } = wallet.sign(prepared)
    const result = await client.submitAndWait(tx_blob)

    const txResult = (result.result.meta as Record<string, unknown>)?.TransactionResult
    if (txResult !== 'tesSUCCESS') {
      throw new Error(`EscrowFinish failed: ${String(txResult)}`)
    }

    return { txnHash: hash }
  } finally {
    await client.disconnect()
  }
}
// ── XLS-20 NFT Taxon Registry ─────────────────────────────────────────────────
// Taxon 0: Loan NFTs              (lib/xrpl/nft.ts — minted at origination)
// Taxon 1: Draw event NFTs        (mintDrawNFT below — approval/release records)
// Taxon 2: Lien Waiver NFTs       (mintLienWaiverNFT — Patent §IV)
// Taxon 3: Inspector Credential NFTs (mintInspectorCredentialNFT — Patent §III)

/**
 * Mints an XLS-20 Lien Waiver NFT on the XRPL.
 *
 * Encodes the executed lien waiver instrument as an NFT per the patent's
 * Lien Waiver Token Module (Section IV). The NFT metadata uniquely ties
 * each waiver to a specific Draw Request ID (DRID), preventing reuse.
 *
 * Taxon 2: Lien Waiver NFTs.
 * Non-blocking: caller must wrap in try/catch.
 *
 * Upgrade path: set ipfsDocumentUri to 'ipfs://{CID}' once Pinata is
 * integrated — the CID should point to the signed PDF lien waiver.
 */
export async function mintLienWaiverNFT({
  drawRequestId,
  drawNumber,
  drawAmount,
  waiverType = 'conditional',
  throughDate,
  gcSignatureHash,
  ipfsDocumentUri,
}: {
  drawRequestId: string
  drawNumber: string
  drawAmount: number
  /** 'conditional' at draw submission; 'unconditional' after payment confirmed */
  waiverType?: 'conditional' | 'unconditional'
  /** ISO date string: lien waiver covers work through this date */
  throughDate?: string
  /** SHA-256 hash of the GC-signed lien waiver document */
  gcSignatureHash?: string
  /** IPFS URI pointing to the signed waiver PDF — set once Pinata is integrated */
  ipfsDocumentUri?: string
}): Promise<{ nftTokenId: string; txnHash: string }> {
  const wallet = getPlatformWallet()

  // Patent §IV NFT metadata, compact enough for the 256-byte URI limit.
  // The project is found through the draw (drid).
  const metadata = {
    p: 'BuildChain',
    t: 'lien_waiver',
    // Core DRID link — prevents reuse across draws (Patent §IV)
    drid: drawRequestId,
    draw: String(drawNumber ?? '').slice(0, 24),
    usd: drawAmount,
    waiver: waiverType,
    through: throughDate,  // omitted when unknown
    ts: new Date().toISOString(),
    net: networkLabel(),
  }

  // The signed instrument goes in the memo (memos allow 1 KB): its hash and,
  // once Pinata is integrated, its IPFS location.
  const memo = {
    event: 'lien_waiver_nft_mint',
    drid: drawRequestId,
    ...(gcSignatureHash ? { gc_signature_hash: gcSignatureHash } : {}),
    ...(ipfsDocumentUri ? { ipfs_document_uri: ipfsDocumentUri } : {}),
  }

  const client = await getConnectedClient()
  try {
    const txTemplate = {
      TransactionType: 'NFTokenMint' as const,
      Account: wallet.address,
      URI: nftUriHex(metadata),
      Flags: 8,          // tfTransferable — can be transferred to verification account
      TransferFee: 0,
      NFTokenTaxon: 2,   // BuildChain Lien Waiver taxon
      Memos: [{
        Memo: {
          MemoType: toHex('application/json'),
          MemoData: toHex(JSON.stringify(memo)),
        },
      }],
    }

    const prepared = await client.autofill(txTemplate)
    const { tx_blob, hash } = wallet.sign(prepared)
    const result = await client.submitAndWait(tx_blob)

    const meta = result.result.meta as Record<string, unknown>
    if (meta?.TransactionResult !== 'tesSUCCESS') {
      throw new Error(`NFTokenMint (lien_waiver) failed: ${String(meta?.TransactionResult)}`)
    }

    const nftTokenId = extractNFTokenId(meta)
    if (!nftTokenId) throw new Error('NFTokenID not found in lien waiver mint result')

    return { nftTokenId, txnHash: hash }
  } finally {
    await client.disconnect()
  }
}

/**
 * Mints an XLS-20 Inspector Credential NFT on the XRPL.
 *
 * Implements the Inspector Credential Module (Patent §III) using the
 * XLS-20 NFT standard as the current on-ledger credential mechanism.
 *
 * Upgrade path: when XLS-0070 (Verifiable Credentials) goes XRPL mainnet,
 * replace this with an XLS-0070 credential issuance transaction. The NFT
 * approach is functionally equivalent and available today.
 *
 * Taxon 3: Inspector Credential NFTs.
 * Non-blocking: caller must wrap in try/catch.
 */
export async function mintInspectorCredentialNFT({
  drawRequestId,
  inspectionId,
  bbInspectionResultId,
  passedAt,
}: {
  drawRequestId: string
  /** BuildChain inspections.id — holds the inspector's identity and notes */
  inspectionId: string
  /** Building Block's signed inspection result, when the attestation came from BB */
  bbInspectionResultId?: number | null
  passedAt: string
}): Promise<{ nftTokenId: string; txnHash: string }> {
  const wallet = getPlatformWallet()

  // Patent §III credential metadata, compact enough for the 256-byte URI
  // limit. The inspector, milestone and notes live on the inspection row.
  // Future XLS-0070 upgrade: map these fields to the VC subject/claims structure
  // (issuer_did: 'did:xrpl:1:<wallet_address>').
  const metadata = {
    p: 'BuildChain',
    t: 'inspector_credential',
    // DRID link — ties credential to exact draw request (Patent §III)
    drid: drawRequestId,
    inspection: inspectionId,
    bb: bbInspectionResultId ?? undefined,  // omitted unless from Building Block
    passed: passedAt,
    net: networkLabel(),
  }

  const client = await getConnectedClient()
  try {
    const txTemplate = {
      TransactionType: 'NFTokenMint' as const,
      Account: wallet.address,
      URI: nftUriHex(metadata),
      Flags: 8,          // tfTransferable
      TransferFee: 0,
      NFTokenTaxon: 3,   // BuildChain Inspector Credential taxon
      Memos: [{
        Memo: {
          MemoType: toHex('application/json'),
          MemoData: toHex(JSON.stringify({ event: 'inspector_credential_mint', drid: drawRequestId })),
        },
      }],
    }

    const prepared = await client.autofill(txTemplate)
    const { tx_blob, hash } = wallet.sign(prepared)
    const result = await client.submitAndWait(tx_blob)

    const meta = result.result.meta as Record<string, unknown>
    if (meta?.TransactionResult !== 'tesSUCCESS') {
      throw new Error(`NFTokenMint (inspector_credential) failed: ${String(meta?.TransactionResult)}`)
    }

    const nftTokenId = extractNFTokenId(meta)
    if (!nftTokenId) throw new Error('NFTokenID not found in inspector credential mint result')

    return { nftTokenId, txnHash: hash }
  } finally {
    await client.disconnect()
  }
}

/**
 * Mints an XRPL NFToken as an immutable record of a draw lifecycle event.
 *
 * The NFT URI encodes compact JSON metadata (draw ID, number, amount, event
 * type, timestamp) as uppercase hex — this becomes the permanent on-chain
 * record. The project is found through the draw.
 *
 * On testnet: token visible at https://testnet.xrpl.org/nft/{nftTokenId}
 * Non-blocking: caller must wrap in try/catch.
 */
export async function mintDrawNFT({
  drawRequestId,
  drawNumber,
  drawAmount,
  eventType,
}: {
  drawRequestId: string
  drawNumber: string
  drawAmount: number
  eventType: 'approval' | 'release'
}): Promise<{ nftTokenId: string; txnHash: string }> {
  const wallet = getPlatformWallet()

  const metadata = {
    p: 'BuildChain',
    t: eventType === 'approval' ? 'draw_approval' : 'draw_release',
    drid: drawRequestId,
    draw: String(drawNumber ?? '').slice(0, 24),
    usd: drawAmount,
    ts: new Date().toISOString(),
    net: networkLabel(),
  }

  const client = await getConnectedClient()
  try {
    const txTemplate = {
      TransactionType: 'NFTokenMint' as const,
      Account: wallet.address,
      URI: nftUriHex(metadata),
      Flags: 8,           // tfTransferable — allows future transfer if needed
      TransferFee: 0,
      NFTokenTaxon: 1,    // BuildChain platform taxon
    }

    const prepared = await client.autofill(txTemplate)
    const { tx_blob, hash } = wallet.sign(prepared)
    const result = await client.submitAndWait(tx_blob)

    const meta = result.result.meta as Record<string, unknown>
    const txResult = meta?.TransactionResult
    if (txResult !== 'tesSUCCESS') {
      throw new Error(`NFTokenMint failed: ${String(txResult)}`)
    }

    const nftTokenId = extractNFTokenId(meta)
    if (!nftTokenId) throw new Error('NFTokenID not found in transaction result')

    return { nftTokenId, txnHash: hash }
  } finally {
    await client.disconnect()
  }
}

/**
 * Extract the newly minted NFTokenID from NFTokenMint transaction metadata.
 * Tries the direct field first (xrpl.js v3+), then parses AffectedNodes.
 */
function extractNFTokenId(meta: Record<string, unknown>): string | null {
  // xrpl.js v3+ surfaces this directly
  if (typeof meta.nftoken_id === 'string') return meta.nftoken_id

  // Fallback: find the new token in the modified NFTokenPage
  const nodes = (meta.AffectedNodes as Record<string, unknown>[]) || []
  for (const node of nodes) {
    const modified = (node.ModifiedNode ?? node.CreatedNode) as Record<string, unknown> | undefined
    if (!modified || modified.LedgerEntryType !== 'NFTokenPage') continue

    const finalFields = (modified.FinalFields ?? modified.NewFields) as Record<string, unknown> | undefined
    const nftokens = (finalFields?.NFTokens as Record<string, unknown>[]) || []
    const prevTokens = ((modified.PreviousFields as Record<string, unknown>)?.NFTokens as Record<string, unknown>[]) || []

    const prevIds = new Set(prevTokens.map((t) => (t.NFToken as Record<string, unknown>)?.NFTokenID))
    for (const token of nftokens) {
      const id = (token.NFToken as Record<string, unknown>)?.NFTokenID
      if (typeof id === 'string' && !prevIds.has(id)) return id
    }
  }

  return null
}

/** Check whether XRPL is configured (used to gracefully skip if env vars missing) */
export function isXrplConfigured(): boolean {
  return !!(process.env.XRPL_WALLET_SEED && process.env.XRPL_DEFAULT_DESTINATION)
}
