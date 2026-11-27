'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { BuildChainLogo } from '@/components/shared/BuildChainLogo'

/** Ask for a link to choose a new password. */
export default function ForgotPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function send(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError('')
    const supabase = createClient()
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth/accept`,
    })
    setBusy(false)
    // The same answer whether or not the address has an account, so this page
    // cannot be used to find out who does. Only a rate limit is reported.
    if (err && /rate|too many|seconds/i.test(err.message)) {
      setError('Too many requests. Please wait a minute and try again.')
      return
    }
    setSent(true)
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bc-dark)' }}>
      <div className="w-full max-w-md px-6 py-10">
        <div className="text-center mb-8">
          <BuildChainLogo variant="lockup" height={110} alt="BuildChain Protocol" style={{ margin: '0 auto' }} />
        </div>
        <div className="rounded-xl p-8 border" style={{ background: 'var(--bc-navy)', borderColor: 'var(--bc-border)' }}>
          {sent ? (
            <>
              <h1 className="text-xl font-bold mb-3">Check your email</h1>
              <p className="text-sm mb-6" style={{ color: 'var(--bc-muted)' }}>
                If <strong style={{ color: '#e8edf2' }}>{email.trim()}</strong> has an account, a link to choose a new
                password is on its way. Open it on this device. It works once.
              </p>
              <Link href="/login" className="text-sm font-semibold underline" style={{ color: 'var(--bc-gold)' }}>Back to sign in</Link>
            </>
          ) : (
            <>
              <h1 className="text-xl font-bold mb-2">Forgot your password?</h1>
              <p className="text-sm mb-6" style={{ color: 'var(--bc-muted)' }}>Enter your email address and we will send a link to choose a new one.</p>
              {error && (
                <div className="mb-4 p-3 rounded-lg text-sm border" style={{ background: 'rgba(231,76,60,0.1)', borderColor: 'rgba(231,76,60,0.3)', color: '#e74c3c' }}>{error}</div>
              )}
              <form onSubmit={send} className="space-y-4">
                <div>
                  <label htmlFor="em" className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--bc-muted)' }}>Email</label>
                  <input id="em" type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)}
                    className="w-full rounded-lg px-3 py-2.5 text-sm outline-none"
                    style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--bc-border)', color: '#e8edf2' }} />
                </div>
                <button type="submit" disabled={busy} className="w-full py-2.5 rounded-lg font-bold text-sm"
                  style={{ background: 'var(--bc-gold)', color: 'var(--bc-dark)' }}>
                  {busy ? 'Sending…' : 'Send the link'}
                </button>
              </form>
              <div className="mt-6 text-sm">
                <Link href="/login" className="underline" style={{ color: 'var(--bc-muted)' }}>Back to sign in</Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
