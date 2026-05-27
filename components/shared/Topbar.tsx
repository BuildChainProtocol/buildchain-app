'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Profile } from '@/lib/types/database'

interface TopbarProps {
  profile: Profile
  unreadCount?: number
}

export default function Topbar({ profile, unreadCount = 0 }: TopbarProps) {
  const router = useRouter()
  const supabase = createClient()
  const [showDropdown, setShowDropdown] = useState(false)

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const initials = profile.full_name
    ?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || 'U'

  const roleLabel = { admin: '⚙ Admin', lender: '🏦 Lender', borrower: '🏗 Borrower' }[profile.role]

  return (
    <header className="fixed top-0 left-0 right-0 z-50 h-14 flex items-center justify-between px-6 border-b"
      style={{ background: 'var(--bc-navy)', borderColor: 'var(--bc-border)' }}>
      {/* Logo */}
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center font-black text-sm"
          style={{ background: 'var(--bc-gold)', color: 'var(--bc-dark)' }}>BC</div>
        <span className="text-base font-bold">
          Build<span style={{ color: 'var(--bc-gold)' }}>Chain</span>
          <span className="text-xs font-normal ml-1.5" style={{ color: 'var(--bc-muted)' }}>{roleLabel}</span>
        </span>
      </div>

      {/* Right */}
      <div className="flex items-center gap-4">
        {/* Notifications */}
        <button className="relative p-1.5 rounded-lg transition-colors hover:bg-white/5">
          <svg className="w-5 h-5" style={{ color: 'var(--bc-muted)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 w-4 h-4 flex items-center justify-center text-xs font-bold rounded-full"
              style={{ background: '#e74c3c', color: '#fff', fontSize: '9px' }}>
              {unreadCount}
            </span>
          )}
        </button>

        {/* User menu */}
        <div className="relative">
          <button onClick={() => setShowDropdown(!showDropdown)}
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-white/5">
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
              style={{ background: 'var(--bc-gold)', color: 'var(--bc-dark)' }}>{initials}</div>
            <span className="text-sm font-medium">{profile.full_name || profile.email}</span>
            <svg className="w-4 h-4" style={{ color: 'var(--bc-muted)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showDropdown && (
            <div className="absolute right-0 mt-1 w-48 rounded-xl border shadow-xl py-1 z-50"
              style={{ background: 'var(--bc-navy)', borderColor: 'var(--bc-border)' }}>
              <div className="px-3 py-2 border-b" style={{ borderColor: 'var(--bc-border)' }}>
                <div className="text-xs font-semibold">{profile.full_name}</div>
                <div className="text-xs" style={{ color: 'var(--bc-muted)' }}>{profile.email}</div>
              </div>
              <button onClick={() => { setShowDropdown(false); router.push('/profile') }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-white/5 transition-colors">
                My Profile
              </button>
              <button onClick={handleSignOut}
                className="w-full text-left px-3 py-2 text-sm hover:bg-white/5 transition-colors"
                style={{ color: '#e74c3c' }}>
                Sign Out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
