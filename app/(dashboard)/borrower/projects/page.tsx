import { createClient } from '@/lib/supabase/server'
import { formatCurrency, getDrawProgress, getStageLabel, timeAgo } from '@/lib/utils'
import Link from 'next/link'

export default async function BorrowerProjectsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: borrower } = await supabase
    .from('borrowers')
    .select('id')
    .eq('profile_id', user?.id)
    .single()

  const { data: projects } = await supabase
    .from('projects')
    .select('*, draw_requests(id, status, amount), lenders(company_name)')
    .eq('borrower_id', borrower?.id ?? '')
    .order('created_at', { ascending: false })

  const stageBadge: Record<string, string> = {
    active: 'badge-green', approved: 'badge-blue', review: 'badge-yellow',
    application: 'badge-gray', complete: 'badge-blue', cancelled: 'badge-red',
  }

  const activeProjects = projects?.filter(p => p.stage === 'active') || []
  const totalLoan = projects?.reduce((s, p) => s + p.loan_amount, 0) || 0
  const totalDrawn = projects?.reduce((s, p) => s + (p.amount_drawn || 0), 0) || 0

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">My Projects</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--bc-muted)' }}>All your construction loan projects in one place</p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Total Projects', value: projects?.length || 0, sub: `${activeProjects.length} active` },
          { label: 'Total Loan Value', value: formatCurrency(totalLoan), sub: 'across all projects' },
          { label: 'Available to Draw', value: formatCurrency(totalLoan - totalDrawn), sub: `${formatCurrency(totalDrawn)} drawn` },
        ].map(s => (
          <div key={s.label} className="rounded-xl border p-5" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
            <div className="text-xs font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--bc-muted)' }}>{s.label}</div>
            <div className="text-xl font-bold">{s.value}</div>
            <div className="text-xs mt-1" style={{ color: 'var(--bc-muted)' }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Projects list */}
      {!projects?.length ? (
        <div className="rounded-xl border px-5 py-16 text-center" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
          <div className="text-4xl mb-3">🏗</div>
          <div className="font-semibold mb-1">No projects yet</div>
          <div className="text-sm" style={{ color: 'var(--bc-muted)' }}>Your construction loan projects will appear here once your lender sets them up.</div>
        </div>
      ) : (
        <div className="space-y-4">
          {projects.map(p => {
            const draws = p.draw_requests as { id: string; status: string; amount: number }[] | null || []
            const pendingDraws = draws.filter(d => ['submitted', 'pending'].includes(d.status))
            const lender = p.lenders as { company_name: string } | null
            const drawPct = getDrawProgress(p.amount_drawn || 0, p.loan_amount)

            return (
              <div key={p.id} className="rounded-xl border overflow-hidden" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
                <div className="px-5 py-4 flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2.5 mb-1">
                      <h2 className="font-bold text-base">{p.name}</h2>
                      <span className={`badge ${stageBadge[p.stage] || 'badge-gray'}`}>{getStageLabel(p.stage)}</span>
                      {pendingDraws.length > 0 && (
                        <span className="text-xs px-2 py-0.5 rounded-full font-bold" style={{ background: 'rgba(243,156,18,0.2)', color: 'var(--bc-gold)' }}>
                          {pendingDraws.length} draw pending
                        </span>
                      )}
                    </div>
                    <div className="text-xs" style={{ color: 'var(--bc-muted)' }}>
                      {[p.address, p.city, p.state].filter(Boolean).join(', ')}
                      {lender?.company_name && ` · ${lender.company_name}`}
                      {p.loan_number && ` · #${p.loan_number}`}
                    </div>
                  </div>
                  <Link href="/borrower/draw"
                    className="px-3 py-1.5 rounded-lg text-xs font-bold flex-shrink-0 ml-4"
                    style={{ background: 'var(--bc-gold)', color: 'var(--bc-dark)' }}>
                    + Submit Draw
                  </Link>
                </div>

                <div className="px-5 pb-4">
                  <div className="grid grid-cols-3 gap-4 mb-3 text-sm">
                    <div>
                      <div className="text-xs uppercase tracking-wide mb-1" style={{ color: 'var(--bc-muted)' }}>Loan Amount</div>
                      <div className="font-bold">{formatCurrency(p.loan_amount)}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wide mb-1" style={{ color: 'var(--bc-muted)' }}>Drawn to Date</div>
                      <div className="font-bold" style={{ color: 'var(--bc-gold)' }}>{formatCurrency(p.amount_drawn || 0)}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wide mb-1" style={{ color: 'var(--bc-muted)' }}>Available</div>
                      <div className="font-bold" style={{ color: '#2ecc71' }}>{formatCurrency(p.loan_amount - (p.amount_drawn || 0))}</div>
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-xs mb-1" style={{ color: 'var(--bc-muted)' }}>
                      <span>Draw utilization</span>
                      <span>{drawPct}%</span>
                    </div>
                    <div className="rounded-full overflow-hidden h-1.5" style={{ background: 'rgba(255,255,255,0.06)' }}>
                      <div className="h-full rounded-full" style={{ width: `${drawPct}%`, background: drawPct > 80 ? '#e74c3c' : 'var(--bc-gold)' }} />
                    </div>
                  </div>
                  {p.maturity_date && (
                    <div className="mt-3 text-xs" style={{ color: 'var(--bc-muted)' }}>
                      Matures {new Date(p.maturity_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
