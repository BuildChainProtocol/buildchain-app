'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

interface NavItem {
  href: string
  label: string
  icon: React.ReactNode
  badge?: number
}

interface SidebarProps {
  items: NavItem[]
  isOpen?: boolean
}

export default function Sidebar({ items, isOpen = false }: SidebarProps) {
  const pathname = usePathname()

  return (
    <aside
      className={cn(
        // Base: fixed sidebar, always present in the DOM
        'fixed top-14 left-0 bottom-0 w-[220px] border-r flex flex-col overflow-y-auto z-40',
        // Slide transition
        'transition-transform duration-300 ease-in-out',
        // Mobile: hidden by default, visible when isOpen
        // Desktop (md+): always visible via md:translate-x-0 override
        isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
      )}
      style={{ background: 'var(--bc-navy)', borderColor: 'var(--bc-border)' }}
    >
      <nav className="flex-1 py-4">
        {items.map(item => {
          const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href + '/'))
          return (
            <Link key={item.href} href={item.href}
              className={cn(
                'flex items-center gap-2.5 px-5 py-2.5 text-sm font-medium transition-all border-l-2',
                isActive
                  ? 'border-l-[var(--bc-gold)] text-[var(--bc-gold)] bg-[rgba(201,168,76,0.1)]'
                  : 'border-l-transparent text-[var(--bc-muted)] hover:bg-white/5 hover:text-white'
              )}>
              <span className="w-4 h-4 flex-shrink-0">{item.icon}</span>
              <span className="flex-1">{item.label}</span>
              {item.badge && item.badge > 0 && (
                <span className="text-xs font-bold px-1.5 py-0.5 rounded-full"
                  style={{ background: '#e74c3c', color: '#fff' }}>{item.badge}</span>
              )}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
