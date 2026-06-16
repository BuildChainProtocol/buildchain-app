import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import DashboardShell from '@/components/shared/DashboardShell'

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

  const { data: borrower } = await supabase.from('borrowers').select('id').eq('profile_id', user.id).single()
  let docBadge = 0
  if (borrower) {
    const { data: projects } = await supabase.from('projects').select('id').eq('borrower_id', borrower.id)
    if (projects && projects.length > 0) {
      const { count } = await supabase.from('documents').select('*', { count: 'exact', head: true })
        .in('project_id', projects.map(p => p.id)).in('status', ['required', 'overdue'])
      docBadge = count || 0
    }
  }

  const navWithBadge = borrowerNav.map(n => n.href === '/borrower/documents' ? { ...n, badge: docBadge } : n)
  const { count: notifCount } = await supabase.from('notifications').select('*', { count: 'exact', head: true }).eq('user_id', user.id).eq('read', false)

  return (
    <DashboardShell profile={profile} items={navWithBadge} unreadCount={notifCount || 0}>
      {children}
    </DashboardShell>
  )
}
