'use client'

import { useState } from 'react'
import Link from 'next/link'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })

      let json: { role?: string; error?: string } = {}
      try {
        json = await res.json()
      } catch {
        setError(`Server error (${res.status}). Please try again.`)
        setLoading(false)
        return
      }

      if (!res.ok) {
        setError(json.error || 'Invalid email or password.')
        setLoading(false)
        return
      }

      // Server set the session cookie — hard redirect to dashboard
      window.location.href = `/${json.role || 'admin'}`
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setError(`Connection error: ${msg}`)
      setLoading(false)
    }
  }

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

          {error && (
            <div className="mb-4 p-3 rounded-lg text-sm border" style={{ background: 'rgba(231,76,60,0.1)', borderColor: 'rgba(231,76,60,0.3)', color: '#e74c3c' }}>
              {error}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--bc-muted)' }}>
                Email Address
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                className="w-full rounded-lg px-3 py-2.5 text-sm outline-none transition-colors"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--bc-border)', color: '#e8edf2' }}
                onFocus={e => e.target.style.borderColor = 'var(--bc-gold)'}
                onBlur={e => e.target.style.borderColor = 'var(--bc-border)'}
                placeholder="you@company.com"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--bc-muted)' }}>
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                className="w-full rounded-lg px-3 py-2.5 text-sm outline-none"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--bc-border)', color: '#e8edf2' }}
                onFocus={e => e.target.style.borderColor = 'var(--bc-gold)'}
                onBlur={e => e.target.style.borderColor = 'var(--bc-border)'}
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-lg font-bold text-sm transition-all mt-2"
              style={{ background: loading ? 'rgba(201,168,76,0.5)' : 'var(--bc-gold)', color: 'var(--bc-dark)' }}
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
