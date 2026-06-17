import { createClient } from '@/lib/supabase/server'
import StatCard from '@/components/ui/StatCard'
import { formatCurrency, getDrawProgress, timeAgo } from '@/lib/utils'
import Link from 'next/link'

export default async function AdminDashboard() {
  const supabase = createClient()

  // Fetch all data in parallel
  const [
    { data: projects },
    { data: pendingDraws },
    { data: allDraws },
    { data: activity },
  ] = await Promise.all([
    supabase.from('projects').select('*, borrowers(company_name), lenders(company_name)').order('created_at', { ascending: false }),
    supabase.from('draw_requests').select('*').in('status', ['pending', 'submitted']),
    supabase.from('draw_requests').select('amount').eq('status', 'funded'),
    supabase.from('activity_log').select('*, profiles(full_name)').order('created_at', { ascending: false }).limit(8),
  ])

  const totalPortfolio = projects?.reduce((sum, p) => sum + p.loan_amount, 0) || 0
  const totalFunded = allDraws?.reduce((sum, d) => sum + d.amount, 0) || 0

  const stageColor: Record<string, string> = {
    active: 'badge-green', approved: 'badge-blue', review: 'badge-yellow',
    application: 'badge-gray', complete: 'badge-blue', cancelled: 'badge-red',
  }
  const stageLabel: Record<string, string> = {
    active: 'Active', approved: 'Approved', review: 'In Review',
    application: 'Application', complete: 'Complete', cancelled: 'Cancelled',
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Platform Overview</h1>
        <p style={{ color: 'var(--bc-muted)' }} className="text-sm mt-1">BuildChain Protocol — Admin Console</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Active Projects" value={projects?.filter(p => p.stage === 'active').length || 0} icon="🏗" sub={`${projects?.length || 0} total`} />
        <StatCard label="Total Portfolio" value={formatCurrency(totalPortfolio)} icon="💰" iconBg="rgba(45,125,210,0.15)" sub={`across ${projects?.length || 0} projects`} />
        <StatCard label="Pending Draws" value={pendingDraws?.length || 0} icon="📋" iconBg="rgba(243,156,18,0.15)" sub={pendingDraws && pendingDraws.length > 0 ? '⚠ Needs review' : 'All clear'} subColor={pendingDraws && pendingDraws.length > 0 ? 'orange' : 'default'} />
        <StatCard label="Funds Disbursed" value={formatCurrency(totalFunded)} icon="✅" iconBg="rgba(46,204,113,0.15)" sub="YTD funded draws" subColor="green" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
        {/* Portfolio draw progress */}
        <div className="rounded-xl border p-5" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold">Portfolio Draw Progress</h2>
            <span className="text-xs" style={{ color: 'var(--bc-muted)' }}>% of loan drawn</span>
          </div>
          <div className="space-y-3">
            {projects?.map(project => {
              const pct = getDrawProgress(project.amount_drawn, project.loan_amount)
              const barColor = pct > 80 ? '#e74c3c' : pct > 50 ? 'var(--bc-gold)' : 'var(--bc-blue)'
              return (
                <div key={project.id}>
                  <div className="flex justify-between text-xs mb-1">
                    <Link href={`/admin/projects/${project.id}`} className="hover:underline" style={{ color: 'var(--bc-text)' }}>
                      {project.name}
                    </Link>
                    <span style={{ color: barColor }}>{pct}%</span>
                  </div>
                  <div className="rounded-full overflow-hidden h-1.5" style={{ background: 'rgba(255,255,255,0.08)' }}>
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: barColor }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Activity feed */}
        <div className="rounded-xl border p-5" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
          <h2 className="text-sm font-bold mb-4">Recent Activity</h2>
          <div className="space-y-0">
            {activity?.map(item => (
              <div key={item.id} className="flex gap-3 py-2.5 border-b last:border-0" style={{ borderColor: 'rgba(42,63,87,0.5)' }}>
                <div className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0" style={{
                  background: item.action.includes('funded') ? '#2ecc71' : item.action.includes('declined') ? '#e74c3c' : item.action.includes('submitted') ? 'var(--bc-gold)' : 'var(--bc-blue)'
                }} />
                <div>
                  <div className="text-xs leading-relaxed capitalize">{item.action.replace(/_/g, ' ')}
                    {item.details && typeof item.details === 'object' && 'amount' in (item.details as object) &&
                      <span style={{ color: 'var(--bc-gold)' }}> · {formatCurrency((item.details as { amount: number }).amount)}</span>}
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--bc-muted)' }}>{timeAgo(item.created_at)}</div>
                </div>
              </div>
            ))}
            {(!activity || activity.length === 0) && (
              <p className="text-sm text-center py-4" style={{ color: 'var(--bc-muted)' }}>No recent activity</p>
            )}
          </div>
        </div>
      </div>

      {/* Projects table */}
      <div className="rounded-xl border overflow-hidden" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--bc-border)' }}>
          <h2 className="text-sm font-bold">All Projects</h2>
          <Link href="/admin/projects" className="text-xs font-semibold hover:underline" style={{ color: 'var(--bc-gold)' }}>View all →</Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b" style={{ borderColor: 'var(--bc-border)' }}>
                {['Project', 'Borrower', 'Lender', 'Loan', 'Drawn', 'Stage'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--bc-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {projects?.map(p => (
                <tr key={p.id} className="border-b last:border-0 hover:bg-white/[0.02]" style={{ borderColor: 'rgba(42,63,87,0.4)' }}>
                  <td className="px-4 py-3">
                    <Link href={`/admin/projects/${p.id}`} className="font-semibold hover:underline" style={{ color: 'var(--bc-gold)' }}>{p.name}</Link>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--bc-muted)' }}>{p.loan_number}</div>
                  </td>
                  <td className="px-4 py-3 text-sm">{(p.borrowers as { company_name: string } | null)?.company_name}</td>
                  <td className="px-4 py-3 text-sm">{(p.lenders as { company_name: string } | null)?.company_name}</td>
                  <td className="px-4 py-3 font-semibold">{formatCurrency(p.loan_amount)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-14 rounded-full overflow-hidden h-1.5" style={{ background: 'rgba(255,255,255,0.08)' }}>
                        <div className="h-full rounded-full" style={{ width: `${getDrawProgress(p.amount_drawn, p.loan_amount)}%`, background: 'var(--bc-gold)' }} />
                      </div>
                      <span className="text-xs">{getDrawProgress(p.amount_drawn, p.loan_amount)}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-3"><span className={`badge ${stageColor[p.stage] || 'badge-gray'}`}>{stageLabel[p.stage] || p.stage}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
