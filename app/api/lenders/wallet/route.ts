import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase/service'
import { NextResponse } from 'next/server'
import { createSignRequest, getSignResult, isXamanConfigured } from '@/lib/xaman'

// A lender connects their own wallet by approving a sign-in request in Xaman.
// It proves they control the account; it moves nothing and costs nothing.
//   GET   the lender's wallet, or the state of an open connect request
//   POST  open a connect request
//
// Whoever signs a connect request becomes the lender's wallet, so the request
// id is kept in a table no signed-in user can read (lender_wallet_links).
export const runtime = 'nodejs'

async function lenderRow() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const admin = serviceClient()
  const { data: lender } = await admin.from('lenders').select('id, xrp_address').eq('profile_id', user.id).maybeSingle()
  if (!lender) return { error: NextResponse.json({ error: 'This account is not a lender' }, { status: 403 }) }
  const { data: link } = await admin.from('lender_wallet_links').select('payload').eq('lender_id', lender.id).maybeSingle()
  return { admin, lender, payload: (link?.payload ?? null) as string | null }
}

export async function GET() {
  const r = await lenderRow()
  if (r.error) return r.error
  const { admin, lender, payload } = r
  if (!payload) {
    return NextResponse.json({ wallet: lender.xrp_address ?? null, state: lender.xrp_address ? 'connected' : 'none', available: isXamanConfigured() })
  }
  try {
    const result = await getSignResult(payload)
    if (!result.resolved && !result.expired) {
      return NextResponse.json({ wallet: lender.xrp_address ?? null, state: 'waiting', available: true })
    }
    const connected = result.signed && !!result.account
    if (connected) {
      // A wallet with draws waiting on it cannot be swapped out from under them.
      const { count } = await admin.from('draw_requests')
        .select('id, projects!inner(lender_id)', { count: 'exact', head: true })
        .eq('projects.lender_id', lender.id).in('settlement_state', ['awaiting_lender_signature', 'locked'])
      if (count && lender.xrp_address && lender.xrp_address !== result.account) {
        await admin.from('lender_wallet_links').delete().eq('lender_id', lender.id)
        return NextResponse.json({ wallet: lender.xrp_address, state: 'connected', available: true,
          error: 'Your wallet was not changed: a draw is waiting on the current one. Finish or withdraw it first.' })
      }
      await admin.from('lenders').update({ xrp_address: result.account }).eq('id', lender.id)
    }
    await admin.from('lender_wallet_links').delete().eq('lender_id', lender.id)
    return NextResponse.json({
      wallet: connected ? result.account : lender.xrp_address ?? null, available: true,
      state: connected ? 'connected' : result.expired ? 'expired' : 'rejected',
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message.slice(0, 200) : 'Xaman error' }, { status: 502 })
  }
}

export async function POST() {
  const r = await lenderRow()
  if (r.error) return r.error
  const { admin, lender } = r
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
    const { error } = await admin.from('lender_wallet_links')
      .upsert({ lender_id: lender.id, payload: request.uuid, created_at: new Date().toISOString() }, { onConflict: 'lender_id' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ state: 'waiting', qrPng: request.qrPng, url: request.url })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message.slice(0, 200) : 'Xaman error' }, { status: 502 })
  }
}
