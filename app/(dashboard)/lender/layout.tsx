import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Topbar from '@/components/shared/Topbar'
import Sidebar from '@/components/shared/Sidebar'

const lenderNav = [
  { href: '/lender', label: 'Portfolio', icon: '▦' },
  { href: '/lender/loans', label: 'My Loans', icon: '🏦' },
  { href: '/lender/approvals', label: 'Approvals', icon: '✅', badge: 0 },
  { href: '/lender/documents', label: 'Documents', icon: '📁' },
]

export default async function LenderLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single()
  if (!profile || (profile.role !== 'lender' && profile.role !== 'admin')) redirect('/login')

  const { data: lender } = await supabase.from('lenders').select('id').eq('profile_id', user.id).single()
  let pendingCount = 0

  if (lender) {
    const { data: projects } = await supabase.from('projects').select('id').eq('lender_id', lender.id)
    if (projects && projects.length > 0) {
      const { count } = await supabase.from('draw_requests').select('*', { count: 'exact', head: true })
        .in('project_id', projects.map(p => p.id)).in('status', ['pending', 'submitted'])
      pendingCount = count || 0
    }
  }

  const navWithBadge = lenderNav.map(n => n.href === '/lender/approvals' ? { ...n, badge: pendingCount } : n)
  const { count: notifCount } = await supabase.from('notifications').select('*', { count: 'exact', head: true }).eq('user_id', user.id).eq('read', false)

  return (
    <div className="min-h-screen" style={{ background: 'var(--bc-dark)' }}>
      <Topbar profile={profile} unreadCount={notifCount || 0} />
      <div className="flex pt-14">
        <Sidebar items={navWithBadge} />
        <main className="ml-[220px] flex-1 p-7 min-h-[calc(100vh-56px)]">{children}</main>
      </div>
    </div>
  )
}
