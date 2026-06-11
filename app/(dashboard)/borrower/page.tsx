import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import StatCard from '@/components/ui/StatCard'
import { formatCurrency, getDrawProgress } from '@/lib/utils'
import Link from 'next/link'

export default async function BorrowerDashboard() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: borrower } = await supabase.from('borrowers').select('*').eq('profile_id', user.id).single()

  type BorrowerProject = { id: string; name: string; loan_amount: number; amount_drawn: number; stage: string; loan_number: string | null; lenders: { company_name: string } | null }
  let projects: BorrowerProject[] = []
  let pendingDraws: { amount: number }[] = []

  if (borrower) {
    const { data: p } = await supabase
      .from('projects')
      .select('*, lenders(company_name)')
      .eq('borrower_id', borrower.id)
      .order('created_at', { ascending: false })
    projects = (p as typeof projects) || []

    const projectIds = projects.map(p => p.id)
    if (projectIds.length > 0) {
      const { data: draws } = await supabase.from('draw_requests')
        .select('amount').in('project_id', projectIds).in('status', ['pending', 'submitted'])
      pendingDraws = draws || []
    }
  }

  const totalLoan = projects.reduce((s, p) => s + p.loan_amount, 0)
  const totalDrawn = projects.reduce((s, p) => s + p.amount_drawn, 0)
  const available = totalLoan - totalDrawn
  const pendingAmount = pendingDraws.reduce((s, d) => s + d.amount, 0)

  const stageBadge: Record<string, string> = {
    active: 'badge-green', approved: 'badge-blue', review: 'badge-yellow',
    application: 'badge-gray', complete: 'badge-blue', cancelled: 'badge-red',
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">My Dashboard</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--bc-muted)' }}>
          {borrower?.company_name || 'Your construction loan portal'}
        </p>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-6">
        <StatCard label="Active Projects" value={projects.filter(p => ['active', 'approved'].includes(p.stage)).length} icon="🏗" />
        <StatCard label="Total Loan Value" value={formatCurrency(totalLoan)} icon="💰" iconBg="rgba(45,125,210,0.15)" />
        <StatCard label="Available to Draw" value={formatCurrency(available)} icon="✅" iconBg="rgba(46,204,113,0.15)" subColor="green" sub="Ready to request" />
        <StatCard label="Pending Draws" value={pendingDraws.length} icon="⏳" iconBg="rgba(243,156,18,0.15)" sub={pendingAmount > 0 ? `${formatCurrency(pendingAmount)} in review` : 'None pending'} subColor={pendingAmount > 0 ? 'orange' : 'default'} />
      </div>

      <div className="grid grid-cols-2 gap-5">
        {projects.map(project => {
          const pct = getDrawProgress(project.amount_drawn, project.loan_amount)
          return (
            <div key={project.id} className="rounded-xl border p-5" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="font-bold">{project.name}</h3>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--bc-muted)' }}>
                    {project.loan_number} · {project.lenders?.company_name}
                  </div>
                </div>
                <span className={`badge ${stageBadge[project.stage] || 'badge-gray'}`}>{project.stage}</span>
              </div>

              <div className="space-y-2 text-sm mb-4">
                <div className="flex justify-between">
                  <span style={{ color: 'var(--bc-muted)' }}>Total Loan</span>
                  <span className="font-semibold">{formatCurrency(project.loan_amount)}</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: 'var(--bc-muted)' }}>Drawn to Date</span>
                  <span className="font-semibold">{formatCurrency(project.amount_drawn)}</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: 'var(--bc-muted)' }}>Available</span>
                  <span className="font-semibold text-green-400">{formatCurrency(project.loan_amount - project.amount_drawn)}</span>
                </div>
              </div>

              <div className="mb-4">
                <div className="flex justify-between text-xs mb-1">
                  <span style={{ color: 'var(--bc-muted)' }}>Loan utilization</span>
                  <span style={{ color: 'var(--bc-gold)' }}>{pct}%</span>
                </div>
                <div className="rounded-full overflow-hidden h-2" style={{ background: 'rgba(255,255,255,0.08)' }}>
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--bc-gold)' }} />
                </div>
              </div>

              {['active', 'approved'].includes(project.stage) && (
                <Link href="/borrower/draw"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold"
                  style={{ background: 'var(--bc-gold)', color: 'var(--bc-dark)' }}>
                  + Submit Draw Request
                </Link>
              )}
            </div>
          )
        })}

        {projects.length === 0 && (
          <div className="col-span-2 rounded-xl border p-12 text-center" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
            <div className="text-4xl mb-3">🏗</div>
            <p className="font-semibold mb-1">No projects yet</p>
            <p className="text-sm" style={{ color: 'var(--bc-muted)' }}>Your projects will appear here once your lender sets them up.</p>
          </div>
        )}
      </div>
    </div>
  )
}
