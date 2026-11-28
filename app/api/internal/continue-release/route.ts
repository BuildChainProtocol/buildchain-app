import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { bearer, sameKey } from '@/lib/api-key'
import { serviceClient } from '@/lib/supabase/service'

// A draw with many payees cannot always be paid inside one 60-second run.
// The release engine calls this route to carry on in a fresh run. It is for
// the site's own use only: it answers nobody who does not present CRON_SECRET,
// and all it can do is re-check one draw, exactly like "Check again".
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  if (!sameKey(bearer(req.headers.get('authorization')), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const body = await req.json().catch(() => ({}))
  const drawId = String(body?.drawId ?? '')
  const hop = Math.max(1, Math.min(50, Number(body?.hop) || 1))
  if (!/^[0-9a-f-]{36}$/i.test(drawId)) return NextResponse.json({ error: 'drawId is required' }, { status: 400 })

  // Answer at once; the caller is near its own time limit.
  waitUntil((async () => {
    try {
      const { checkConditions } = await import('@/lib/xrpl/conditions')
      await checkConditions(serviceClient(), drawId, { hop })
    } catch (err) {
      console.warn('[continue-release] failed:', err instanceof Error ? err.message : err)
    }
  })())
  return NextResponse.json({ ok: true }, { status: 202 })
}
