import { createClient } from '@/lib/supabase/server'

export default async function AdminLendersPage() {
  const supabase = createClient()
  const { data: lenders } = await supabase
    .from('lenders')
    .select('*, profiles(full_name, email), projects(id, loan_amount, stage)')
    .order('created_at', { ascending: false })

  const activeLenders = lenders?.filter(l => l.active) || []
  const totalCommitted = lenders?.reduce((sum, l) => {
    const projects = l.projects as { id: string; loan_amount: number; stage: string }[] | null
    return sum + (projects?.filter(p => p.stage === 'active').reduce((s, p) => s + p.loan_amount, 0) || 0)
  }, 0) || 0

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Lenders</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--bc-muted)' }}>
            {activeLenders.length} active lenders on the platform
          </p>
        </div>
        <button
          className="px-4 py-2 rounded-lg text-sm font-bold"
          style={{ background: 'var(--bc-gold)', color: 'var(--bc-dark)' }}
        >
          + Add Lender
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="rounded-xl border p-5" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
          <div className="text-xs font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--bc-muted)' }}>Total Lenders</div>
          <div className="text-2xl font-bold">{lenders?.length || 0}</div>
          <div className="text-xs mt-1" style={{ color: 'var(--bc-muted)' }}>{activeLenders.length} active</div>
        </div>
        <div className="rounded-xl border p-5" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
          <div className="text-xs font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--bc-muted)' }}>Capital Deployed</div>
          <div className="text-2xl font-bold">${(totalCommitted / 1_000_000).toFixed(1)}M</div>
          <div className="text-xs mt-1" style={{ color: 'var(--bc-muted)' }}>in active projects</div>
        </div>
        <div className="rounded-xl border p-5" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
          <div className="text-xs font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--bc-muted)' }}>Platform Status</div>
          <div className="text-2xl font-bold" style={{ color: '#2ecc71' }}>Live</div>
          <div className="text-xs mt-1" style={{ color: 'var(--bc-muted)' }}>XRPL escrow enabled</div>
        </div>
      </div>

      {/* Lenders table */}
      <div className="rounded-xl border overflow-hidden" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
        <div className="px-5 py-4 border-b" style={{ borderColor: 'var(--bc-border)' }}>
          <h2 className="text-sm font-bold">All Lenders</h2>
        </div>

        {!lenders?.length ? (
          <div className="px-5 py-16 text-center">
            <div className="text-4xl mb-3">🏦</div>
            <div className="font-semibold mb-1">No lenders yet</div>
            <div className="text-sm" style={{ color: 'var(--bc-muted)' }}>Add your first lender to start creating projects.</div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b" style={{ borderColor: 'var(--bc-border)' }}>
                  {['Lender', 'Contact', 'Loan Types', 'Max LTV', 'Active Projects', 'Status'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--bc-muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lenders?.map(lender => {
                  const projects = lender.projects as { id: string; loan_amount: number; stage: string }[] | null
                  const activeProjects = projects?.filter(p => p.stage === 'active') || []
                  return (
                    <tr key={lender.id} className="border-b last:border-0 hover:bg-white/[0.02]" style={{ borderColor: 'rgba(42,63,87,0.4)' }}>
                      <td className="px-4 py-3">
                        <div className="font-semibold">{lender.company_name}</div>
                        <div className="text-xs mt-0.5" style={{ color: 'var(--bc-muted)' }}>{lender.email}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div>{lender.contact_name || '—'}</div>
                        <div className="text-xs mt-0.5" style={{ color: 'var(--bc-muted)' }}>{lender.phone || ''}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {lender.loan_types?.map((t: string) => (
                            <span key={t} className="text-xs px-2 py-0.5 rounded" style={{ background: 'rgba(45,125,210,0.15)', color: 'var(--bc-blue)' }}>{t}</span>
                          )) || <span className="text-xs" style={{ color: 'var(--bc-muted)' }}>—</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3">{lender.max_ltv ? `${lender.max_ltv}%` : '—'}</td>
                      <td className="px-4 py-3">
                        <span className="font-semibold">{activeProjects.length}</span>
                        <span className="text-xs ml-1" style={{ color: 'var(--bc-muted)' }}>projects</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`badge ${lender.active ? 'badge-green' : 'badge-gray'}`}>
                          {lender.active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
