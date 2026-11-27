'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { BuildChainLogo } from '@/components/shared/BuildChainLogo'

type Phase = 'checking' | 'form' | 'saving' | 'expired' | 'error'

/**
 * Where an invitation or a password-reset email lands. It signs the person in
 * with the one-time link, then has them choose a password. Without this page
 * an invited lender or contractor reached the ordinary sign-in form with no
 * password to type.
 */
export default function AcceptPage() {
  const [phase, setPhase] = useState<Phase>('checking')
  const [invited, setInvited] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [agree, setAgree] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const supabase = createClient()
    const run = async () => {
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
      const query = new URLSearchParams(window.location.search)
      // Never leave one-time tokens in the address bar or the browser history.
      const clean = () => window.history.replaceState(null, '', '/auth/accept')

      if (hash.get('error_code') || hash.get('error') || query.get('error')) {
        clean(); setPhase('expired'); return
      }
      try {
        const access = hash.get('access_token')
        const refresh = hash.get('refresh_token')
        const code = query.get('code')
        if (access && refresh) {
          setInvited(hash.get('type') === 'invite')
          const { error: e } = await supabase.auth.setSession({ access_token: access, refresh_token: refresh })
          clean()
          if (e) { setPhase('expired'); return }
        } else if (code) {
          const { error: e } = await supabase.auth.exchangeCodeForSession(code)
          clean()
          if (e) { setPhase('expired'); return }
        }
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { setPhase('expired'); return }
        setEmail(user.email ?? '')
        setPhase('form')
      } catch {
        clean(); setPhase('expired')
      }
    }
    run()
  }, [])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (password.length < 10) { setError('Use at least 10 characters.'); return }
    if (password !== confirm) { setError('The two passwords do not match.'); return }
    if (invited && !agree) { setError('Please confirm you accept the Terms of Service and Privacy Policy.'); return }
    setPhase('saving')
    const supabase = createClient()
    const { error: e1 } = await supabase.auth.updateUser({ password })
    if (e1) { setError(e1.message); setPhase('form'); return }
    const { data: { user } } = await supabase.auth.getUser()
    const { data: profile } = user
      ? await supabase.from('profiles').select('role').eq('id', user.id).single()
      : { data: null }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const role = (profile as any)?.role
    window.location.assign(['admin', 'lender', 'borrower'].includes(role) ? `/${role}` : '/login')
  }

  const field = 'w-full rounded-lg px-3 py-2.5 text-sm outline-none'
  const fieldStyle = { background: 'rgba(255,255,255,0.05)', border: '1px solid var(--bc-border)', color: '#e8edf2' }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bc-dark)' }}>
      <div className="w-full max-w-md px-6 py-10">
        <div className="text-center mb-8">
          <BuildChainLogo variant="lockup" height={110} alt="BuildChain Protocol" style={{ margin: '0 auto' }} />
        </div>
        <div className="rounded-xl p-8 border" style={{ background: 'var(--bc-navy)', borderColor: 'var(--bc-border)' }}>
          {phase === 'checking' && (
            <p className="text-sm" style={{ color: 'var(--bc-muted)' }}>Checking your link…</p>
          )}

          {phase === 'expired' && (
            <>
              <h1 className="text-xl font-bold mb-3">This link can no longer be used</h1>
              <p className="text-sm mb-6" style={{ color: 'var(--bc-muted)' }}>
                Invitation and password links work once and expire after a while. If you already have a
                password, sign in. If you were invited, ask the person who invited you to send it again.
                To choose a new password, request a fresh link.
              </p>
              <div className="flex flex-wrap gap-3">
                <Link href="/login" className="px-4 py-2 rounded-lg text-sm font-bold" style={{ background: 'var(--bc-gold)', color: 'var(--bc-dark)' }}>Sign in</Link>
                <Link href="/auth/forgot" className="px-4 py-2 rounded-lg text-sm font-bold border" style={{ borderColor: 'var(--bc-border)', color: '#e8edf2' }}>Send me a new link</Link>
              </div>
            </>
          )}

          {(phase === 'form' || phase === 'saving') && (
            <>
              <h1 className="text-xl font-bold mb-2">{invited ? 'Welcome. Choose your password' : 'Choose a new password'}</h1>
              <p className="text-sm mb-6" style={{ color: 'var(--bc-muted)' }}>
                {email ? <>For <strong style={{ color: '#e8edf2' }}>{email}</strong>.</> : null} You will use it with this email address to sign in.
              </p>
              {error && (
                <div className="mb-4 p-3 rounded-lg text-sm border" style={{ background: 'rgba(231,76,60,0.1)', borderColor: 'rgba(231,76,60,0.3)', color: '#e74c3c' }}>{error}</div>
              )}
              <form onSubmit={save} className="space-y-4">
                <div>
                  <label htmlFor="pw" className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--bc-muted)' }}>Password</label>
                  <input id="pw" type="password" required minLength={10} autoComplete="new-password" value={password}
                    onChange={e => setPassword(e.target.value)} className={field} style={fieldStyle} />
                  <p className="text-xs mt-1" style={{ color: 'var(--bc-muted)' }}>At least 10 characters.</p>
                </div>
                <div>
                  <label htmlFor="pw2" className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--bc-muted)' }}>Type it again</label>
                  <input id="pw2" type="password" required autoComplete="new-password" value={confirm}
                    onChange={e => setConfirm(e.target.value)} className={field} style={fieldStyle} />
                </div>
                {invited && (
                  <label className="flex items-start gap-2 text-sm" style={{ color: 'var(--bc-muted)' }}>
                    <input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} className="mt-1" />
                    <span>
                      I accept the{' '}
                      <Link href="/terms" target="_blank" className="underline" style={{ color: 'var(--bc-gold)' }}>Terms of Service</Link>{' '}
                      and the{' '}
                      <Link href="/privacy" target="_blank" className="underline" style={{ color: 'var(--bc-gold)' }}>Privacy Policy</Link>.
                      BuildChain is in pilot on the XRP Ledger test network.
                    </span>
                  </label>
                )}
                <button type="submit" disabled={phase === 'saving'}
                  className="w-full py-2.5 rounded-lg font-bold text-sm" style={{ background: 'var(--bc-gold)', color: 'var(--bc-dark)' }}>
                  {phase === 'saving' ? 'Saving…' : 'Save password and continue'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
