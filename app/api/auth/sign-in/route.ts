import { createServerClient } from '@supabase/ssr'
import { NextRequest, NextResponse } from 'next/server'

/**
 * POST /api/auth/sign-in — diagnostic version
 *
 * Instead of redirecting, returns an HTML page showing exactly what happened
 * at each step. This lets us see the failure point without the redirect chain.
 */
export async function POST(request: NextRequest) {
  const steps: string[] = []

  try {
    // ── 1. Parse form data ─────────────────────────────────────
    let email = ''
    let password = ''
    try {
      const formData = await request.formData()
      email = (formData.get('email') as string) ?? ''
      password = (formData.get('password') as string) ?? ''
      steps.push(`✅ Form data parsed — email: "${email}", password length: ${password.length}`)
    } catch (e) {
      steps.push(`❌ Could not parse form data: ${e}`)
      return html(steps)
    }

    // ── 2. Create Supabase client ──────────────────────────────
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    steps.push(`Supabase URL set: ${!!supabaseUrl} (${supabaseUrl?.slice(0, 40)})`)
    steps.push(`Anon key set: ${!!supabaseKey}`)

    const pendingCookies: Array<{
      name: string
      value: string
      options: Record<string, unknown>
    }> = []

    const supabase = createServerClient(
      supabaseUrl!,
      supabaseKey!,
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
    steps.push('✅ Supabase client created')

    // ── 3. Sign in ─────────────────────────────────────────────
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error || !data.user) {
      steps.push(`❌ signInWithPassword FAILED: ${error?.message ?? 'no user returned'}`)
      return html(steps)
    }
    steps.push(`✅ signInWithPassword OK — user: ${data.user.email} (${data.user.id})`)
    steps.push(`   Session expires: ${data.session?.expires_at}`)
    steps.push(`   Cookies to set: ${pendingCookies.length} (${pendingCookies.map(c => c.name).join(', ')})`)

    // ── 4. Query profile ───────────────────────────────────────
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, role')
      .eq('id', data.user.id)
      .single()

    if (profileError || !profile) {
      steps.push(`❌ Profile query FAILED: ${profileError?.message ?? 'null result'} (code: ${profileError?.code})`)
    } else {
      steps.push(`✅ Profile found — role: ${profile.role}`)
    }

    // ── 5. Build redirect response with cookies ────────────────
    const role = (profile as { role: string } | null)?.role ?? 'borrower'
    const redirectTarget = `/${role}`

    steps.push(`Redirect target would be: ${redirectTarget}`)
    steps.push(`Cookies being stamped: ${pendingCookies.map(c => `${c.name}(len=${c.value.length})`).join(', ')}`)

    // Show the diagnostic page with a MANUAL link to the dashboard
    // so we can test the redirect step separately
    return html(steps, redirectTarget)

  } catch (err) {
    steps.push(`❌ Unexpected error: ${err}`)
    return html(steps)
  }
}

function html(steps: string[], redirectTarget?: string) {
  const rows = steps
    .map(s => `<div style="padding:4px 0;border-bottom:1px solid #2a3441;font-family:monospace;font-size:13px;color:${s.startsWith('❌') ? '#e74c3c' : s.startsWith('✅') ? '#2ecc71' : '#8899a6'}">${s}</div>`)
    .join('')

  const link = redirectTarget
    ? `<div style="margin-top:24px"><a href="${redirectTarget}" style="display:inline-block;padding:12px 24px;background:#f0b429;color:#0d1117;font-weight:bold;border-radius:8px;text-decoration:none;font-size:15px">→ Go to ${redirectTarget} (click to test redirect + cookie)</a></div>`
    : ''

  const body = `<!DOCTYPE html>
<html>
<head><title>BuildChain Login Diagnostic</title></head>
<body style="background:#0d1117;color:#e8edf2;padding:32px;font-family:system-ui">
  <h2 style="color:#f0b429;margin-bottom:16px">🔍 Login Diagnostic — v7</h2>
  ${rows}
  ${link}
  <div style="margin-top:24px"><a href="/login" style="color:#8899a6;font-size:13px">← Back to login</a></div>
</body>
</html>`

  return new NextResponse(body, {
    headers: { 'Content-Type': 'text/html' },
  })
}
