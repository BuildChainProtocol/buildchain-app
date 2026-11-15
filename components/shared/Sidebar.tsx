'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

interface NavItem {
  href: string
  label: string
  group?: string
  icon?: React.ReactNode
  badge?: number
}

interface SidebarProps {
  items: NavItem[]
  isOpen?: boolean
}

export default function Sidebar({ items, isOpen = false }: SidebarProps) {
  const pathname = usePathname()

  // Group consecutive items under their section label, in the order given.
  const groups: { label?: string; items: NavItem[] }[] = []
  for (const item of items) {
    const last = groups[groups.length - 1]
    if (last && last.label === item.group) last.items.push(item)
    else groups.push({ label: item.group, items: [item] })
  }

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
      style={{ background: '#f8f9fb', borderColor: 'var(--bc-border)' }}
    >
      <nav className="flex-1 py-4 px-3 space-y-5">
        {groups.map((group, gi) => {
          const groupActive = group.items.some(i => isActive(pathname, i.href))
          return (
            <div key={group.label ?? gi}>
              {group.label && (
                <div className="px-3 mb-1.5 text-[10px] uppercase tracking-[0.12em]"
                  style={{ color: groupActive ? 'var(--bc-dark)' : 'var(--bc-muted)', fontWeight: groupActive ? 700 : 500 }}>
                  {group.label}
                </div>
              )}
              <div className="space-y-0.5">
                {group.items.map(item => {
                  const active = isActive(pathname, item.href)
                  return (
                    <Link key={item.href} href={item.href}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors',
                        active
                          ? 'font-medium text-white'
                          : 'text-[#2f3640] hover:bg-[#e9edf2]'
                      )}
                      style={active ? { background: 'var(--bc-dark)', boxShadow: 'inset 3px 0 0 var(--bc-gold)' } : undefined}>
                      <span className="flex-1">{item.label}</span>
                      {!!item.badge && item.badge > 0 && (
                        <span className="text-[11px] font-semibold min-w-[20px] text-center px-1.5 py-px rounded-full"
                          style={active
                            ? { background: 'var(--bc-gold)', color: 'var(--bc-dark)' }
                            : { background: '#c0392b', color: '#fff' }}>{item.badge}</span>
                      )}
                    </Link>
                  )
                })}
              </div>
            </div>
          )
        })}
      </nav>
      <div className="px-6 py-4 border-t text-[11px]" style={{ borderColor: 'var(--bc-border)', color: 'var(--bc-muted)' }}>
        BuildChain™ Protocol
      </div>
    </aside>
  )
}

function isActive(pathname: string, href: string) {
  // A role's home ("/admin") is active only on itself; deeper links also match their sub-pages.
  const isHome = href.split('/').filter(Boolean).length === 1
  return pathname === href || (!isHome && pathname.startsWith(href + '/'))
}
