import { createClient } from '@/lib/supabase/server'
import { formatCurrency, getStageLabel, timeAgo } from '@/lib/utils'
import Link from 'next/link'

function StageBadge({ stage }: { stage: string }) {
  const map: Record<string, string> = {
    active: 'badge-green', approved: 'badge-blue', review: 'badge-yellow',
    application: 'badge-gray', complete: 'badge-blue', cancelled: 'badge-red',
  }
  return <span className={`badge ${map[stage] || 'badge-gray'}`}>{getStageLabel(stage)}</span>
}

export default async function LenderLoansPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Get lender profile tied to this user
  const { data: lender } = await supabase
    .from('lenders')
    .select('id, company_name')
    .eq('profile_id', user?.id)
    .single()

  const { data: projects } = await supabase
    .from('projects')
    .select('*, borrowers(company_name, contact_name, rating), draw_requests(id, status, amount)')
    .eq('lender_id', lender?.id ?? '')
    .order('created_at', { ascending: false })

  const total = projects?.length || 0
  const active = projects?.filter(p => p.stage === 'active').length || 0
  const totalLoan = projects?.reduce((s, p) => s + (p.loan_amount || 0), 0) || 0
  const totalDrawn = projects?.reduce((s, p) => s + (p.amount_drawn || 0), 0) || 0
  const pendingDraws = projects?.reduce((s, p) => {
    const draws = p.draw_requests as { id: string; status: string; amount: number }[] | null || []
    return s + draws.filter(d => ['submitted', 'pending'].includes(d.status)).length
  }, 0) || 0

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Loan Portfolio</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--bc-muted)' }}>
          All active construction loans managed through BuildChain
        </p>
      </div>

      {/* Portfolio summary cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Loans', value: total, sub: `${active} active builds` },
          { label: 'Portfolio Value', value: formatCurrency(totalLoan), sub: 'total commitments' },
          { label: 'Capital Deployed', value: formatCurrency(totalDrawn), sub: `${totalLoan ? Math.round(totalDrawn/totalLoan*100) : 0}% drawn` },
          { label: 'Pending Draws', value: pendingDraws, sub: 'awaiting approval', color: pendingDraws > 0 ? 'var(--bc-gold)' : undefined },
        ].map(s => (
          <div key={s.label} className="rounded-xl border p-5" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
            <div className="text-xs font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--bc-muted)' }}>{s.label}</div>
            <div className="text-xl font-bold" style={{ color: s.color }}>{s.value}</div>
            <div className="text-xs mt-1" style={{ color: 'var(--bc-muted)' }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Pending draws alert */}
      {pendingDraws > 0 && (
        <div className="rounded-xl border px-5 py-4 mb-6 flex items-center justify-between"
          style={{ background: 'rgba(243,156,18,0.08)', borderColor: 'rgba(243,156,18,0.3)' }}>
          <div className="flex items-center gap-3">
            <span className="text-xl">⏳</span>
            <div>
              <div className="font-bold text-sm" style={{ color: 'var(--bc-gold)' }}>{pendingDraws} draw request{pendingDraws !== 1 ? 's' : ''} need{pendingDraws === 1 ? 's' : ''} your review</div>
              <div className="text-xs mt-0.5" style={{ color: 'var(--bc-muted)' }}>Approve to create XRPL escrow and lock funds on-chain</div>
            </div>
          </div>
          <Link href="/lender/approvals"
            className="px-4 py-2 rounded-lg text-sm font-bold flex-shrink-0"
            style={{ background: 'var(--bc-gold)', color: 'var(--bc-dark)' }}>
            Review Draws →
          </Link>
        </div>
      )}

      {/* Loans table */}
      {!projects?.length ? (
        <div className="rounded-xl border px-5 py-20 text-center" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
          <div className="text-4xl mb-3">🏗</div>
          <div className="font-semibold mb-1">No loans yet</div>
          <div className="text-sm" style={{ color: 'var(--bc-muted)' }}>Loans assigned to your account will appear here.</div>
        </div>
      ) : (
        <div className="rounded-xl border overflow-hidden" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
          <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--bc-border)' }}>
            <h2 className="text-sm font-bold">All Loans ({total})</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b" style={{ borderColor: 'var(--bc-border)' }}>
                  {['Project', 'Borrower', 'Loan Amount', 'Drawn', 'Available', 'Stage', 'Pending'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wide whitespace-nowrap"
                      style={{ color: 'var(--bc-muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {projects.map(p => {
                  const draws = p.draw_requests as { id: string; status: string; amount: number }[] | null || []
                  const pending = draws.filter(d => ['submitted', 'pending'].includes(d.status))
                  const borrower = p.borrowers as { company_name: string; contact_name: string | null; rating: string } | null
                  const available = (p.loan_amount || 0) - (p.amount_drawn || 0)
                  const drawPct = p.loan_amount ? Math.round((p.amount_drawn || 0) / p.loan_amount * 100) : 0

                  return (
                    <tr key={p.id} className="border-b last:border-0 hover:bg-white/[0.02]"
                      style={{ borderColor: 'rgba(42,63,87,0.4)' }}>
                      <td className="px-4 py-3">
                        <div className="font-semibold">{p.name}</div>
                        <div className="text-xs mt-0.5" style={{ color: 'var(--bc-muted)' }}>
                          {[p.city, p.state].filter(Boolean).join(', ')}
                          {p.loan_number && ` · #${p.loan_number}`}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div>{borrower?.company_name || '—'}</div>
                        {borrower?.rating && (
                          <div className="text-xs mt-0.5 font-bold" style={{ color: borrower.rating === 'preferred' ? '#2ecc71' : borrower.rating === 'standard' ? 'var(--bc-blue)' : borrower.rating === 'new' ? 'var(--bc-gold)' : '#e74c3c' }}>
                            {{ preferred: 'A', standard: 'B', new: 'C', probation: 'D' }[borrower.rating] || borrower.rating}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 font-semibold">{formatCurrency(p.loan_amount)}</td>
                      <td className="px-4 py-3">
                        <div style={{ color: 'var(--bc-gold)' }}>{formatCurrency(p.amount_drawn || 0)}</div>
                        <div className="rounded-full overflow-hidden h-1 mt-1.5 w-16" style={{ background: 'rgba(255,255,255,0.06)' }}>
                          <div className="h-full rounded-full" style={{ width: `${drawPct}%`, background: drawPct > 80 ? '#e74c3c' : 'var(--bc-gold)' }} />
                        </div>
                      </td>
                      <td className="px-4 py-3" style={{ color: '#2ecc71' }}>{formatCurrency(available)}</td>
                      <td className="px-4 py-3"><StageBadge stage={p.stage} /></td>
                      <td className="px-4 py-3">
                        {pending.length > 0 ? (
                          <Link href="/lender/approvals"
                            className="text-xs px-2.5 py-1 rounded-full font-bold"
                            style={{ background: 'rgba(243,156,18,0.2)', color: 'var(--bc-gold)' }}>
                            {pending.length} pending
                          </Link>
                        ) : (
                          <span className="text-xs" style={{ color: 'var(--bc-muted)' }}>—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Portfolio footer */}
          <div className="px-4 py-3 border-t flex items-center justify-between text-xs"
            style={{ borderColor: 'var(--bc-border)', color: 'var(--bc-muted)' }}>
            <span>{total} loan{total !== 1 ? 's' : ''} in portfolio</span>
            <span>
              {formatCurrency(totalDrawn)} of {formatCurrency(totalLoan)} deployed
              ({totalLoan ? Math.round(totalDrawn/totalLoan*100) : 0}%)
            </span>
          </div>
        </div>
      )}

      {/* Maturity alert section */}
      {projects?.some(p => p.maturity_date) && (
        <div className="mt-6 rounded-xl border overflow-hidden" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
          <div className="px-5 py-4 border-b" style={{ borderColor: 'var(--bc-border)' }}>
            <h2 className="text-sm font-bold">Maturity Schedule</h2>
          </div>
          <div className="divide-y" style={{ borderColor: 'var(--bc-border)' }}>
            {projects.filter(p => p.maturity_date).sort((a, b) => new Date(a.maturity_date).getTime() - new Date(b.maturity_date).getTime()).map(p => {
              const daysLeft = Math.ceil((new Date(p.maturity_date).getTime() - Date.now()) / 86400000)
              const urgent = daysLeft < 60
              return (
                <div key={p.id} className="px-5 py-3 flex items-center justify-between text-sm">
                  <div>
                    <span className="font-medium">{p.name}</span>
                    <span className="ml-2 text-xs" style={{ color: 'var(--bc-muted)' }}>{formatCurrency(p.loan_amount)}</span>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold" style={{ color: urgent ? '#e74c3c' : undefined }}>
                      {new Date(p.maturity_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </div>
                    <div className="text-xs mt-0.5" style={{ color: urgent ? '#e74c3c' : 'var(--bc-muted)' }}>
                      {daysLeft > 0 ? `${daysLeft} days` : 'Matured'}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
