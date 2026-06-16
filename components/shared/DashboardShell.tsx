'use client'

import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import Topbar from './Topbar'
import Sidebar from './Sidebar'
import type { Profile } from '@/lib/types/database'

interface NavItem {
  href: string
  label: string
  icon: React.ReactNode
  badge?: number
}

interface DashboardShellProps {
  profile: Profile
  items: NavItem[]
  unreadCount: number
  children: React.ReactNode
}

export default function DashboardShell({ profile, items, unreadCount, children }: DashboardShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const pathname = usePathname()

  // Close sidebar whenever route changes (handles mobile nav tap)
  useEffect(() => {
    setSidebarOpen(false)
  }, [pathname])

  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setSidebarOpen(false) }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  return (
    <div className="min-h-screen" style={{ background: 'var(--bc-dark)' }}>
      <Topbar
        profile={profile}
        unreadCount={unreadCount}
        onMenuToggle={() => setSidebarOpen(o => !o)}
      />

      {/* Dark overlay — mobile only, when sidebar is open */}
      <div
        className={`fixed inset-0 z-30 bg-black/60 md:hidden transition-opacity duration-300 ${
          sidebarOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={() => setSidebarOpen(false)}
      />

      <div className="flex pt-14">
        <Sidebar items={items} isOpen={sidebarOpen} />
        <main className="flex-1 md:ml-[220px] p-4 md:p-7 min-h-[calc(100vh-56px)] min-w-0">
          {children}
        </main>
      </div>
    </div>
  )
}
