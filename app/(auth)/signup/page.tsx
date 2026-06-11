'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { UserRole } from '@/lib/types/database'

export default function SignupPage() {
  const router = useRouter()
  const supabase = createClient()
  const [formData, setFormData] = useState({
    email: '', password: '', fullName: '', companyName: '', role: 'borrower' as UserRole,
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { error: authError } = await supabase.auth.signUp({
      email: formData.email,
      password: formData.password,
      options: {
        data: {
          role: formData.role,
          full_name: formData.fullName,
          company_name: formData.companyName,
        },
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/${formData.role}`,
      },
    })

    if (authError) {
      setError(authError.message)
      setLoading(false)
      return
    }

    router.push('/login?message=Check your email to confirm your account')
  }

  return (
    <div className="min-h-screen flex items-center justify-center py-10" style={{ background: 'var(--bc-dark)' }}>
      <div className="w-full max-w-md px-6">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center font-black text-base" style={{ background: 'var(--bc-gold)', color: 'var(--bc-dark)' }}>BC</div>
            <span className="text-2xl font-bold">Build<span style={{ color: 'var(--bc-gold)' }}>Chain</span> Protocol</span>
          </div>
        </div>

        <div className="rounded-xl p-8 border" style={{ background: 'var(--bc-navy)', borderColor: 'var(--bc-border)' }}>
          <h1 className="text-xl font-bold mb-6">Create your account</h1>

          {error && (
            <div className="mb-4 p-3 rounded-lg text-sm border" style={{ background: 'rgba(231,76,60,0.1)', borderColor: 'rgba(231,76,60,0.3)', color: '#e74c3c' }}>{error}</div>
          )}

          <form onSubmit={handleSignup} className="space-y-4">
            {/* Role Selection */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--bc-muted)' }}>I am a</label>
              <div className="grid grid-cols-3 gap-2">
                {(['borrower', 'lender', 'admin'] as UserRole[]).map(r => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setFormData(f => ({ ...f, role: r }))}
                    className="py-2 rounded-lg text-sm font-semibold capitalize transition-all border"
                    style={{
                      background: formData.role === r ? 'var(--bc-gold)' : 'transparent',
                      color: formData.role === r ? 'var(--bc-dark)' : 'var(--bc-muted)',
                      borderColor: formData.role === r ? 'var(--bc-gold)' : 'var(--bc-border)',
                    }}
                  >
                    {r === 'borrower' ? '🏗 Borrower' : r === 'lender' ? '🏦 Lender' : '⚙ Admin'}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--bc-muted)' }}>Full Name</label>
                <input type="text" required value={formData.fullName}
                  onChange={e => setFormData(f => ({ ...f, fullName: e.target.value }))}
                  className="w-full rounded-lg px-3 py-2.5 text-sm outline-none"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--bc-border)', color: '#e8edf2' }}
                  placeholder="Jason Caruso" />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--bc-muted)' }}>Company</label>
                <input type="text" value={formData.companyName}
                  onChange={e => setFormData(f => ({ ...f, companyName: e.target.value }))}
                  className="w-full rounded-lg px-3 py-2.5 text-sm outline-none"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--bc-border)', color: '#e8edf2' }}
                  placeholder="BuildChain Protocol" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--bc-muted)' }}>Email</label>
              <input type="email" required value={formData.email}
                onChange={e => setFormData(f => ({ ...f, email: e.target.value }))}
                className="w-full rounded-lg px-3 py-2.5 text-sm outline-none"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--bc-border)', color: '#e8edf2' }}
                placeholder="you@company.com" />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--bc-muted)' }}>Password</label>
              <input type="password" required minLength={8} value={formData.password}
                onChange={e => setFormData(f => ({ ...f, password: e.target.value }))}
                className="w-full rounded-lg px-3 py-2.5 text-sm outline-none"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--bc-border)', color: '#e8edf2' }}
                placeholder="Min. 8 characters" />
            </div>

            <button type="submit" disabled={loading}
              className="w-full py-2.5 rounded-lg font-bold text-sm mt-2"
              style={{ background: 'var(--bc-gold)', color: 'var(--bc-dark)' }}>
              {loading ? 'Creating account…' : 'Create Account'}
            </button>
          </form>

          <div className="mt-6 pt-6 border-t text-center text-sm" style={{ borderColor: 'var(--bc-border)', color: 'var(--bc-muted)' }}>
            Already have an account?{' '}
            <Link href="/login" style={{ color: 'var(--bc-gold)' }} className="font-semibold hover:underline">Sign in</Link>
          </div>
        </div>
      </div>
    </div>
  )
}
