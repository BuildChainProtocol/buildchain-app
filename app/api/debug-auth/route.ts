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

  // Show truncated value of each supabase cookie so we can see the storage format
  const supabaseCookieDetails = request.cookies.getAll()
    .filter(c => c.name.includes('sb-') || c.name.includes('supabase'))
    .map(c => ({
      name: c.name,
      valueLength: c.value.length,
      valueStart: c.value.substring(0, 80),
      looksLikeJson: c.value.trimStart().startsWith('{'),
      looksLikeBase64: /^[A-Za-z0-9+/=_-]{20,}$/.test(c.value.substring(0, 40)),
    }))

  return NextResponse.json({
    serverCanSeeUser: !!user,
    user,
    getUserError,
    supabaseUrl,
    anonKeyPrefix,
    cookiesReceived: allCookieNames,
    supabaseCookieDetails,
  })
}
