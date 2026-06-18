import { Wallet, xrpToDrops } from 'xrpl'
import type { EscrowCreate, EscrowFinish } from 'xrpl'
import { getConnectedClient } from './client'
import { usdToXrpDrops } from './price-oracle'

// ── ESCROW_CURRENCY config ─────────────────────────────────────────────────────
// Controls whether escrow uses native XRP or RLUSD (Ripple's USD stablecoin).
//
// CURRENT: 'XRP' — native XRP escrow (EscrowCreate/EscrowFinish).
//   Works on mainnet today. Subject to XRP price volatility.
//
// FUTURE:  'RLUSD' — requires XRPL Hooks smart contracts.
//   XRPL Hooks are currently testnet-only and cannot hold IOUs (like RLUSD)
//   in native escrow. When Hooks go mainnet, update this path to use
//   Hook-based RLUSD conditional release instead of EscrowCreate/Finish.
//   Reference: Provisional Patent BLDCHN-001-P, Section VI (Settlement Module)
//   No other code changes needed — the orchestrator and NFT modules are
//   currency-agnostic; only this file changes when Hooks go live.
//
// Set ESCROW_CURRENCY=RLUSD in .env when ready to migrate (will warn + fallback).
export const ESCROW_CURRENCY = (process.env.ESCROW_CURRENCY ?? 'XRP').toUpperCase()

if (ESCROW_CURRENCY === 'RLUSD') {
  console.warn(
    '[BuildChain] ESCROW_CURRENCY=RLUSD is set but XRPL Hooks are not yet on mainnet. ' +
    'Falling back to native XRP escrow. This flag is reserved for the Hooks migration. ' +
    'See lib/xrpl/escrow.ts for the migration path.'
  )
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
 * Creates a time-locked XRPL escrow for a draw request.
 *
 * On testnet we lock 1 XRP per draw (detected via XRPL_NETWORK env var).
 * On mainnet, the draw's USD amount is converted to XRP via a live
 * CoinGecko price feed (see lib/xrpl/price-oracle.ts).
 *
 * The escrow can only be finished by calling finishDrawEscrow()
 * after the FinishAfter time has passed.
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
  /** USD value of the draw — used to compute XRP amount on mainnet */
  drawAmountUsd?: number
  /** Draw Request ID — recorded in on-ledger Memo for immutable audit trail */
  drawRequestId?: string
  /** Project ID — recorded in on-ledger Memo */
  projectId?: string
}): Promise<{ escrowSequence: number; txnHash: string; finishAfter: Date }> {
  const wallet = getPlatformWallet()
  const destination = destinationAddress ?? getDestinationAddress()
  const delaySeconds = finishAfterSeconds ??
    parseInt(process.env.XRPL_ESCROW_FINISH_AFTER_SECONDS ?? '30', 10)

  const finishAfterMs = Date.now() + delaySeconds * 1000
  const finishAfterRipple = toRippleTime(finishAfterMs)

  // Determine whether we're on testnet
  const network = process.env.XRPL_NETWORK ?? ''
  const isTestnet = !network || network.includes('altnet') || network.includes('testnet')

  // Convert USD draw amount → XRP drops via oracle (or 1 XRP on testnet)
  const amountDrops = drawAmountUsd
    ? await usdToXrpDrops(drawAmountUsd, isTestnet)
    : xrpToDrops('1')

  // On-ledger audit memo — immutable record of escrow creation (Patent §VII)
  const auditMemo = {
    platform: 'BuildChain',
    event: 'escrow_create',
    drid: drawRequestId ?? null,
    project_id: projectId ?? null,
    currency: ESCROW_CURRENCY,
    ts: new Date().toISOString(),
  }

  const client = await getConnectedClient()
  try {
    const txTemplate: EscrowCreate = {
      TransactionType: 'EscrowCreate',
      Account: wallet.address,
      Destination: destination,
      Amount: amountDrops,
      FinishAfter: finishAfterRipple,
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
    }
  } finally {
    await client.disconnect()
  }
}

/**
 * Finishes (releases) a previously created escrow.
 * Sends the escrowed XRP to the original Destination address.
 *
 * Must be called after the escrow's FinishAfter time has passed.
 * Returns the EscrowFinish transaction hash.
 */
