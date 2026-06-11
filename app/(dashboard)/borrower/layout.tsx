import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Topbar from '@/components/shared/Topbar'
import Sidebar from '@/components/shared/Sidebar'

const borrowerNav = [
  { href: '/borrower', label: 'My Dashboard', icon: '▦' },
  { href: '/borrower/projects', label: 'My Projects', icon: '🏗' },
  { href: '/borrower/draw', label: 'Submit Draw', icon: '💵' },
  { href: '/borrower/documents', label: 'Documents', icon: '📁', badge: 0 },
]

export default async function BorrowerLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single()
  if (!profile || (profile.role !== 'borrower' && profile.role !== 'admin')) redirect(`/${profile?.role || 'login'}`)

  // Get overdue doc count
  const { data: borrower } = await supabase.from('borrowers').select('id').eq('profile_id', user.id).single()
  let docBadge = 0
  if (borrower) {
    const { data: projects } = await supabase.from('projects').select('id').eq('borrower_id', borrower.id)
    if (projects && projects.length > 0) {
      const projectIds = projects.map(p => p.id)
      const { count } = await supabase.from('documents').select('*', { count: 'exact', head: true })
        .in('project_id', projectIds).in('status', ['required', 'overdue'])
      docBadge = count || 0
    }
  }

  const navWithBadge = borrowerNav.map(n => n.href === '/borrower/documents' ? { ...n, badge: docBadge } : n)
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
