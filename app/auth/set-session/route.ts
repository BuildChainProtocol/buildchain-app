import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * GET /auth/set-session?at=ACCESS_TOKEN&rt=REFRESH_TOKEN&role=ROLE
 *
 * Bridge between the browser Supabase client (which stores the session in
 * a cookie format the server can't parse) and the server Supabase client
 * (which writes cookies in a format it CAN parse).
 *
 * Key: In Next.js Route Handler GET methods, cookies().set() from
 * next/headers is a no-op. Cookies MUST be stamped directly onto the
 * NextResponse object via response.cookies.set().
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const accessToken = url.searchParams.get('at')
  const refreshToken = url.searchParams.get('rt')
  const role = url.searchParams.get('role') || 'borrower'

  if (!accessToken || !refreshToken) {
    return NextResponse.redirect(new URL('/login?error=missing_tokens', url.origin))
  }

  // Build the redirect response up-front so we can stamp cookies onto it
  const response = NextResponse.redirect(new URL(`/${role}`, url.origin))

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        // Stamp every cookie Supabase wants to set directly onto the response
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options ?? {})
          })
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

  // response already has the session cookies — browser will commit them
  // before following the redirect to /{role}
  return response
}
