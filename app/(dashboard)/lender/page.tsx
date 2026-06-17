import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import StatCard from '@/components/ui/StatCard'
import { formatCurrency, getDrawProgress } from '@/lib/utils'
import Link from 'next/link'

export default async function LenderDashboard() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: lender } = await supabase.from('lenders').select('*').eq('profile_id', user.id).single()

  let projects: { id: string; name: string; loan_amount: number; amount_drawn: number; stage: string; loan_number: string | null; interest_rate: number | null; maturity_date: string | null; borrowers: { company_name: string } | null }[] = []
  let pendingDraws: { amount: number }[] = []

  if (lender) {
    const { data: p } = await supabase
      .from('projects')
      .select('*, borrowers(company_name)')
      .eq('lender_id', lender.id)
      .order('created_at', { ascending: false })
    projects = (p as typeof projects) || []

    if (projects.length > 0) {
      const { data: d } = await supabase.from('draw_requests')
        .select('amount').in('project_id', projects.map(p => p.id)).in('status', ['pending', 'submitted'])
      pendingDraws = d || []
    }
  }

  const totalCommitted = projects.reduce((s, p) => s + p.loan_amount, 0)
  const totalDrawn = projects.reduce((s, p) => s + p.amount_drawn, 0)
  const pendingAmount = pendingDraws.reduce((s, d) => s + d.amount, 0)
  const avgLtv = projects.length ? Math.round(totalDrawn / totalCommitted * 100) : 0

  const stageBadge: Record<string, string> = {
    active: 'badge-green', approved: 'badge-blue', review: 'badge-yellow',
    application: 'badge-gray', complete: 'badge-blue',
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">{lender?.company_name || 'My Portfolio'}</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--bc-muted)' }}>Construction loan portfolio · BuildChain Protocol</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Active Loans" value={projects.filter(p => p.stage === 'active').length} icon="🏦" sub={`${projects.length} total`} />
        <StatCard label="Total Committed" value={formatCurrency(totalCommitted)} icon="💵" iconBg="rgba(201,168,76,0.15)" sub={`${formatCurrency(totalDrawn)} drawn`} />
        <StatCard label="Pending Approvals" value={pendingDraws.length} icon="⏳" iconBg="rgba(243,156,18,0.15)" sub={pendingAmount > 0 ? `${formatCurrency(pendingAmount)} awaiting` : 'None'} subColor={pendingAmount > 0 ? 'orange' : 'default'} />
        <StatCard label="Avg Portfolio LTV" value={`${avgLtv}%`} icon="📊" iconBg="rgba(46,204,113,0.15)" sub={avgLtv < 80 ? '✓ Within policy' : '⚠ High LTV'} subColor={avgLtv < 80 ? 'green' : 'orange'} />
      </div>

      <div className="space-y-4">
        {projects.map(project => {
          const pct = getDrawProgress(project.amount_drawn, project.loan_amount)
          return (
            <div key={project.id} className="rounded-xl border p-5" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="font-bold text-base">{project.name}</h3>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--bc-muted)' }}>
                    {project.loan_number} · {project.borrowers?.company_name}
                  </div>
                </div>
                <span className={`badge ${stageBadge[project.stage] || 'badge-gray'}`}>{project.stage}</span>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mb-4">
                <div>
                  <div className="text-xs mb-0.5" style={{ color: 'var(--bc-muted)' }}>Loan Amount</div>
                  <div className="font-bold">{formatCurrency(project.loan_amount)}</div>
                </div>
                <div>
                  <div className="text-xs mb-0.5" style={{ color: 'var(--bc-muted)' }}>Drawn</div>
                  <div className="font-bold">{formatCurrency(project.amount_drawn)}</div>
                </div>
                <div>
                  <div className="text-xs mb-0.5" style={{ color: 'var(--bc-muted)' }}>Rate</div>
                  <div className="font-bold">{project.interest_rate ? `${project.interest_rate}%` : '—'}</div>
                </div>
                <div>
                  <div className="text-xs mb-0.5" style={{ color: 'var(--bc-muted)' }}>Maturity</div>
                  <div className="font-bold text-sm">{project.maturity_date ? new Date(project.maturity_date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '—'}</div>
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span style={{ color: 'var(--bc-muted)' }}>Draw utilization</span>
                  <span style={{ color: 'var(--bc-gold)' }}>{pct}%</span>
                </div>
                <div className="rounded-full overflow-hidden h-2" style={{ background: 'rgba(255,255,255,0.08)' }}>
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, background: pct > 90 ? '#e74c3c' : 'var(--bc-gold)' }} />
                </div>
              </div>
            </div>
          )
        })}

        {projects.length === 0 && (
          <div className="rounded-xl border p-12 text-center" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
            <div className="text-4xl mb-3">🏦</div>
            <p className="font-semibold mb-1">No loans assigned yet</p>
            <p className="text-sm" style={{ color: 'var(--bc-muted)' }}>Projects will appear here once they&apos;re assigned to your account.</p>
          </div>
        )}
      </div>
    </div>
  )
}
