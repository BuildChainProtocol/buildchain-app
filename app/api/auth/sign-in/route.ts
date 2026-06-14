import { createServerClient } from '@supabase/ssr'
import { NextRequest, NextResponse } from 'next/server'

/**
 * POST /api/auth/sign-in
 *
 * Plain HTML form POST → HTTP 303 redirect with Set-Cookie.
 * The browser commits session cookies before it follows the
 * redirect to /admin — no JavaScript, no timing gaps.
 */
export async function POST(request: NextRequest) {
  const formData = await request.formData()
  const email = (formData.get('email') as string) ?? ''
  const password = (formData.get('password') as string) ?? ''

  const pendingCookies: Array<{
    name: string
    value: string
    options: Record<string, unknown>
  }> = []

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            pendingCookies.push({ name, value, options: options ?? {} })
          })
        },
      },
    }
  )

  const { data, error } = await supabase.auth.signInWithPassword({ email, password })

  if (error || !data.user) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('error', error?.message ?? 'Invalid email or password')
    return NextResponse.redirect(loginUrl, { status: 303 })
  }

  // Redirect to /admin — middleware will verify role and
  // redirect elsewhere if needed (e.g. borrowers go to /borrower)
  const response = NextResponse.redirect(new URL('/admin', request.url), { status: 303 })

  // Stamp every session cookie onto the redirect response.
  // HTTP 303 guarantees the browser commits Set-Cookie BEFORE
  // making the GET /admin request, so middleware always sees a session.
  pendingCookies.forEach(({ name, value, options }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    response.cookies.set(name, value, options as any)
  })

  return response
}
