import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase/service'
import { NextRequest, NextResponse } from 'next/server'
import { checkConditions } from '@/lib/xrpl/conditions'

// "Check again" for an approved draw: re-do any ledger record that failed to
// write, then release the draw if both conditions are now recorded. It never
// releases a draw whose conditions are not both met.
//   POST  (no body)  ->  { ok, inspection, lienWaiver, released, reason? }
export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const role = (profile as any)?.role
  if (!['admin', 'lender'].includes(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Row-level security limits what the caller can read; on top of that, only
  // an admin or this project's own lender may act on the draw.
  const { data: draw } = await supabase
    .from('draw_requests').select('id, projects ( lenders ( profile_id ) )').eq('id', params.id).single()
  if (!draw) return NextResponse.json({ error: 'Draw not found' }, { status: 404 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (role !== 'admin' && (draw as any).projects?.lenders?.profile_id !== user.id) {
    return NextResponse.json({ error: 'Only this loan\'s lender can do this' }, { status: 403 })
  }

  try {
    return NextResponse.json(await checkConditions(serviceClient(), params.id))
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message.slice(0, 300) : 'Could not check the draw' }, { status: 502 })
  }
}
