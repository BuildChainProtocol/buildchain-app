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

/** Check whether XRPL is configured (used to gracefully skip if env vars missing) */
export function isXrplConfigured(): boolean {
  return !!(process.env.XRPL_WALLET_SEED && process.env.XRPL_DEFAULT_DESTINATION)
}
