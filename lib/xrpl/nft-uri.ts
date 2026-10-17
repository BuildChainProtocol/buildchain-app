/**
 * NFToken URI encoding shared by every BuildChain mint (loan, draw, lien
 * waiver, inspector credential).
 *
 * XRPL caps an NFToken URI at 256 bytes (rippled maxTokenURILength); a longer
 * URI fails the whole NFTokenMint with temMALFORMED. So each URI carries a
 * compact record that ties the token to its BuildChain row, the full details
 * stay in BuildChain's database, and names, emails and addresses never go on
 * the public ledger.
 */

export const MAX_NFT_URI_BYTES = 256

/** Compact JSON metadata → uppercase hex URI; throws before submit if too long. */
export function nftUriHex(metadata: Record<string, unknown>): string {
  const json = JSON.stringify(metadata)
  const bytes = Buffer.byteLength(json, 'utf8')
  if (bytes > MAX_NFT_URI_BYTES) {
    throw new Error(`NFT metadata is ${bytes} bytes; XRPL allows at most ${MAX_NFT_URI_BYTES}`)
  }
  return Buffer.from(json, 'utf8').toString('hex').toUpperCase()
}

/** XRPL_NETWORK is the node's WebSocket URL (unset = testnet, see client.ts). */
export function networkLabel(): 'testnet' | 'mainnet' {
  const network = process.env.XRPL_NETWORK ?? ''
  return !network || network.includes('altnet') || network.includes('testnet') ? 'testnet' : 'mainnet'
}
