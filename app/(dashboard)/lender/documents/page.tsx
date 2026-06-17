import { createClient } from '@/lib/supabase/server'
import { timeAgo } from '@/lib/utils'

const statusMeta: Record<string, { label: string; cls: string }> = {
  approved:   { label: 'Approved',  cls: 'badge-green'  },
  pending:    { label: 'Pending',   cls: 'badge-yellow' },
  rejected:   { label: 'Rejected',  cls: 'badge-red'    },
  uploaded:   { label: 'Uploaded',  cls: 'badge-blue'   },
}

const docIcon: Record<string, string> = {
  pdf: '📄', image: '🖼', spreadsheet: '📊', contract: '📋',
  inspection: '🔍', permit: '🏛', insurance: '🛡', other: '📎',
}

export default async function LenderDocumentsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: lender } = await supabase
    .from('lenders')
    .select('id, company_name')
    .eq('profile_id', user?.id)
    .single()

  // Get all projects for this lender, then fetch their documents
  const { data: projects } = await supabase
    .from('projects')
    .select('id, name, city, state')
    .eq('lender_id', lender?.id ?? '')

  const projectIds = projects?.map(p => p.id) || []
  const projectMap = Object.fromEntries((projects || []).map(p => [p.id, p]))

  const { data: documents } = projectIds.length
    ? await supabase
        .from('documents')
        .select('*, profiles(full_name)')
        .in('project_id', projectIds)
        .order('created_at', { ascending: false })
    : { data: [] }

  const total = documents?.length || 0
  const pending = documents?.filter(d => d.status === 'pending').length || 0
  const approved = documents?.filter(d => d.status === 'approved').length || 0
  const byProject: Record<string, typeof documents> = {}
  documents?.forEach(d => {
    if (!byProject[d.project_id]) byProject[d.project_id] = []
    byProject[d.project_id]!.push(d)
  })

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Documents</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--bc-muted)' }}>
          All documents across your loan portfolio
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Total Documents', value: total, sub: 'across all projects' },
          { label: 'Pending Review', value: pending, sub: 'need action', color: pending > 0 ? 'var(--bc-gold)' : undefined },
          { label: 'Approved', value: approved, sub: `${total ? Math.round(approved/total*100) : 0}% approval rate`, color: '#2ecc71' },
        ].map(s => (
          <div key={s.label} className="rounded-xl border p-5" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
            <div className="text-xs font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--bc-muted)' }}>{s.label}</div>
            <div className="text-2xl font-bold" style={{ color: s.color }}>{s.value}</div>
            <div className="text-xs mt-1" style={{ color: 'var(--bc-muted)' }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {!documents?.length ? (
        <div className="rounded-xl border px-5 py-20 text-center" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
          <div className="text-4xl mb-3">📁</div>
          <div className="font-semibold mb-1">No documents yet</div>
          <div className="text-sm" style={{ color: 'var(--bc-muted)' }}>
            Documents uploaded by borrowers across your loan portfolio will appear here.
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Pending attention section */}
          {pending > 0 && (
            <div className="rounded-xl border overflow-hidden" style={{ background: 'var(--bc-card)', borderColor: 'rgba(243,156,18,0.4)' }}>
              <div className="px-5 py-4 border-b flex items-center gap-2" style={{ borderColor: 'rgba(243,156,18,0.3)', background: 'rgba(243,156,18,0.06)' }}>
                <span>⏳</span>
                <h2 className="text-sm font-bold" style={{ color: 'var(--bc-gold)' }}>Needs Review ({pending})</h2>
              </div>
              <div className="divide-y" style={{ borderColor: 'var(--bc-border)' }}>
                {documents.filter(d => d.status === 'pending').map(doc => {
                  const proj = projectMap[doc.project_id]
                  const uploader = doc.profiles as { full_name: string } | null
                  return (
                    <div key={doc.id} className="px-5 py-3.5 flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-xl flex-shrink-0">{docIcon[doc.type || 'other'] || '📎'}</span>
                        <div className="min-w-0">
                          <div className="font-medium text-sm truncate">{doc.name || doc.file_name}</div>
                          <div className="text-xs mt-0.5" style={{ color: 'var(--bc-muted)' }}>
                            {proj?.name} · {uploader?.full_name || 'Unknown'} · {timeAgo(doc.created_at)}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="badge badge-yellow">Pending</span>
                        {doc.storage_path && (
                          <a href={`/api/documents/${doc.id}/view`} target="_blank" rel="noopener noreferrer"
                            className="px-3 py-1 rounded-lg text-xs font-bold border"
                            style={{ borderColor: 'var(--bc-border)', color: 'var(--bc-muted)' }}>
                            View
                          </a>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* All documents by project */}
          <div className="rounded-xl border overflow-hidden" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
            <div className="px-5 py-4 border-b" style={{ borderColor: 'var(--bc-border)' }}>
              <h2 className="text-sm font-bold">All Documents ({total})</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b" style={{ borderColor: 'var(--bc-border)' }}>
                    {['Document', 'Project', 'Type', 'Uploaded By', 'Date', 'Status', ''].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wide whitespace-nowrap"
                        style={{ color: 'var(--bc-muted)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {documents.map(doc => {
                    const proj = projectMap[doc.project_id]
                    const uploader = doc.profiles as { full_name: string } | null
                    const meta = statusMeta[doc.status] || { label: doc.status, cls: 'badge-gray' }
                    return (
                      <tr key={doc.id} className="border-b last:border-0 hover:bg-white/[0.02]"
                        style={{ borderColor: 'rgba(42,63,87,0.4)' }}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span>{docIcon[doc.type || 'other'] || '📎'}</span>
                            <div>
                              <div className="font-medium">{doc.name || doc.file_name}</div>
                              {doc.description && (
                                <div className="text-xs mt-0.5 truncate max-w-[200px]" style={{ color: 'var(--bc-muted)' }}>{doc.description}</div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div>{proj?.name || '—'}</div>
                          {proj && (
                            <div className="text-xs mt-0.5" style={{ color: 'var(--bc-muted)' }}>
                              {[proj.city, proj.state].filter(Boolean).join(', ')}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-xs capitalize px-2 py-0.5 rounded"
                            style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--bc-muted)' }}>
                            {doc.type || 'other'}
                          </span>
                        </td>
                        <td className="px-4 py-3">{uploader?.full_name || '—'}</td>
                        <td className="px-4 py-3 whitespace-nowrap" style={{ color: 'var(--bc-muted)' }}>
                          {timeAgo(doc.created_at)}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`badge ${meta.cls}`}>{meta.label}</span>
                        </td>
                        <td className="px-4 py-3">
                          {doc.storage_path && (
                            <a href={`/api/documents/${doc.id}/view`} target="_blank" rel="noopener noreferrer"
                              className="text-xs font-medium hover:underline"
                              style={{ color: 'var(--bc-blue)' }}>
                              View ↗
                            </a>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
