import { Wallet, xrpToDrops } from 'xrpl'
import type { EscrowCreate, EscrowFinish } from 'xrpl'
import { getConnectedClient } from './client'

// Ripple epoch offset: Jan 1 2000 00:00:00 UTC = Unix 946684800
const RIPPLE_EPOCH = 946684800

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
 * On testnet we lock 1 XRP per draw as a proof-of-concept.
 * The escrow can only be finished by calling finishDrawEscrow()
 * after the FinishAfter time has passed.
 *
 * Returns the escrow sequence number (needed to finish later) and tx hash.
 */
export async function createDrawEscrow({
  destinationAddress,
  finishAfterSeconds,
}: {
  destinationAddress?: string
  finishAfterSeconds?: number
}): Promise<{ escrowSequence: number; txnHash: string; finishAfter: Date }> {
  const wallet = getPlatformWallet()
  const destination = destinationAddress ?? getDestinationAddress()
  const delaySeconds = finishAfterSeconds ??
    parseInt(process.env.XRPL_ESCROW_FINISH_AFTER_SECONDS ?? '30', 10)

  const finishAfterMs = Date.now() + delaySeconds * 1000
  const finishAfterRipple = toRippleTime(finishAfterMs)

  // Testnet demo: 1 XRP per escrow regardless of USD draw amount.
  // Production: replace with oracle-derived XRP equivalent of draw.amount.
  const amountDrops = xrpToDrops('1')

  const client = await getConnectedClient()
  try {
    const txTemplate: EscrowCreate = {
      TransactionType: 'EscrowCreate',
      Account: wallet.address,
      Destination: destination,
      Amount: amountDrops,
      FinishAfter: finishAfterRipple,
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
}: {
  escrowSequence: number
}): Promise<{ txnHash: string }> {
  const wallet = getPlatformWallet()

  const client = await getConnectedClient()
  try {
    const txTemplate: EscrowFinish = {
      TransactionType: 'EscrowFinish',
      Account: wallet.address,
      Owner: wallet.address,
      OfferSequence: escrowSequence,
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
