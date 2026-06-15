import { createClient } from '@/lib/supabase/server'
import { formatCurrency, getDrawProgress } from '@/lib/utils'
import Link from 'next/link'

export default async function AdminProjectsPage() {
  const supabase = createClient()
  const { data: projects } = await supabase
    .from('projects')
    .select('*, borrowers(company_name), lenders(company_name)')
    .is('archived_at', null)
    .order('created_at', { ascending: false })

  const stages = ['application', 'review', 'approved', 'active', 'complete', 'cancelled']
  const stageBadge: Record<string, string> = {
    active: 'badge-green', approved: 'badge-blue', review: 'badge-yellow',
    application: 'badge-gray', complete: 'badge-blue', cancelled: 'badge-red',
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Projects</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--bc-muted)' }}>{projects?.length || 0} projects on the platform</p>
        </div>
        <Link href="/admin/projects/new"
          className="px-4 py-2 rounded-lg text-sm font-bold"
          style={{ background: 'var(--bc-gold)', color: 'var(--bc-dark)' }}>
          + New Project
        </Link>
      </div>

      {/* Kanban-style stage columns */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {['review', 'approved', 'active', 'complete'].map(stage => {
          const stageProjects = projects?.filter(p => p.stage === stage) || []
          return (
            <div key={stage} className="rounded-xl border" style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'var(--bc-border)' }}>
              <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--bc-border)' }}>
                <span className="text-xs font-bold uppercase tracking-wide capitalize" style={{ color: 'var(--bc-muted)' }}>
                  {stage === 'active' ? 'Active Build' : stage}
                </span>
                <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }}>
                  {stageProjects.length}
                </span>
              </div>
              <div className="p-3 space-y-2 min-h-24">
                {stageProjects.map(p => (
                  <Link key={p.id} href={`/admin/projects/${p.id}`}
                    className="block rounded-lg p-3 border transition-all hover:border-[var(--bc-gold)]"
                    style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
                    <div className="font-semibold text-sm mb-1">{p.name}</div>
                    <div className="text-xs mb-2" style={{ color: 'var(--bc-muted)' }}>
                      {(p.borrowers as { company_name: string } | null)?.company_name}
                    </div>
                    <div className="text-xs mb-1.5 flex justify-between">
                      <span style={{ color: 'var(--bc-muted)' }}>{formatCurrency(p.loan_amount)}</span>
                      <span style={{ color: 'var(--bc-gold)' }}>{getDrawProgress(p.amount_drawn, p.loan_amount)}%</span>
                    </div>
                    <div className="rounded-full overflow-hidden h-1" style={{ background: 'rgba(255,255,255,0.08)' }}>
                      <div className="h-full rounded-full" style={{ width: `${getDrawProgress(p.amount_drawn, p.loan_amount)}%`, background: 'var(--bc-gold)' }} />
                    </div>
                  </Link>
                ))}
                {stageProjects.length === 0 && (
                  <div className="text-xs text-center py-4" style={{ color: 'var(--bc-muted)' }}>None</div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Full table */}
      <div className="rounded-xl border overflow-hidden" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
        <div className="px-5 py-4 border-b" style={{ borderColor: 'var(--bc-border)' }}>
          <h2 className="text-sm font-bold">All Projects</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b" style={{ borderColor: 'var(--bc-border)' }}>
                {['Project', 'Address', 'Borrower', 'Lender', 'Loan Amount', 'Drawn', 'Rate', 'Maturity', 'Stage'].map(h => (
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
                  <td className="px-4 py-3 text-xs">{p.address}, {p.city}</td>
                  <td className="px-4 py-3">{(p.borrowers as { company_name: string } | null)?.company_name}</td>
                  <td className="px-4 py-3">{(p.lenders as { company_name: string } | null)?.company_name}</td>
                  <td className="px-4 py-3 font-semibold">{formatCurrency(p.loan_amount)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-12 rounded-full overflow-hidden h-1.5" style={{ background: 'rgba(255,255,255,0.08)' }}>
                        <div className="h-full rounded-full" style={{ width: `${getDrawProgress(p.amount_drawn, p.loan_amount)}%`, background: 'var(--bc-gold)' }} />
                      </div>
                      <span className="text-xs">{getDrawProgress(p.amount_drawn, p.loan_amount)}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs">{p.interest_rate ? `${p.interest_rate}%` : '—'}</td>
                  <td className="px-4 py-3 text-xs">{p.maturity_date ? new Date(p.maturity_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</td>
                  <td className="px-4 py-3"><span className={`badge ${stageBadge[p.stage] || 'badge-gray'}`}>{p.stage}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
