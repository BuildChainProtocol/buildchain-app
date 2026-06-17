/**
 * price-oracle.ts
 *
 * Fetches the live XRP/USD exchange rate from CoinGecko's free API.
 * Used to convert draw amounts (USD) into XRP drops for XRPL escrow.
 *
 * On failure (network error, rate-limit, or malformed response) the function
 * falls back to a conservative floor amount (1 XRP) so the escrow still goes
 * through — never silently zero out.
 *
 * For production with real money, consider subscribing to:
 *   - CoinGecko Pro API ($)  — higher rate limits
 *   - Chainlink XRP/USD feed — on-chain, manipulation-resistant
 *   - XRPL AMM (DEX)        — wss://xrplcluster.com, no third-party
 */

const COINGECKO_URL =
  'https://api.coingecko.com/api/v3/simple/price?ids=ripple&vs_currencies=usd'

/** Cached result + timestamp so we don't hammer CoinGecko on every draw */
let _cached: { priceUsd: number; fetchedAt: number } | null = null
const CACHE_TTL_MS = 5 * 60 * 1000  // 5 minutes

/**
 * Returns the current XRP/USD price.
 * Cached for 5 minutes; falls back to `fallbackPriceUsd` on any error.
 */
export async function getXrpPriceUsd(fallbackPriceUsd = 0.50): Promise<number> {
  const now = Date.now()

  if (_cached && now - _cached.fetchedAt < CACHE_TTL_MS) {
    return _cached.priceUsd
  }

  try {
    const res = await fetch(COINGECKO_URL, {
      // Next.js edge/server: revalidate every 5 minutes via CDN too
      next: { revalidate: 300 },
    })
    if (!res.ok) throw new Error(`CoinGecko responded ${res.status}`)

    const json = await res.json() as { ripple?: { usd?: number } }
    const priceUsd = json?.ripple?.usd

    if (typeof priceUsd !== 'number' || priceUsd <= 0) {
      throw new Error('Invalid price in CoinGecko response')
    }

    _cached = { priceUsd, fetchedAt: now }
    console.log(`[XRPL oracle] XRP/USD = $${priceUsd.toFixed(4)} (live)`)
    return priceUsd
  } catch (err) {
    console.warn('[XRPL oracle] Price fetch failed, using fallback:', err)
    return fallbackPriceUsd
  }
}

/**
 * Converts a USD draw amount to XRP drops for escrow.
 *
 * On testnet we use a minimum of 1 XRP (1_000_000 drops) so the escrow
 * is always meaningful. On mainnet the real amount is used.
 *
 * @param drawAmountUsd  The draw amount in USD
 * @param isTestnet      When true, caps at 1 XRP (testnet funds are free)
 * @returns              String of drops (no decimals — XRPL requirement)
 */
export async function usdToXrpDrops(
  drawAmountUsd: number,
  isTestnet = true
): Promise<string> {
  if (isTestnet) {
    // Testnet: always use exactly 1 XRP (1_000_000 drops)
    // — real testnet faucet wallets have limited funds
    return '1000000'
  }

  const priceUsd = await getXrpPriceUsd()
  const xrpAmount = drawAmountUsd / priceUsd

  // Floor at 1 XRP so escrow is never dust
  const xrpFloored = Math.max(xrpAmount, 1)

  // XRPL drops: 1 XRP = 1_000_000 drops, must be an integer
  const drops = Math.floor(xrpFloored * 1_000_000)
  console.log(
    `[XRPL oracle] $${drawAmountUsd.toLocaleString()} USD → ` +
    `${xrpFloored.toFixed(6)} XRP → ${drops.toLocaleString()} drops ` +
    `(@ $${priceUsd.toFixed(4)}/XRP)`
  )

  return drops.toString()
}
