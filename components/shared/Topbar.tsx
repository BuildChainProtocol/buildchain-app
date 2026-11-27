'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Profile } from '@/lib/types/database'
import { BuildChainLogo } from '@/components/shared/BuildChainLogo'

interface TopbarProps {
  profile: Profile
  unreadCount?: number
  onMenuToggle?: () => void
}

interface Notification {
  id: string
  title: string
  body: string
  read: boolean
  link?: string | null
  created_at: string
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

export default function Topbar({ profile, unreadCount: initialUnread = 0, onMenuToggle }: TopbarProps) {
  const router = useRouter()
  const supabase = createClient()

  const [showUserMenu, setShowUserMenu] = useState(false)
  const [showNotifs, setShowNotifs] = useState(false)
  const [notifs, setNotifs] = useState<Notification[]>([])
  const [notifsLoading, setNotifsLoading] = useState(false)
  const [unreadCount, setUnreadCount] = useState(initialUnread)

  const userMenuRef = useRef<HTMLDivElement>(null)
  const notifsRef = useRef<HTMLDivElement>(null)

  // Click-outside handler
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false)
      }
      if (notifsRef.current && !notifsRef.current.contains(e.target as Node)) {
        setShowNotifs(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  async function openNotifs() {
    const wasOpen = showNotifs
    setShowNotifs(!wasOpen)
    if (!wasOpen) {
      setNotifsLoading(true)
      try {
        const res = await fetch('/api/notifications')
        const json = await res.json()
        if (json.data) setNotifs(json.data)
      } finally {
        setNotifsLoading(false)
      }
    }
  }

  async function markAllRead() {
    await fetch('/api/notifications', { method: 'PATCH' })
    setNotifs(prev => prev.map(n => ({ ...n, read: true })))
    setUnreadCount(0)
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const initials = profile.full_name
    ?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || 'U'

  const roleLabel = { admin: 'Admin', lender: 'Lender', borrower: 'Borrower' }[profile.role]

  const liveUnread = notifs.length > 0 ? notifs.filter(n => !n.read).length : unreadCount

  return (
    <header className="fixed top-0 left-0 right-0 z-50 h-14 flex items-center justify-between px-6 border-b"
      style={{ background: 'var(--bc-header)', borderColor: '#08121d' }}>
      {/* Logo + hamburger */}
      <div className="flex items-center gap-2.5">
        {/* Hamburger — mobile only */}
        {onMenuToggle && (
          <button
            onClick={onMenuToggle}
            className="md:hidden -ml-1 p-2 rounded-lg hover:bg-white/10 transition-colors"
            aria-label="Toggle navigation"
          >
            <svg className="w-5 h-5" style={{ color: '#c7d0db' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        )}
        <BuildChainLogo variant="mark" height={32} />
        {/* Hide the wordmark on small screens to avoid crowding */}
        <span className="hidden sm:inline-flex items-center">
          <BuildChainLogo variant="wordmark" height={18} alt="" />
          <span className="ml-3 text-[10px] uppercase tracking-[0.12em] font-semibold px-2 py-0.5 rounded border" style={{ color: 'var(--bc-gold)', borderColor: 'rgba(201,164,87,0.45)' }}>{roleLabel}</span>
        </span>
      </div>

      {/* Right */}
      <div className="flex items-center gap-4">

        {/* ── Notifications bell ── */}
        <div className="relative" ref={notifsRef}>
          <button onClick={openNotifs}
            className="relative p-1.5 rounded-lg transition-colors hover:bg-white/10" aria-label="Notifications">
            <svg className="w-5 h-5" style={{ color: showNotifs ? 'var(--bc-gold)' : '#c7d0db' }}
              fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
            {liveUnread > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-4 h-4 flex items-center justify-center rounded-full font-bold"
                style={{ background: '#c0392b', color: '#fff', fontSize: '9px', boxShadow: '0 0 0 2px var(--bc-header)' }}>
                {liveUnread > 9 ? '9+' : liveUnread}
              </span>
            )}
          </button>

          {showNotifs && (
            <div className="absolute right-0 mt-2 rounded-lg border shadow-lg z-50 flex flex-col"
              style={{
                background: 'var(--bc-navy)',
                borderColor: 'var(--bc-border)',
                width: 'min(340px, calc(100vw - 1.5rem))',
                maxHeight: '420px',
              }}>
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0"
                style={{ borderColor: 'var(--bc-border)' }}>
                <span className="text-sm font-semibold" style={{ color: 'var(--bc-dark)' }}>Notifications</span>
                {notifs.some(n => !n.read) && (
                  <button onClick={markAllRead}
                    className="text-xs font-semibold hover:underline"
                    style={{ color: 'var(--bc-gold-ink)' }}>
                    Mark all read
                  </button>
                )}
              </div>

              {/* Body */}
              <div className="overflow-y-auto flex-1">
                {notifsLoading ? (
                  <div className="py-10 text-center text-sm" style={{ color: 'var(--bc-muted)' }}>
                    Loading…
                  </div>
                ) : notifs.length === 0 ? (
                  <div className="py-10 text-center">
                                        <div className="text-sm font-medium">All caught up</div>
                    <div className="text-xs mt-1" style={{ color: 'var(--bc-muted)' }}>
                      No notifications yet
                    </div>
                  </div>
                ) : (
                  notifs.map((n, i) => (
                    <div key={n.id}
                      onClick={() => {
                        if (n.link && n.link.startsWith('/') && !n.link.startsWith('//')) router.push(n.link)
                        setShowNotifs(false)
                      }}
                      className="px-4 py-3 flex gap-3 transition-colors border-b"
                      style={{
                        borderColor: 'var(--bc-border)',
                        background: n.read ? 'transparent' : 'rgba(201,164,87,0.04)',
                        cursor: n.link ? 'pointer' : 'default',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(13,27,42,0.04)')}
                      onMouseLeave={e => (e.currentTarget.style.background = n.read ? 'transparent' : 'rgba(201,164,87,0.04)')}>
                      {/* Unread dot */}
                      <div className="flex-shrink-0 mt-1.5">
                        {!n.read
                          ? <div className="w-2 h-2 rounded-full" style={{ background: 'var(--bc-gold)' }} />
                          : <div className="w-2 h-2" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold leading-tight truncate">{n.title}</div>
                        <div className="text-xs mt-0.5 leading-snug line-clamp-2"
                          style={{ color: 'var(--bc-muted)' }}>{n.body}</div>
                        <div className="text-xs mt-1" style={{ color: 'var(--bc-muted)', opacity: 0.6 }}>
                          {timeAgo(n.created_at)}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── User menu ── */}
        <div className="relative" ref={userMenuRef}>
          <button onClick={() => { setShowUserMenu(!showUserMenu); setShowNotifs(false) }}
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-white/10">
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
              style={{ background: 'var(--bc-gold)', color: 'var(--bc-dark)' }}>{initials}</div>
            <span className="hidden sm:inline text-sm font-medium text-white">{profile.full_name || profile.email}</span>
            <svg className="w-4 h-4" style={{ color: '#c7d0db' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showUserMenu && (
            <div className="absolute right-0 mt-1 w-52 rounded-lg border shadow-lg py-1 z-50"
              style={{ background: 'var(--bc-navy)', borderColor: 'var(--bc-border)' }}>
              <div className="px-3 py-2 border-b" style={{ borderColor: 'var(--bc-border)' }}>
                <div className="text-xs font-semibold" style={{ color: 'var(--bc-dark)' }}>{profile.full_name}</div>
                <div className="text-xs" style={{ color: 'var(--bc-muted)' }}>{profile.email}</div>
              </div>
              <button onClick={() => { setShowUserMenu(false); router.push('/profile') }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-slate-100 transition-colors">
                My Profile
              </button>
              <button onClick={handleSignOut}
                className="w-full text-left px-3 py-2 text-sm hover:bg-slate-100 transition-colors"
                style={{ color: '#c0392b' }}>
                Sign Out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
