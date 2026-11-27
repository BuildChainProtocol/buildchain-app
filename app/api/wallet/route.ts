import { NextRequest, NextResponse } from 'next/server'
import { isValidClassicAddress } from 'xrpl'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase/service'

// xrpl is a Node library
export const runtime = 'nodejs'

// PUT /api/wallet  { address: string | null }
// Sets (or clears, with null) the signed-in contractor's payout wallet.
// The database refuses a signed-in user's own write to `borrowers` and
// `lenders`, so the write goes through the service key, after this route has
// found the caller's own record from their session.
export async function PUT(request: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Sign in to change your wallet' }, { status: 401 })

  let raw: unknown
  try { raw = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }
  const given = (raw as { address?: unknown } | null)?.address
  if (given !== null && typeof given !== 'string') {
    return NextResponse.json({ error: 'Send an address, or null to clear it' }, { status: 400 })
  }
  const address = typeof given === 'string' ? given.trim() : null
  if (address !== null && !isValidClassicAddress(address)) {
    return NextResponse.json(
      { error: 'That is not a valid XRP Ledger address. Enter the classic address: it starts with "r". Addresses that start with "X" are not accepted.' },
      { status: 400 }
    )
  }

  const admin = serviceClient()

  // A lender's wallet is set only by the wallet-connect flow, where the lender
  // proves control of the account by signing in Xaman.
  const { data: lender, error: lenderError } = await admin
    .from('lenders').select('id').eq('profile_id', user.id).maybeSingle()
  if (lenderError) return NextResponse.json({ error: lenderError.message }, { status: 500 })
  if (lender) {
    return NextResponse.json(
      { error: 'Change your lending wallet on the Funding page: it is confirmed by signing in Xaman' },
      { status: 409 }
    )
  }

  const { data: borrower, error: borrowerError } = await admin
    .from('borrowers').select('id, xrp_address').eq('profile_id', user.id).maybeSingle()
  if (borrowerError) return NextResponse.json({ error: borrowerError.message }, { status: 500 })
  if (!borrower) {
    return NextResponse.json(
      { error: 'Your account is not linked to a contractor or lender record, so there is no wallet to change. Ask BuildChain to link your account.' },
      { status: 404 }
    )
  }

  // Nothing to change
  if ((borrower.xrp_address ?? null) === address) {
    return NextResponse.json({ data: { xrp_address: address } })
  }

  // A draw the lender is signing, or has locked, names the current wallet as
  // its payee. The wallet stays as it is until that draw is finished.
  const { data: projects, error: projectsError } = await admin
    .from('projects').select('id').eq('borrower_id', borrower.id)
  if (projectsError) return NextResponse.json({ error: projectsError.message }, { status: 500 })
  const projectIds = (projects ?? []).map((p: { id: string }) => p.id)
  if (projectIds.length > 0) {
    const { count, error: drawsError } = await admin
      .from('draw_requests')
      .select('id', { count: 'exact', head: true })
      .in('project_id', projectIds)
      .in('settlement_state', ['awaiting_lender_signature', 'locked'])
    if (drawsError) return NextResponse.json({ error: drawsError.message }, { status: 500 })
    if (count) {
      return NextResponse.json(
        { error: 'A draw is waiting on the current wallet. It can be changed after that draw is released or withdrawn.' },
        { status: 409 }
      )
    }
  }

  const { data: saved, error: saveError } = await admin
    .from('borrowers')
    .update({ xrp_address: address })
    .eq('id', borrower.id)
    .select('xrp_address')
    .single()
  if (saveError) return NextResponse.json({ error: saveError.message }, { status: 500 })

  return NextResponse.json({ data: { xrp_address: saved?.xrp_address ?? null } })
}
