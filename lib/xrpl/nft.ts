/**
 * BuildChain XRPL Loan NFT
 *
 * One NFT is minted per loan at origination. It represents the digital title
 * to the construction loan and lives on the ledger for the life of the loan.
 *
 * Lifecycle:
 *   1. mintLoanNFT()  — called when admin creates a project (origination)
 *   2. completeLoanNFT() — called when project stage → 'complete'
 *      → if borrower has an XRP address: creates a 0-cost sell offer (transfer)
 *      → otherwise: burns the NFT as proof of settlement
 *
 * URI format:
 *   Currently: hex-encoded compact JSON keyed by the project id, within
 *   XRPL's 256-byte URI limit (see nft-uri.ts). Names and the property
 *   address stay in BuildChain's database, off the public ledger.
 *   Upgrade path: pin loan summary PDF to IPFS via Pinata, set URI = 'ipfs://{CID}'
 *   for true immutability. Change the URI value in mintLoanNFT() once Pinata
 *   is wired up — no other code changes needed.
 *
 * Testnet explorer: https://testnet.xrpl.org/nft/{nftTokenId}
 */

import { Wallet } from 'xrpl'
import { getConnectedClient } from './client'
import { nftUriHex, networkLabel } from './nft-uri'

// Ripple epoch offset
const RIPPLE_EPOCH = 946684800

function toRippleTime(unixMs: number): number {
  return Math.floor(unixMs / 1000) - RIPPLE_EPOCH
}

function getPlatformWallet(): Wallet {
  const seed = process.env.XRPL_WALLET_SEED
  if (!seed) throw new Error('XRPL_WALLET_SEED is not set')
  return Wallet.fromSeed(seed)
}

/**
 * Extract the NFTokenID from the result metadata of a successful NFTokenMint.
 * Tries the direct field first (xrpl.js v3+), then parses AffectedNodes.
 */
function extractNFTokenId(meta: Record<string, unknown>): string | null {
  if (typeof meta.nftoken_id === 'string') return meta.nftoken_id

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

/**
 * Mint an NFT at loan origination. The token URI encodes compact JSON
 * metadata describing the loan — project id, loan number, amount, terms.
 * The parties and the property are found through the project id.
 *
 * Returns the NFTokenID and mint TX hash to be stored on the project record.
 * Non-blocking: caller must wrap in try/catch.
 *
 * IPFS upgrade: replace the URI with Buffer.from(`ipfs://${cid}`, 'utf8')
 * .toString('hex').toUpperCase() once Pinata integration is live.
 */
export async function mintLoanNFT({
  projectId,
  loanNumber,
  loanAmount,
  interestRate,
  maturityDate,
}: {
  projectId: string
  loanNumber: string
  loanAmount: number
  interestRate: number | null
  maturityDate: string | null
}): Promise<{ nftTokenId: string; txnHash: string }> {
  const wallet = getPlatformWallet()

  // ─── Loan metadata encoded into the NFT URI ────────────────────────────────
  // TODO: Replace with ipfs://{CID} once Pinata is integrated.
  // The CID should point to a pinned JSON or PDF document with the full loan
  // record. That makes the record truly immutable regardless of BuildChain
  // server state.
  const metadata = {
    p: 'BuildChain',
    t: 'construction_loan',
    pid: projectId,
    loan: String(loanNumber ?? '').slice(0, 32),
    usd: loanAmount,
    rate: interestRate ?? undefined,         // omitted when unknown
    maturity: maturityDate ?? undefined,     // omitted when unknown
    ts: new Date().toISOString(),
    net: networkLabel(),
  }

  const client = await getConnectedClient()
  try {
    const txTemplate = {
      TransactionType: 'NFTokenMint' as const,
      Account: wallet.address,
      URI: nftUriHex(metadata),
      Flags: 8,        // tfTransferable — allows future transfer to borrower on payoff
      TransferFee: 0,
      NFTokenTaxon: 0, // BuildChain loan taxon (distinct from draw taxon = 1)
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
 * Complete the loan NFT lifecycle when a loan is paid off (stage → 'complete').
 *
 * Phase 1: Burns the NFT as proof of settlement.
 * Phase 2 (future): If borrower has an XRP address, create a 0-cost sell
 * offer instead — the borrower can accept it to take ownership of the
 * token as their proof-of-payoff certificate.
 *
 * Returns the burn TX hash to be stored on the project record.
 * Non-blocking: caller must wrap in try/catch.
 */
export async function completeLoanNFT({
  nftTokenId,
}: {
  nftTokenId: string
}): Promise<{ txnHash: string }> {
  const wallet = getPlatformWallet()

  const client = await getConnectedClient()
  try {
    const txTemplate = {
      TransactionType: 'NFTokenBurn' as const,
      Account: wallet.address,
      NFTokenID: nftTokenId,
    }

    const prepared = await client.autofill(txTemplate)
    const { tx_blob, hash } = wallet.sign(prepared)
    const result = await client.submitAndWait(tx_blob)

    const meta = result.result.meta as Record<string, unknown>
    const txResult = meta?.TransactionResult
    if (txResult !== 'tesSUCCESS') {
      throw new Error(`NFTokenBurn failed: ${String(txResult)}`)
    }

    return { txnHash: hash }
  } finally {
    await client.disconnect()
  }
}

/** Check whether XRPL is configured */
export function isXrplConfigured(): boolean {
  return !!(process.env.XRPL_WALLET_SEED && process.env.XRPL_DEFAULT_DESTINATION)
}
