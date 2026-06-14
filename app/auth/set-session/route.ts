import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * GET /auth/set-session?at=ACCESS_TOKEN&rt=REFRESH_TOKEN&role=ROLE
 *
 * Fallback session bridge — no longer used by the primary login flow
 * (which now goes through POST /api/auth/login). Kept for future use
 * (e.g. magic-link flows, OAuth callbacks that need server-side session init).
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const accessToken = url.searchParams.get('at')
  const refreshToken = url.searchParams.get('rt')
  const role = url.searchParams.get('role') || 'borrower'

  if (!accessToken || !refreshToken) {
    return NextResponse.redirect(new URL('/login?error=missing_tokens', url.origin))
  }

  const response = NextResponse.redirect(new URL(`/${role}`, url.origin))

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
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
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(error.message)}`, url.origin)
    )
  }

  return response
}
