'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

function LoginForm() {
  const searchParams = useSearchParams()
  const urlError = searchParams.get('error')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const form = e.currentTarget
      const email = (form.elements.namedItem('email') as HTMLInputElement).value
      const password = (form.elements.namedItem('password') as HTMLInputElement).value

      console.log('[BC] 1. Starting sign-in for', email)
      const supabase = createClient()

      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      console.log('[BC] 2. signInWithPassword result:', {
        userId: data?.user?.id,
        error: signInError?.message,
        hasSession: !!data?.session,
      })

      if (signInError || !data.user) {
        setError(signInError?.message || 'Invalid email or password.')
        setLoading(false)
        return
      }

      // Check what cookies are now set in the browser
      const cookieKeys = document.cookie.split(';').map(c => c.trim().split('=')[0])
      console.log('[BC] 3. Cookies after sign-in:', cookieKeys)

      // Determine where to redirect based on the user's role
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', data.user.id)
        .single()

      console.log('[BC] 4. Profile result:', { profile, error: profileError?.message })

      const role = (profile as { role: string } | null)?.role || 'borrower'
      console.log('[BC] 5. Navigating via set-session to /' + role)

      // Route through /auth/set-session so the server sets the cookie in its
      // own format — this fixes the @supabase/ssr browser↔server cookie mismatch.
      const setSessionUrl = new URL('/auth/set-session', window.location.origin)
      setSessionUrl.searchParams.set('at', data.session!.access_token)
      setSessionUrl.searchParams.set('rt', data.session!.refresh_token)
      setSessionUrl.searchParams.set('role', role)
      window.location.href = setSessionUrl.toString()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred.'
      console.error('[BC] CATCH:', err)
      setError(message)
      setLoading(false)
    }
  }

  const displayError = error || (urlError ? decodeURIComponent(urlError) : '')

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bc-dark)' }}>
      <div className="w-full max-w-md px-6">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center font-black text-base" style={{ background: 'var(--bc-gold)', color: 'var(--bc-dark)' }}>
              BC
            </div>
            <span className="text-2xl font-bold">
              Build<span style={{ color: 'var(--bc-gold)' }}>Chain</span> Protocol
            </span>
          </div>
          <p style={{ color: 'var(--bc-muted)' }} className="text-sm">Construction loan management platform</p>
        </div>

        {/* Card */}
        <div className="rounded-xl p-8 border" style={{ background: 'var(--bc-navy)', borderColor: 'var(--bc-border)' }}>
          <h1 className="text-xl font-bold mb-6">Sign in to your account</h1>

          {displayError && (
            <div className="mb-4 p-3 rounded-lg text-sm border" style={{ background: 'rgba(231,76,60,0.1)', borderColor: 'rgba(231,76,60,0.3)', color: '#e74c3c' }}>
              {displayError}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--bc-muted)' }}>
                Email Address
              </label>
              <input
                name="email"
                type="email"
                required
                disabled={loading}
                className="w-full rounded-lg px-3 py-2.5 text-sm outline-none transition-colors"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--bc-border)', color: '#e8edf2' }}
                placeholder="you@company.com"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--bc-muted)' }}>
                Password
              </label>
              <input
                name="password"
                type="password"
                required
                disabled={loading}
                className="w-full rounded-lg px-3 py-2.5 text-sm outline-none"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--bc-border)', color: '#e8edf2' }}
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-lg font-bold text-sm transition-all mt-2 disabled:opacity-60"
              style={{ background: 'var(--bc-gold)', color: 'var(--bc-dark)' }}
            >
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>

          <div className="mt-6 pt-6 border-t text-center text-sm" style={{ borderColor: 'var(--bc-border)', color: 'var(--bc-muted)' }}>
            Don&apos;t have an account?{' '}
            <Link href="/signup" style={{ color: 'var(--bc-gold)' }} className="font-semibold hover:underline">
              Sign up
            </Link>
          </div>
        </div>

        <p className="text-center text-xs mt-6" style={{ color: 'var(--bc-muted)' }}>
          Secured by Supabase · BuildChain Protocol © 2026
        </p>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}
