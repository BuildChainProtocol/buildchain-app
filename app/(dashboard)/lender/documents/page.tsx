import { createClient } from '@/lib/supabase/server'
import { timeAgo } from '@/lib/utils'

// documents.status as the database defines it (001_initial_schema.sql)
const statusMeta: Record<string, { label: string; cls: string }> = {
  required:     { label: 'Required',     cls: 'badge-yellow' },
  uploaded:     { label: 'Uploaded',     cls: 'badge-blue'   },
  approved:     { label: 'Approved',     cls: 'badge-green'  },
  rejected:     { label: 'Rejected',     cls: 'badge-red'    },
  overdue:      { label: 'Overdue',      cls: 'badge-red'    },
  not_required: { label: 'Not required', cls: 'badge-gray'   },
}

// documents.doc_type as the database defines it
const docTypeLabel: Record<string, string> = {
  loan_agreement: 'Loan agreement', title_commitment: 'Title commitment', plans_permits: 'Plans and permits',
  insurance: 'Insurance', environmental: 'Environmental', inspection_report: 'Inspection report',
  lien_waiver: 'Lien waiver', draw_request_form: 'Draw request form',
  contractor_agreement: 'Contractor agreement', appraisal: 'Appraisal', other: 'Other',
}

interface DocRow {
  id: string
  project_id: string
  name: string | null
  file_name: string | null
  doc_type: string | null
  status: string
  notes: string | null
  storage_path: string | null
  created_at: string
  uploader: { full_name: string | null } | null
}

export default async function LenderDocumentsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: lender } = await supabase
    .from('lenders')
    .select('id, company_name')
    .eq('profile_id', user?.id ?? '')
    .maybeSingle()
  const lenderId = (lender as { id: string } | null)?.id ?? null

  // Get all projects for this lender, then fetch their documents
  const { data: projectRows, error: projectsError } = lenderId
    ? await supabase
        .from('projects')
        .select('id, name, city, state')
        .eq('lender_id', lenderId)
    : { data: [], error: null }
  const projects = (projectRows || []) as { id: string; name: string; city: string | null; state: string | null }[]

  const projectIds = projects.map(p => p.id)
  const projectMap = Object.fromEntries(projects.map(p => [p.id, p]))

  // `documents` points at `profiles` twice (uploaded_by and reviewed_by), so
  // the embed has to say which one it means or the whole query is refused.
  const { data: documentRows, error: documentsError } = projectIds.length
    ? await supabase
        .from('documents')
        .select('*, uploader:profiles!uploaded_by(full_name)')
        .in('project_id', projectIds)
        .order('created_at', { ascending: false })
    : { data: [], error: null }
  const documents = (documentRows || []) as unknown as DocRow[]
  const loadError = projectsError?.message || documentsError?.message || ''

  const total = documents.length
  // Uploaded and not yet approved or rejected
  const pending = documents.filter(d => d.status === 'uploaded').length
  const approved = documents.filter(d => d.status === 'approved').length

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
          { label: 'Awaiting Review', value: pending, sub: 'uploaded, not yet reviewed', color: pending > 0 ? 'var(--bc-gold-ink)' : undefined },
          { label: 'Approved', value: approved, sub: total ? `${Math.round(approved/total*100)}% of all documents` : 'none yet', color: '#15803d' },
        ].map(s => (
          <div key={s.label} className="rounded-xl border p-5" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
            <div className="text-xs font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--bc-muted)' }}>{s.label}</div>
            <div className="text-2xl font-bold" style={{ color: s.color }}>{s.value}</div>
            <div className="text-xs mt-1" style={{ color: 'var(--bc-muted)' }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {loadError ? (
        <div className="rounded-xl border px-5 py-6 text-sm" style={{ background: 'rgba(231,76,60,0.06)', borderColor: 'rgba(231,76,60,0.3)', color: '#c0392b' }}>
          <div className="font-semibold mb-1">Your documents could not be loaded</div>
          <div>{loadError}</div>
          <div className="mt-2" style={{ color: 'var(--bc-muted)' }}>Reload the page to try again. Nothing has been changed.</div>
        </div>
      ) : !lenderId ? (
        <div className="rounded-xl border px-5 py-20 text-center" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
          <div className="font-semibold mb-1">No lender record</div>
          <div className="text-sm" style={{ color: 'var(--bc-muted)' }}>
            Your account is not linked to a lender record, so there are no loan documents to show.
          </div>
        </div>
      ) : !documents.length ? (
        <div className="rounded-xl border px-5 py-20 text-center" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
          <div className="font-semibold mb-1">No documents yet</div>
          <div className="text-sm" style={{ color: 'var(--bc-muted)' }}>
            Documents uploaded by borrowers across your loan portfolio will appear here.
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Pending attention section */}
          {pending > 0 && (
            <div className="rounded-xl border overflow-hidden" style={{ background: 'var(--bc-card)', borderColor: 'rgba(201,164,87,0.4)' }}>
              <div className="px-5 py-4 border-b flex items-center gap-2" style={{ borderColor: 'rgba(201,164,87,0.3)', background: 'rgba(201,164,87,0.06)' }}>
                <h2 className="text-sm font-bold" style={{ color: 'var(--bc-gold-ink)' }}>Awaiting Review ({pending})</h2>
              </div>
              <div className="divide-y" style={{ borderColor: 'var(--bc-border)' }}>
                {documents.filter(d => d.status === 'uploaded').map(doc => {
                  const proj = projectMap[doc.project_id]
                  return (
                    <div key={doc.id} className="px-5 py-3.5 flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="min-w-0">
                          <div className="font-medium text-sm truncate">{doc.name || doc.file_name}</div>
                          <div className="text-xs mt-0.5" style={{ color: 'var(--bc-muted)' }}>
                            {proj?.name} · {docTypeLabel[doc.doc_type || 'other'] || doc.doc_type} · {doc.uploader?.full_name || 'Unknown'} · {timeAgo(doc.created_at)}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="badge badge-blue">Uploaded</span>
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
                    const uploader = doc.uploader
                    const meta = statusMeta[doc.status] || { label: doc.status, cls: 'badge-gray' }
                    return (
                      <tr key={doc.id} className="border-b last:border-0 hover:bg-slate-900/[0.02]"
                        style={{ borderColor: '#edf0f4' }}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div>
                              <div className="font-medium">{doc.name || doc.file_name}</div>
                              {doc.notes && (
                                <div className="text-xs mt-0.5 truncate max-w-[200px]" style={{ color: 'var(--bc-muted)' }}>{doc.notes}</div>
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
                          <span className="text-xs px-2 py-0.5 rounded whitespace-nowrap"
                            style={{ background: 'rgba(13,27,42,0.06)', color: 'var(--bc-muted)' }}>
                            {docTypeLabel[doc.doc_type || 'other'] || doc.doc_type}
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
