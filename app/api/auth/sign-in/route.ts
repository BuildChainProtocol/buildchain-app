import { createServerClient } from '@supabase/ssr'
import { NextRequest, NextResponse } from 'next/server'

/**
 * POST /api/auth/sign-in
 *
 * Handles login via a standard HTML form POST.
 * Returns a genuine HTTP 303 redirect so the browser commits the
 * Set-Cookie headers BEFORE it ever makes a request to /admin.
 * No JavaScript, no Next.js magic, no timing issues.
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
        getAll() {
          return request.cookies.getAll()
        },
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
    // Redirect back to login with the error in the URL
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('error', error?.message ?? 'Invalid email or password')
    return NextResponse.redirect(loginUrl, { status: 303 })
  }

  // Build the 303 redirect to /admin and stamp ALL session cookies onto it.
  // HTTP 303 means the browser commits the Set-Cookie headers first, then
  // makes a GET /admin — the session is guaranteed to be in the cookie jar.
  const redirectUrl = new URL('/admin', request.url)
  const response = NextResponse.redirect(redirectUrl, { status: 303 })

  pendingCookies.forEach(({ name, value, options }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    response.cookies.set(name, value, options as any)
  })

  return response
}
