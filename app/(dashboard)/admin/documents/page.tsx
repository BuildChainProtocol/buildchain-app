import { createClient } from '@/lib/supabase/server'
import { timeAgo } from '@/lib/utils'

export default async function AdminDocumentsPage() {
  const supabase = createClient()
  const { data: documents } = await supabase
    .from('documents')
    .select('*, projects(name, loan_number), profiles(full_name)')
    .order('created_at', { ascending: false })

  const byStatus = {
    required: documents?.filter(d => d.status === 'required') || [],
    uploaded: documents?.filter(d => d.status === 'uploaded') || [],
    approved: documents?.filter(d => d.status === 'approved') || [],
    rejected: documents?.filter(d => d.status === 'rejected') || [],
    overdue: documents?.filter(d => d.status === 'overdue') || [],
  }

  const statusBadge: Record<string, string> = {
    required: 'badge-yellow',
    uploaded: 'badge-blue',
    approved: 'badge-green',
    rejected: 'badge-red',
    overdue: 'badge-red',
    not_required: 'badge-gray',
  }
  const statusLabel: Record<string, string> = {
    required: 'Required',
    uploaded: 'Uploaded',
    approved: 'Approved',
    rejected: 'Rejected',
    overdue: 'Overdue',
    not_required: 'N/A',
  }

  function formatBytes(bytes: number | null) {
    if (!bytes) return '—'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Documents</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--bc-muted)' }}>
            {documents?.length || 0} total documents across all projects
          </p>
        </div>
      </div>

      {/* Status summary */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 mb-6">
        {[
          { label: 'Required', count: byStatus.required.length, color: 'rgba(243,156,18,0.15)', text: 'var(--bc-gold)' },
          { label: 'Uploaded', count: byStatus.uploaded.length, color: 'rgba(45,125,210,0.15)', text: 'var(--bc-blue)' },
          { label: 'Approved', count: byStatus.approved.length, color: 'rgba(46,204,113,0.15)', text: '#2ecc71' },
          { label: 'Rejected', count: byStatus.rejected.length, color: 'rgba(231,76,60,0.15)', text: '#e74c3c' },
          { label: 'Overdue', count: byStatus.overdue.length, color: 'rgba(231,76,60,0.15)', text: '#e74c3c' },
        ].map(s => (
          <div key={s.label} className="rounded-xl border p-4 text-center" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
            <div className="text-2xl font-bold" style={{ color: s.text }}>{s.count}</div>
            <div className="text-xs mt-1 font-semibold uppercase tracking-wide" style={{ color: 'var(--bc-muted)' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Attention needed — overdue + uploaded awaiting review */}
      {(byStatus.overdue.length > 0 || byStatus.uploaded.length > 0) && (
        <div className="rounded-xl border overflow-hidden mb-5" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
          <div className="px-5 py-4 border-b flex items-center gap-2" style={{ borderColor: 'var(--bc-border)' }}>
            <span>⚠</span>
            <h2 className="text-sm font-bold">Needs Attention</h2>
            <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(231,76,60,0.15)', color: '#e74c3c' }}>
              {byStatus.overdue.length + byStatus.uploaded.length}
            </span>
          </div>
          <div className="divide-y" style={{ borderColor: 'rgba(42,63,87,0.4)' }}>
            {[...byStatus.overdue, ...byStatus.uploaded].map(doc => {
              const project = doc.projects as { name: string; loan_number: string } | null
              const uploader = doc.profiles as { full_name: string } | null
              return (
                <div key={doc.id} className="px-5 py-3 flex items-center justify-between hover:bg-white/[0.02]">
                  <div className="flex items-center gap-3">
                    <span className="text-lg">📄</span>
                    <div>
                      <div className="text-sm font-semibold">{doc.name}</div>
                      <div className="text-xs mt-0.5" style={{ color: 'var(--bc-muted)' }}>
                        {project?.name} · {doc.doc_type || 'Document'}
                        {uploader?.full_name ? ` · Uploaded by ${uploader.full_name}` : ''}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`badge ${statusBadge[doc.status]}`}>{statusLabel[doc.status]}</span>
                    {doc.uploaded_at && <span className="text-xs" style={{ color: 'var(--bc-muted)' }}>{timeAgo(doc.uploaded_at)}</span>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* All documents */}
      <div className="rounded-xl border overflow-hidden" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
        <div className="px-5 py-4 border-b" style={{ borderColor: 'var(--bc-border)' }}>
          <h2 className="text-sm font-bold">All Documents</h2>
        </div>

        {!documents?.length ? (
          <div className="px-5 py-16 text-center">
            <div className="text-4xl mb-3">📁</div>
            <div className="font-semibold mb-1">No documents yet</div>
            <div className="text-sm" style={{ color: 'var(--bc-muted)' }}>Documents will appear here as borrowers upload them to their projects.</div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b" style={{ borderColor: 'var(--bc-border)' }}>
                  {['Document', 'Project', 'Type', 'Size', 'Uploaded', 'Status'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--bc-muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {documents?.map(doc => {
                  const project = doc.projects as { name: string; loan_number: string } | null
                  return (
                    <tr key={doc.id} className="border-b last:border-0 hover:bg-white/[0.02]" style={{ borderColor: 'rgba(42,63,87,0.4)' }}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span>📄</span>
                          <div>
                            <div className="font-semibold">{doc.name}</div>
                            {doc.file_name && <div className="text-xs mt-0.5 font-mono" style={{ color: 'var(--bc-muted)' }}>{doc.file_name}</div>}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div>{project?.name || '—'}</div>
                        <div className="text-xs mt-0.5" style={{ color: 'var(--bc-muted)' }}>{project?.loan_number}</div>
                      </td>
                      <td className="px-4 py-3 text-xs">{doc.doc_type || '—'}</td>
                      <td className="px-4 py-3 text-xs">{formatBytes(doc.file_size)}</td>
                      <td className="px-4 py-3 text-xs">{doc.uploaded_at ? timeAgo(doc.uploaded_at) : '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`badge ${statusBadge[doc.status] || 'badge-gray'}`}>
                          {statusLabel[doc.status] || doc.status}
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