export async function finishDrawEscrow({
  escrowSequence,
  drawRequestId,
  trigger,
}: {
  escrowSequence: number
  /** Draw Request ID — recorded in on-ledger Memo for immutable audit trail */
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
    const txTemplate: EscrowFinish = {
      TransactionType: 'EscrowFinish',
      Account: wallet.address,
      Owner: wallet.address,
      OfferSequence: escrowSequence,
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
  projectId,
  projectName,
  drawAmount,
  waiverType = 'conditional',
  throughDate,
  gcSignatureHash,
  ipfsDocumentUri,
}: {
  drawRequestId: string
  drawNumber: string
  projectId: string
  projectName: string
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

  // Patent §IV NFT metadata schema
  const metadata = {
    platform: 'BuildChain',
    version: '1',
    type: 'lien_waiver',
    // Core DRID link — prevents reuse across draws (Patent §IV)
    drid: drawRequestId,
    draw_number: drawNumber,
    project_id: projectId,
    project_name: projectName,
    draw_amount_usd: drawAmount,
    // Waiver classification
    waiver_type: waiverType,
    through_date: throughDate ?? null,
    // GC authentication fields (populated when GC signs via BuildingBlock)
    gc_signature_hash: gcSignatureHash ?? null,
    ipfs_document_uri: ipfsDocumentUri ?? null,
    // Provenance
    mint_timestamp: new Date().toISOString(),
    network: (process.env.XRPL_NETWORK ?? '').includes('altnet') ? 'testnet' : 'mainnet',
  }

  const uriHex = Buffer.from(JSON.stringify(metadata), 'utf8').toString('hex').toUpperCase()

  const client = await getConnectedClient()
  try {
    const txTemplate = {
      TransactionType: 'NFTokenMint' as const,
      Account: wallet.address,
      URI: uriHex,
      Flags: 8,          // tfTransferable — can be transferred to verification account
      TransferFee: 0,
      NFTokenTaxon: 2,   // BuildChain Lien Waiver taxon
      Memos: [{
        Memo: {
          MemoType: toHex('application/json'),
          MemoData: toHex(JSON.stringify({ event: 'lien_waiver_nft_mint', drid: drawRequestId })),
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
  drawNumber,
  projectId,
  projectName,
  inspectionId,
  inspectorName,
  inspectorEmail,
  milestone,
  scheduledDate,
  passedAt,
}: {
  drawRequestId: string
  drawNumber: string
  projectId: string
  projectName: string
  inspectionId: string
  inspectorName: string
  inspectorEmail: string
  /** Construction milestone description being attested */
  milestone?: string
  scheduledDate?: string | null
  passedAt: string
}): Promise<{ nftTokenId: string; txnHash: string }> {
  const wallet = getPlatformWallet()

  // Patent §III credential metadata schema
  // Future XLS-0070 upgrade: map these fields to the VC subject/claims structure
  const metadata = {
    platform: 'BuildChain',
    version: '1',
    type: 'inspector_credential',
    // DRID link — ties credential to exact draw request (Patent §III)
    drid: drawRequestId,
    draw_number: drawNumber,
    project_id: projectId,
    project_name: projectName,
    // Inspection identity
    inspection_id: inspectionId,
    inspector_name: inspectorName,
    inspector_email: inspectorEmail,
    // Attestation
    milestone: milestone ?? null,
    scheduled_date: scheduledDate ?? null,
    completion_attestation: 'passed',
    passed_at: passedAt,
    // Issuer: BuildChain Protocol (future: XLS-0070 credential issuer DID)
    issuer: 'BuildChain Protocol',
    // XLS-0070 upgrade note:
    // issuer_did: 'did:xrpl:1:<wallet_address>'
    // subject_did: 'did:xrpl:1:<inspector_xrpl_address>'
    mint_timestamp: new Date().toISOString(),
    network: (process.env.XRPL_NETWORK ?? '').includes('altnet') ? 'testnet' : 'mainnet',
  }

  const uriHex = Buffer.from(JSON.stringify(metadata), 'utf8').toString('hex').toUpperCase()

  const client = await getConnectedClient()
  try {
    const txTemplate = {
      TransactionType: 'NFTokenMint' as const,
      Account: wallet.address,
      URI: uriHex,
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
 * The NFT URI encodes JSON metadata (draw ID, project, amount, event type,
 * timestamp) as uppercase hex — this becomes the permanent on-chain record.
 *
 * On testnet: token visible at https://testnet.xrpl.org/nft/{nftTokenId}
 * Non-blocking: caller must wrap in try/catch.
 */
export async function mintDrawNFT({
  drawRequestId,
  drawNumber,
  projectName,
  drawAmount,
  eventType,
}: {
  drawRequestId: string
  drawNumber: string
  projectName: string
  drawAmount: number
  eventType: 'approval' | 'release'
}): Promise<{ nftTokenId: string; txnHash: string }> {
  const wallet = getPlatformWallet()

  const metadata = {
    platform: 'BuildChain',
    version: '1',
    type: eventType === 'approval' ? 'draw_approval' : 'draw_release',
    draw_request_id: drawRequestId,
    draw_number: drawNumber,
    project: projectName,
    amount_usd: drawAmount,
    timestamp: new Date().toISOString(),
    network: (process.env.XRPL_NETWORK ?? '').includes('altnet') ? 'testnet' : 'mainnet',
  }

  // XRPL URI field must be uppercase hex-encoded UTF-8
  const uriHex = Buffer.from(JSON.stringify(metadata), 'utf8').toString('hex').toUpperCase()

  const client = await getConnectedClient()
  try {
    const txTemplate = {
      TransactionType: 'NFTokenMint' as const,
      Account: wallet.address,
      URI: uriHex,
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
