import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * GET /auth/set-session?at=ACCESS_TOKEN&rt=REFRESH_TOKEN&role=ROLE
 *
 * After the browser Supabase client signs in, it holds valid tokens but
 * stores the session in a cookie format that @supabase/ssr on the server
 * cannot parse (version mismatch in cookie encoding).
 *
 * Solution: redirect here with the raw tokens. The SERVER creates a
 * Supabase client, calls setSession(), which stores the session in the
 * server's own cookie format via cookieStore.set(). The Set-Cookie headers
 * go out with the redirect response, so by the time the browser lands on
 * /admin (or /borrower), the cookies are already committed in the right format.
 *
 * TODO: rotate to POST + short-lived signed token before adding real users.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const accessToken = url.searchParams.get('at')
  const refreshToken = url.searchParams.get('rt')
  const role = url.searchParams.get('role') || 'borrower'

  if (!accessToken || !refreshToken) {
    return NextResponse.redirect(new URL('/login?error=missing_tokens', url.origin))
  }

  const cookieStore = cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        },
      },
    }
  )

  const { error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  })

  if (error) {
    console.error('[set-session] setSession error:', error.message)
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(error.message)}`, url.origin)
    )
  }

  // Cookies are now set in the response headers — redirect to dashboard
  return NextResponse.redirect(new URL(`/${role}`, url.origin))
}
