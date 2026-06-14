import { createServerClient } from '@supabase/ssr'
import { NextRequest, NextResponse } from 'next/server'

/**
 * POST /api/auth/login
 *
 * Signs in entirely server-side so that session cookies are written by the
 * same @supabase/ssr server client that reads them in middleware and layouts.
 * This eliminates the browser-client ↔ server-client cookie format mismatch
 * that was causing "Auth session missing!" on every request.
 *
 * The key pattern: collect cookies via setAll() into a local array, then stamp
 * them directly onto the NextResponse object. Using cookies().set() from
 * next/headers is unreliable in Route Handlers — response.cookies.set() is not.
 */
export async function POST(request: NextRequest) {
  try {
    const { email, password } = (await request.json()) as {
      email: string
      password: string
    }

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required.' },
        { status: 400 }
      )
    }

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
            cookiesToSet.forEach(({ name, value, options }) =>
              pendingCookies.push({ name, value, options: options ?? {} })
            )
          },
        },
      }
    )

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error || !data.user) {
      return NextResponse.json(
        { error: error?.message ?? 'Invalid email or password.' },
        { status: 401 }
      )
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', data.user.id)
      .single()

    const role = (profile as { role: string } | null)?.role ?? 'borrower'

    // Stamp all session cookies directly onto the response.
    // The browser commits Set-Cookie headers when the fetch() resolves,
    // so window.location.href fires AFTER the session is in the cookie jar.
    const response = NextResponse.json({ redirectTo: `/${role}` })

    pendingCookies.forEach(({ name, value, options }) => {
      response.cookies.set(name, value, options)
    })

    return response
  } catch (err: unknown) {
    console.error('[POST /api/auth/login]', err)
    return NextResponse.json(
      { error: 'An unexpected error occurred. Please try again.' },
      { status: 500 }
    )
  }
}
