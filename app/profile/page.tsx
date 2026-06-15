'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

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
    setLoading(false)
  }

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  async function saveProfile() {
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    await supabase.from('profiles').update({
      full_name: form.full_name,
      company_name: form.company_name,
      phone: form.phone,
      updated_at: new Date().toISOString(),
    }).eq('id', user.id)

    if (profile?.role === 'borrower' && roleRow) {
      await supabase.from('borrowers')
        .update({ xrp_address: form.xrp_address || null })
        .eq('id', roleRow.id)
    } else if (profile?.role === 'lender' && roleRow) {
      await supabase.from('lenders')
        .update({ xrp_address: form.xrp_address || null })
        .eq('id', roleRow.id)
    }

    setSaving(false)
    showToast('Profile updated', true)
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
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid var(--bc-border)',
    color: '#e8edf2',
  }
  const labelClass = 'block text-xs font-semibold uppercase tracking-wide mb-1.5'
  const labelStyle = { color: 'var(--bc-muted)' }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bc-dark)' }}>
        <span className="text-sm" style={{ color: 'var(--bc-muted)' }}>Loading…</span>
      </div>
    )
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--bc-dark)' }}>
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl text-sm font-bold shadow-xl"
          style={{ background: toast.ok ? 'var(--bc-gold)' : '#e74c3c', color: toast.ok ? 'var(--bc-dark)' : '#fff' }}>
          {toast.ok ? '✓' : '✗'} {toast.msg}
        </div>
      )}

      {/* Top nav */}
      <header className="h-14 flex items-center justify-between px-6 border-b"
        style={{ background: 'var(--bc-navy)', borderColor: 'var(--bc-border)' }}>
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center font-black text-sm"
            style={{ background: 'var(--bc-gold)', color: 'var(--bc-dark)' }}>BC</div>
          <span className="text-base font-bold">
            Build<span style={{ color: 'var(--bc-gold)' }}>Chain</span>
          </span>
        </div>
        <button onClick={() => router.push(ROLE_DASH[profile?.role] || '/')}
          className="text-sm hover:underline" style={{ color: 'var(--bc-muted)' }}>
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
              style={{ background: 'rgba(243,156,18,0.15)', color: 'var(--bc-gold)' }}>
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

          <div className="grid grid-cols-2 gap-4">
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
          {(profile.role === 'borrower' || profile.role === 'lender') && (
            <div>
              <label className={labelClass} style={labelStyle}>
                XRP Wallet Address
                <span className="ml-2 font-normal normal-case" style={{ color: 'var(--bc-muted)' }}>
                  — for XRPL escrow routing
                </span>
              </label>
              <input value={form.xrp_address} onChange={e => set('xrp_address', e.target.value)}
                placeholder="rN7n3473SaZBCG4dFL83w7PB5mMa5xBGF"
                className={inputClass} style={{ ...inputStyle, fontFamily: 'monospace' }} />
              <p className="text-xs mt-1" style={{ color: 'var(--bc-muted)' }}>
                When set, draw escrow funds route to this address on the XRPL.
              </p>
            </div>
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
            <p className="text-sm" style={{ color: '#e74c3c' }}>{pwError}</p>
          )}

          <button onClick={changePassword} disabled={pwSaving}
            className="px-5 py-2.5 rounded-lg text-sm font-bold border transition-all"
            style={{
              borderColor: 'var(--bc-border)',
              color: '#e8edf2',
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
