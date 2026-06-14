import { createClient } from '@/lib/supabase/server'
import { formatCurrency } from '@/lib/utils'

export default async function AdminBorrowersPage() {
  const supabase = createClient()
  const { data: borrowers } = await supabase
    .from('borrowers')
    .select('*, profiles(full_name, email), projects(id, name, loan_amount, stage, amount_drawn)')
    .order('created_at', { ascending: false })

  const activeBorrowers = borrowers?.filter(b => b.active) || []

  const ratingColor: Record<string, string> = {
    A: '#2ecc71', B: 'var(--bc-blue)', C: 'var(--bc-gold)', D: '#e74c3c',
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Borrowers</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--bc-muted)' }}>
            {activeBorrowers.length} active borrowers on the platform
          </p>
        </div>
        <button
          className="px-4 py-2 rounded-lg text-sm font-bold"
          style={{ background: 'var(--bc-gold)', color: 'var(--bc-dark)' }}
        >
          + Add Borrower
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="rounded-xl border p-5" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
          <div className="text-xs font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--bc-muted)' }}>Total Borrowers</div>
          <div className="text-2xl font-bold">{borrowers?.length || 0}</div>
          <div className="text-xs mt-1" style={{ color: 'var(--bc-muted)' }}>{activeBorrowers.length} active</div>
        </div>
        <div className="rounded-xl border p-5" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
          <div className="text-xs font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--bc-muted)' }}>Active Projects</div>
          <div className="text-2xl font-bold">
            {borrowers?.reduce((sum, b) => {
              const projects = b.projects as { stage: string }[] | null
              return sum + (projects?.filter(p => p.stage === 'active').length || 0)
            }, 0) || 0}
          </div>
          <div className="text-xs mt-1" style={{ color: 'var(--bc-muted)' }}>across all borrowers</div>
        </div>
        <div className="rounded-xl border p-5" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
          <div className="text-xs font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--bc-muted)' }}>Total Exposure</div>
          <div className="text-2xl font-bold">
            {formatCurrency(borrowers?.reduce((sum, b) => {
              const projects = b.projects as { loan_amount: number; stage: string }[] | null
              return sum + (projects?.filter(p => p.stage === 'active').reduce((s, p) => s + p.loan_amount, 0) || 0)
            }, 0) || 0)}
          </div>
          <div className="text-xs mt-1" style={{ color: 'var(--bc-muted)' }}>in active loans</div>
        </div>
      </div>

      {/* Borrowers table */}
      <div className="rounded-xl border overflow-hidden" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
        <div className="px-5 py-4 border-b" style={{ borderColor: 'var(--bc-border)' }}>
          <h2 className="text-sm font-bold">All Borrowers</h2>
        </div>

        {!borrowers?.length ? (
          <div className="px-5 py-16 text-center">
            <div className="text-4xl mb-3">👥</div>
            <div className="font-semibold mb-1">No borrowers yet</div>
            <div className="text-sm" style={{ color: 'var(--bc-muted)' }}>Add your first borrower to start onboarding projects.</div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b" style={{ borderColor: 'var(--bc-border)' }}>
                  {['Borrower', 'Contact', 'License', 'Rating', 'Projects', 'Exposure', 'Status'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--bc-muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {borrowers?.map(borrower => {
                  const projects = borrower.projects as { id: string; name: string; loan_amount: number; stage: string; amount_drawn: number }[] | null
                  const activeProjects = projects?.filter(p => p.stage === 'active') || []
                  const totalExposure = activeProjects.reduce((s, p) => s + p.loan_amount, 0)
                  return (
                    <tr key={borrower.id} className="border-b last:border-0 hover:bg-white/[0.02]" style={{ borderColor: 'rgba(42,63,87,0.4)' }}>
                      <td className="px-4 py-3">
                        <div className="font-semibold">{borrower.company_name}</div>
                        <div className="text-xs mt-0.5" style={{ color: 'var(--bc-muted)' }}>{borrower.email}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div>{borrower.contact_name || '—'}</div>
                        <div className="text-xs mt-0.5" style={{ color: 'var(--bc-muted)' }}>{borrower.phone || ''}</div>
                      </td>
                      <td className="px-4 py-3">
                        {borrower.license_number
                          ? <><div className="text-xs font-mono">{borrower.license_number}</div><div className="text-xs" style={{ color: 'var(--bc-muted)' }}>{borrower.license_state}</div></>
                          : <span style={{ color: 'var(--bc-muted)' }}>—</span>
                        }
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-lg font-black" style={{ color: ratingColor[borrower.rating] || 'var(--bc-muted)' }}>
                          {borrower.rating || '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-semibold">{activeProjects.length}</span>
                        <span className="text-xs ml-1" style={{ color: 'var(--bc-muted)' }}>active / {projects?.length || 0} total</span>
                      </td>
                      <td className="px-4 py-3 font-semibold">{formatCurrency(totalExposure)}</td>
                      <td className="px-4 py-3">
                        <span className={`badge ${borrower.active ? 'badge-green' : 'badge-gray'}`}>
                          {borrower.active ? 'Active' : 'Inactive'}
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
