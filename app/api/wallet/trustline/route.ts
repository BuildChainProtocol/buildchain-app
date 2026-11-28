import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { serviceClient } from '@/lib/supabase/service'
import { isValidClassicAddress } from 'xrpl'
import { createSignRequest, getSignResult, isXamanConfigured } from '@/lib/xaman'
import { getConnectedClient } from '@/lib/xrpl/client'
import { settlementToken } from '@/lib/xrpl/release'
import { currencyCode, tokenBalance } from '@/lib/xrpl/settlement'

// Getting a payee's wallet ready to be paid.
//
// A ledger wallet can only receive a dollar token after its owner has said it
// accepts that token (a "trust line"). A contractor or subcontractor does that
// once, by approving one request in Xaman. No account on this site is needed:
// the page is open to anyone a draw is going to pay.
//
//   POST                 open the request (returns the QR code and link)
//   GET ?request=<id>    has it been approved? Is the wallet ready now?
//   GET ?address=<r...>  is this wallet ready to receive the token?
//
// Nothing here moves money, and everything it reports is public ledger data.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// A brake so visitors cannot use up the wallet service's allowance, which
// lender signing depends on. It is counted in the database, so it holds
// across every server instance: 6 per visitor in 10 minutes, 150 in all per
// day. The visitor is stored only as a one-way hash. If the count cannot be
// read, the request is refused rather than let through uncounted.
async function tooMany(req: NextRequest, kind = 'wallet_setup', perVisitor = 6, perDay = 150): Promise<boolean> {
  try {
    const who = (req.headers.get('x-forwarded-for') ?? 'unknown').split(',')[0].trim()
    const source = createHash('sha256').update(`wallet-setup:${who}`).digest('hex').slice(0, 32)
    const db = serviceClient()
    const since = (ms: number) => new Date(Date.now() - ms).toISOString()
    const { count: mine, error: e1 } = await db.from('public_request_log').select('id', { count: 'exact', head: true })
      .eq('kind', kind).eq('source', source).gte('created_at', since(10 * 60 * 1000))
    const { count: all, error: e2 } = await db.from('public_request_log').select('id', { count: 'exact', head: true })
      .eq('kind', kind).gte('created_at', since(24 * 60 * 60 * 1000))
    if (e1 || e2) return true
    if ((mine ?? 0) >= perVisitor || (all ?? 0) >= perDay) return true
    const { error: e3 } = await db.from('public_request_log').insert({ kind, source })
    return !!e3
  } catch { return true }
}

function unavailable() {
  return NextResponse.json({ error: 'Wallet set-up is not available on this site yet.' }, { status: 503 })
}

async function ready(address: string): Promise<boolean> {
  const client = await getConnectedClient()
  try { return (await tokenBalance(client, address, settlementToken())) !== null }
  finally { await client.disconnect() }
}

export async function POST(req: NextRequest) {
  if (!isXamanConfigured() || !process.env.SETTLEMENT_TOKEN_ISSUER) return unavailable()
  if (await tooMany(req)) return NextResponse.json({ error: 'Too many requests. Please wait a few minutes.' }, { status: 429 })
  try {
    const token = settlementToken()
    const request = await createSignRequest({
      txjson: {
        TransactionType: 'TrustSet',
        LimitAmount: { currency: currencyCode(token.currency), issuer: token.issuer, value: '1000000000' },
      },
      submit: true,
      expireMinutes: 15,
      identifier: 'payee-wallet-setup',
      instruction: `Allow this wallet to receive ${token.currency} for construction draw payments. This moves nothing; it only lets the wallet be paid.`,
    })
    return NextResponse.json({ requestId: request.uuid, qrPng: request.qrPng, url: request.url, currency: token.currency })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message.slice(0, 200) : 'Could not start wallet set-up' }, { status: 502 })
  }
}

export async function GET(req: NextRequest) {
  if (!process.env.SETTLEMENT_TOKEN_ISSUER) return unavailable()
  const address = req.nextUrl.searchParams.get('address')
  const requestId = req.nextUrl.searchParams.get('request')
  // Checks are cheap but not free (each asks the ledger or the wallet
  // service). The page asks every few seconds while someone is setting up.
  if (await tooMany(req, 'wallet_check', 300, 20000)) return NextResponse.json({ error: 'Too many requests. Please wait a few minutes.' }, { status: 429 })
  try {
    if (address) {
      if (!isValidClassicAddress(address)) return NextResponse.json({ error: 'That is not a valid XRP Ledger address.' }, { status: 400 })
      return NextResponse.json({ address, ready: await ready(address) })
    }
    if (requestId) {
      if (!isXamanConfigured()) return unavailable()
      const result = await getSignResult(requestId)
      if (!result.resolved) return NextResponse.json({ state: result.expired ? 'expired' : 'waiting' })
      if (!result.signed || !result.account) return NextResponse.json({ state: 'rejected' })
      // Approved in the wallet; it counts once the ledger shows it.
      const isReady = await ready(result.account)
      return NextResponse.json({ state: isReady ? 'ready' : 'confirming', address: result.account })
    }
    return NextResponse.json({ error: 'Give an address or a request.' }, { status: 400 })
  } catch (err) {
    // An account that does not exist on the ledger yet cannot hold a token.
    const message = err instanceof Error ? err.message : ''
    if (/actNotFound|Account not found/i.test(message)) return NextResponse.json({ address, ready: false, note: 'This wallet is not active on the ledger yet.' })
    return NextResponse.json({ error: 'The ledger could not be reached. Try again in a moment.' }, { status: 502 })
  }
}
