'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { BuildChainLogo } from '@/components/shared/BuildChainLogo'

const ROLE_LABEL: Record<string, string> = {
  admin: 'Platform Admin',
  lender: 'Lender',
  borrower: 'Borrower / Contractor',
}

const ROLE_DASH: Record<string, string> = {
  admin: '/admin',
  lender: '/lender',
  borrower: '/borrower',
}

export default function ProfilePage() {
  const router = useRouter()
  const supabase = createClient()

  const [profile, setProfile] = useState<any>(null)
  const [roleRow, setRoleRow] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [pwSaving, setPwSaving] = useState(false)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  const [form, setForm] = useState({
    full_name: '',
    company_name: '',
    phone: '',
    xrp_address: '',
  })
  // The wallet as the server last reported it, to tell whether the field was changed
  const [savedWallet, setSavedWallet] = useState('')
  const [saveError, setSaveError] = useState('')
  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' })
  const [pwError, setPwError] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    const { data: p } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single()

    if (!p) { router.push('/login'); return }
    setProfile(p)

    let xrpAddress = ''
    if (p.role === 'borrower') {
      const { data: b } = await supabase
        .from('borrowers').select('*').eq('profile_id', user.id).single()
      setRoleRow(b)
      xrpAddress = b?.xrp_address || ''
    } else if (p.role === 'lender') {
      const { data: l } = await supabase
        .from('lenders').select('*').eq('profile_id', user.id).single()
      setRoleRow(l)
      xrpAddress = l?.xrp_address || ''
    }

    setForm({
      full_name: p.full_name || '',
      company_name: p.company_name || '',
      phone: p.phone || '',
      xrp_address: xrpAddress,
    })
    setSavedWallet(xrpAddress)
    setLoading(false)
  }

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  async function saveProfile() {
    setSaving(true)
    setSaveError('')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setSaveError('Your session has ended. Sign in again to save.'); return }

      // 1. Name, company and phone: the user's own profile row
      const { data: savedRows, error: profileError } = await supabase.from('profiles').update({
        full_name: form.full_name,
        company_name: form.company_name,
        phone: form.phone,
        updated_at: new Date().toISOString(),
      }).eq('id', user.id).select('id')
      if (profileError || !savedRows?.length) {
        setSaveError(`Your profile was not saved: ${profileError?.message || 'the change was not accepted'}`)
        return
      }

      // 2. Payout wallet (contractors only): saved by the server, which checks
      //    the address and refuses a change while a draw is waiting on the wallet.
      //    A lender's wallet is changed on the Funding page, never here.
      const wanted = form.xrp_address.trim()
      const walletChanged = profile?.role === 'borrower' && wanted !== savedWallet
      if (walletChanged) {
        let res: Response
        try {
          res = await fetch('/api/wallet', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ address: wanted || null }),
          })
        } catch {
          setSaveError('Your name, company and phone were saved. The wallet was not: the server could not be reached.')
          return
        }
        const json = await res.json().catch(() => ({}))
        if (!res.ok) {
          setSaveError(`Your name, company and phone were saved. The wallet was not: ${json.error || `the server answered ${res.status}`}`)
          return
        }
        const now = json.data?.xrp_address || ''
        setSavedWallet(now)
        setForm(f => ({ ...f, xrp_address: now }))
      }

      showToast(walletChanged ? 'Profile and wallet saved' : 'Profile updated', true)
    } catch {
      setSaveError('Your changes were not saved: the server could not be reached.')
    } finally {
      setSaving(false)
    }
  }

  async function changePassword() {
    setPwError('')
    if (!pwForm.next) { setPwError('Enter a new password'); return }
    if (pwForm.next !== pwForm.confirm) { setPwError('Passwords do not match'); return }
    if (pwForm.next.length < 8) { setPwError('Password must be at least 8 characters'); return }

    setPwSaving(true)
    const { error } = await supabase.auth.updateUser({ password: pwForm.next })
    setPwSaving(false)

    if (error) {
      setPwError(error.message)
    } else {
      setPwForm({ current: '', next: '', confirm: '' })
      showToast('Password updated', true)
    }
  }

  function showToast(msg: string, ok: boolean) {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3500)
  }

  const initials = profile?.full_name
    ?.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2) || 'U'

  const inputClass = 'w-full rounded-lg px-3 py-2.5 text-sm outline-none transition-colors'
  const inputStyle = {
    background: 'rgba(13,27,42,0.05)',
    border: '1px solid var(--bc-border)',
    color: 'var(--bc-text)',
  }
  const labelClass = 'block text-xs font-semibold uppercase tracking-wide mb-1.5'
  const labelStyle = { color: 'var(--bc-muted)' }

  if (loading) {
    return (
      <div className="bc-light min-h-screen flex items-center justify-center">
        <span className="text-sm" style={{ color: 'var(--bc-muted)' }}>Loading…</span>
      </div>
    )
  }

  return (
    <div className="bc-light min-h-screen">
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl text-sm font-bold shadow-xl"
          style={{ background: toast.ok ? 'var(--bc-gold)' : '#c0392b', color: toast.ok ? 'var(--bc-dark)' : '#fff' }}>
          {toast.ok ? '✓' : '✗'} {toast.msg}
        </div>
      )}

      {/* Top nav */}
      <header className="h-14 flex items-center justify-between px-6 border-b"
        style={{ background: 'var(--bc-header)', borderColor: '#08121d' }}>
        <div className="flex items-center gap-2.5">
          <BuildChainLogo variant="mark" height={32} alt="" />
          <BuildChainLogo variant="wordmark" height={18} />
        </div>
        <button onClick={() => router.push(ROLE_DASH[profile?.role] || '/')}
          className="text-sm hover:underline" style={{ color: '#c7d0db' }}>
          ← Back to Dashboard
        </button>
      </header>

      <div className="max-w-2xl mx-auto px-6 py-10 space-y-6">

        {/* Header card */}
        <div className="rounded-xl border p-6 flex items-center gap-5"
          style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
          <div className="w-16 h-16 rounded-full flex items-center justify-center text-xl font-bold flex-shrink-0"
            style={{ background: 'var(--bc-gold)', color: 'var(--bc-dark)' }}>
            {initials}
          </div>
          <div>
            <h1 className="text-xl font-bold">{profile.full_name || 'Unnamed User'}</h1>
            <p className="text-sm mt-0.5" style={{ color: 'var(--bc-muted)' }}>{profile.email}</p>
            <span className="inline-block mt-2 text-xs font-bold px-2.5 py-1 rounded-full"
              style={{ background: 'rgba(201,164,87,0.15)', color: 'var(--bc-gold-ink)' }}>
              {ROLE_LABEL[profile.role] || profile.role}
            </span>
          </div>
        </div>

        {/* Profile info */}
        <div className="rounded-xl border p-6 space-y-4"
          style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
          <h2 className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--bc-muted)' }}>
            Profile Information
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelClass} style={labelStyle}>Full Name</label>
              <input value={form.full_name} onChange={e => set('full_name', e.target.value)}
                placeholder="Jane Smith"
                className={inputClass} style={inputStyle} />
            </div>
            <div>
              <label className={labelClass} style={labelStyle}>Email</label>
              <input value={profile.email || ''} disabled
                className={inputClass}
                style={{ ...inputStyle, opacity: 0.5, cursor: 'not-allowed' }} />
            </div>
            <div>
              <label className={labelClass} style={labelStyle}>Company Name</label>
              <input value={form.company_name} onChange={e => set('company_name', e.target.value)}
                placeholder="Apex Construction LLC"
                className={inputClass} style={inputStyle} />
            </div>
            <div>
              <label className={labelClass} style={labelStyle}>Phone</label>
              <input value={form.phone} onChange={e => set('phone', e.target.value)}
                placeholder="(512) 555-0100"
                className={inputClass} style={inputStyle} />
            </div>
          </div>

          {/* XRP address — borrowers and lenders only */}
          {profile.role === 'borrower' && (
            <div>
              <label className={labelClass} style={labelStyle}>
                Payout wallet
                <span className="ml-2 font-normal normal-case" style={{ color: 'var(--bc-muted)' }}>
                  — XRP Ledger address
                </span>
              </label>
              {roleRow ? (
                <>
                  <input value={form.xrp_address} onChange={e => set('xrp_address', e.target.value)}
                    placeholder="An address that starts with r"
                    spellCheck={false} autoComplete="off"
                    className={inputClass} style={{ ...inputStyle, fontFamily: 'monospace' }} />
                  <p className="text-xs mt-1" style={{ color: 'var(--bc-muted)' }}>
                    Draw releases on the XRP Ledger are addressed to this wallet. Enter the classic address (it starts with &quot;r&quot;). Leave it empty to remove it. It cannot be changed while a draw is waiting on it.
                  </p>
                </>
              ) : (
                <p className="text-sm" style={{ color: 'var(--bc-muted)' }}>
                  Your account is not linked to a contractor record yet, so there is no payout wallet to set. Ask BuildChain to link your account.
                </p>
              )}
            </div>
          )}

          {/* A lender's wallet is confirmed by signing in Xaman, so it is read-only here */}
          {profile.role === 'lender' && (
            <div>
              <label className={labelClass} style={labelStyle}>
                Lending wallet
                <span className="ml-2 font-normal normal-case" style={{ color: 'var(--bc-muted)' }}>
                  — XRP Ledger address
                </span>
              </label>
              <div className={inputClass} style={{ ...inputStyle, fontFamily: 'monospace', opacity: 0.75, wordBreak: 'break-all' }}>
                {savedWallet || 'No wallet connected'}
              </div>
              <p className="text-xs mt-1" style={{ color: 'var(--bc-muted)' }}>
                Your lending wallet is confirmed by signing in Xaman, so it cannot be typed in here.{' '}
                <a href="/lender/funding" className="underline" style={{ color: 'var(--bc-blue)' }}>
                  {savedWallet ? 'Change it on the Funding page' : 'Connect it on the Funding page'}
                </a>
              </p>
            </div>
          )}

          {saveError && (
            <p role="alert" className="text-sm" style={{ color: '#c0392b' }}>{saveError}</p>
          )}

          <div className="pt-2">
            <button onClick={saveProfile} disabled={saving}
              className="px-5 py-2.5 rounded-lg text-sm font-bold transition-all"
              style={{ background: 'var(--bc-gold)', color: 'var(--bc-dark)', opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>

        {/* Change password */}
        <div className="rounded-xl border p-6 space-y-4"
          style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
          <h2 className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--bc-muted)' }}>
            Change Password
          </h2>

          <div className="space-y-3">
            <div>
              <label className={labelClass} style={labelStyle}>New Password</label>
              <input type="password" value={pwForm.next}
                onChange={e => setPwForm(f => ({ ...f, next: e.target.value }))}
                placeholder="At least 8 characters"
                className={inputClass} style={inputStyle} />
            </div>
            <div>
              <label className={labelClass} style={labelStyle}>Confirm New Password</label>
              <input type="password" value={pwForm.confirm}
                onChange={e => setPwForm(f => ({ ...f, confirm: e.target.value }))}
                placeholder="Repeat new password"
                className={inputClass} style={inputStyle} />
            </div>
          </div>

          {pwError && (
            <p className="text-sm" style={{ color: '#c0392b' }}>{pwError}</p>
          )}

          <button onClick={changePassword} disabled={pwSaving}
            className="px-5 py-2.5 rounded-lg text-sm font-bold border transition-all"
            style={{
              borderColor: 'var(--bc-border)',
              color: 'var(--bc-text)',
              opacity: pwSaving ? 0.7 : 1,
            }}>
            {pwSaving ? 'Updating…' : 'Update Password'}
          </button>
        </div>

        {/* Account info */}
        <div className="rounded-xl border p-6"
          style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
          <h2 className="text-xs font-bold uppercase tracking-wide mb-4" style={{ color: 'var(--bc-muted)' }}>
            Account
          </h2>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span style={{ color: 'var(--bc-muted)' }}>Role</span>
              <span className="font-semibold">{ROLE_LABEL[profile.role] || profile.role}</span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: 'var(--bc-muted)' }}>Member since</span>
              <span className="font-semibold">
                {new Date(profile.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
              </span>
            </div>
            {roleRow && (
              <div className="flex justify-between">
                <span style={{ color: 'var(--bc-muted)' }}>Company</span>
                <span className="font-semibold">{roleRow.company_name}</span>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}
