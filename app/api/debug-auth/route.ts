import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

// TEMPORARY DEBUG ENDPOINT — DELETE BEFORE LAUNCH
// Visit https://buildchain-app.vercel.app/api/debug-auth after signing in
// to see whether the server can read your session cookies.
export async function GET(request: NextRequest) {
  const cookieHeader = request.headers.get('cookie') || ''
  const allCookieNames = cookieHeader
    .split(';')
    .map(c => c.trim().split('=')[0])
    .filter(Boolean)

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'NOT SET'
  const anonKeyPrefix = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY.substring(0, 30) + '...'
    : 'NOT SET'

  let user = null
  let getUserError = null

  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll()
          },
          setAll() {},
        },
      }
    )
    const result = await supabase.auth.getUser()
    user = result.data.user
      ? { id: result.data.user.id, email: result.data.user.email }
      : null
    getUserError = result.error?.message || null
  } catch (e: unknown) {
    getUserError = e instanceof Error ? e.message : String(e)
  }

  return NextResponse.json({
    serverCanSeeUser: !!user,
    user,
    getUserError,
    supabaseUrl,
    anonKeyPrefix,
    cookiesReceived: allCookieNames,
    supabaseCookies: allCookieNames.filter(n => n.includes('sb-') || n.includes('supabase')),
  })
}
