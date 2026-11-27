import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { createSignRequest, getSignResult, isXamanConfigured } from '@/lib/xaman'

// A lender connects their own wallet by approving a sign-in request in Xaman.
// It proves they control the account; it moves nothing and costs nothing.
//   GET   the lender's wallet, or the state of an open connect request
//   POST  open a connect request
export const runtime = 'nodejs'

async function lenderRow() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const service = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: lender } = await service
    .from('lenders').select('id, xrp_address, wallet_link_payload').eq('profile_id', user.id).maybeSingle()
  if (!lender) return { error: NextResponse.json({ error: 'This account is not a lender' }, { status: 403 }) }
  return { service, lender }
}

export async function GET() {
  const r = await lenderRow()
  if (r.error) return r.error
  const { service, lender } = r
  if (!lender.wallet_link_payload) {
    return NextResponse.json({ wallet: lender.xrp_address ?? null, state: lender.xrp_address ? 'connected' : 'none', available: isXamanConfigured() })
  }
  try {
    const result = await getSignResult(lender.wallet_link_payload)
    if (!result.resolved && !result.expired) {
      return NextResponse.json({ wallet: lender.xrp_address ?? null, state: 'waiting', available: true })
    }
    const wallet = result.signed && result.account ? result.account : lender.xrp_address ?? null
    await service.from('lenders').update({ xrp_address: wallet, wallet_link_payload: null }).eq('id', lender.id)
    return NextResponse.json({
      wallet, available: true,
      state: result.signed && result.account ? 'connected' : result.expired ? 'expired' : 'rejected',
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message.slice(0, 200) : 'Xaman error' }, { status: 502 })
  }
}

export async function POST() {
  const r = await lenderRow()
  if (r.error) return r.error
  const { service, lender } = r
  if (!isXamanConfigured()) {
    return NextResponse.json({ error: 'Wallet signing is not set up on this site yet (Xaman keys are missing)' }, { status: 503 })
  }
  try {
    const request = await createSignRequest({
      txjson: { TransactionType: 'SignIn' },
      submit: false,
      instruction: 'Connect this wallet to BuildChain as your lending wallet. This moves nothing and costs nothing.',
      identifier: `lender-${lender.id}`.slice(0, 40),
      expireMinutes: 15,
    })
    await service.from('lenders').update({ wallet_link_payload: request.uuid }).eq('id', lender.id)
    return NextResponse.json({ state: 'waiting', qrPng: request.qrPng, url: request.url })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message.slice(0, 200) : 'Xaman error' }, { status: 502 })
  }
}
