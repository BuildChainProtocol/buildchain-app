import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

// TEMPORARY DEBUG ENDPOINT — DELETE BEFORE LAUNCH
export async function GET(request: NextRequest) {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll() {},
      },
    }
  )

  // ── Auth check ──────────────────────────────────────────────
  const { data: { user }, error: userError } = await supabase.auth.getUser()

  // ── Profile query — the exact same query the layouts use ────
  let profile = null
  let profileError = null
  if (user) {
    const result = await supabase
      .from('profiles')
      .select('id, role, email')
      .eq('id', user.id)
      .single()
    profile = result.data
    profileError = result.error ? { message: result.error.message, code: result.error.code, details: result.error.details, hint: result.error.hint } : null
  }

  // ── RLS test: try selecting all profiles (admin-only) ───────
  let allProfilesCount = null
  let allProfilesError = null
  if (user) {
    const result = await supabase.from('profiles').select('id', { count: 'exact', head: true })
    allProfilesCount = result.count
    allProfilesError = result.error?.message ?? null
  }

  return NextResponse.json({
    serverCanSeeUser: !!user,
    userError: userError?.message ?? null,
    user: user ? { id: user.id, email: user.email } : null,
    profile,
    profileError,
    allProfilesCount,
    allProfilesError,
    cookiesReceived: request.cookies.getAll().map(c => c.name),
  }, { status: 200 })
}
