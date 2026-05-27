import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Topbar from '@/components/shared/Topbar'
import Sidebar from '@/components/shared/Sidebar'

const adminNav = [
  { href: '/admin', label: 'Dashboard', icon: '▦' },
  { href: '/admin/projects', label: 'Projects', icon: '🏗' },
  { href: '/admin/draws', label: 'Draw Requests', icon: '💵', badge: 0 },
  { href: '/admin/documents', label: 'Documents', icon: '📁' },
  { href: '/admin/lenders', label: 'Lenders', icon: '🏦' },
  { href: '/admin/borrowers', label: 'Borrowers', icon: '👥' },
]

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single()
  if (!profile || profile.role !== 'admin') redirect(`/${profile?.role || 'borrower'}`)

  // Get pending draw count for badge
  const { count } = await supabase.from('draw_requests').select('*', { count: 'exact', head: true }).eq('status', 'pending')
  const navWithBadge = adminNav.map(n => n.href === '/admin/draws' ? { ...n, badge: count || 0 } : n)

  // Get unread notifications
  const { count: notifCount } = await supabase.from('notifications').select('*', { count: 'exact', head: true }).eq('user_id', user.id).eq('read', false)

  return (
    <div className="min-h-screen" style={{ background: 'var(--bc-dark)' }}>
      <Topbar profile={profile} unreadCount={notifCount || 0} />
      <div className="flex pt-14">
        <Sidebar items={navWithBadge} />
        <main className="ml-[220px] flex-1 p-7 min-h-[calc(100vh-56px)]">
          {children}
        </main>
      </div>
    </div>
  )
}
