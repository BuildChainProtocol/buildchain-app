import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

// Daily ping (see "crons" in vercel.json). Supabase's free plan pauses a
// project after about a week with no database activity, and a paused project
// makes every signed-in page fail. One small read a day keeps it awake.
//
// The response says only whether the database answered; it returns no rows.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) {
    return NextResponse.json({ ok: false, error: 'Supabase is not configured' }, { status: 500 })
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } })
  const { error } = await supabase.from('projects').select('id', { count: 'exact', head: true })

  if (error) {
    console.error('[keepalive] database did not answer:', error.message)
    return NextResponse.json({ ok: false, at: new Date().toISOString() }, { status: 503 })
  }
  return NextResponse.json({ ok: true, at: new Date().toISOString() })
}
