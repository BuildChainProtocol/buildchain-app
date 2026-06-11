import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import DocumentUploadButton from '@/components/ui/DocumentUploadButton'

export default async function BorrowerDocumentsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: borrower } = await supabase.from('borrowers').select('id').eq('profile_id', user.id).single()
  if (!borrower) return <div className="p-8 text-center" style={{ color: 'var(--bc-muted)' }}>No borrower profile found.</div>

  const { data: projects } = await supabase.from('projects').select('id, name').eq('borrower_id', borrower.id)
  const projectIds = (projects || []).map(p => p.id)

  const { data: documents } = projectIds.length
    ? await supabase.from('documents').select('*').in('project_id', projectIds).order('created_at')
    : { data: [] }

  const statusIcon: Record<string, string> = {
    approved: '✅', uploaded: '⏳', required: '❌', overdue: '⚠️', rejected: '❌', not_required: '—'
  }
  const statusBadge: Record<string, string> = {
    approved: 'badge-green', uploaded: 'badge-yellow', required: 'badge-red',
    overdue: 'badge-red', rejected: 'badge-red', not_required: 'badge-gray',
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">My Documents</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--bc-muted)' }}>Document status for all your active projects</p>
      </div>

      {projects?.map(project => {
        const docs = documents?.filter(d => d.project_id === project.id) || []
        const missing = docs.filter(d => ['required', 'overdue'].includes(d.status)).length
        return (
          <div key={project.id} className="rounded-xl border mb-5 overflow-hidden" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
            <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--bc-border)' }}>
              <h2 className="font-bold">{project.name}</h2>
              {missing > 0 ? (
                <span className="badge badge-red">{missing} missing</span>
              ) : (
                <span className="badge badge-green">All clear</span>
              )}
            </div>
            <div className="divide-y" style={{ borderColor: 'rgba(42,63,87,0.4)' }}>
              {docs.map(doc => (
                <div key={doc.id} className="flex items-center justify-between px-5 py-3">
                  <div className="flex items-center gap-3">
                    <span>{statusIcon[doc.status] || '❓'}</span>
                    <div>
                      <div className="text-sm font-medium">{doc.name}</div>
                      {doc.uploaded_at && (
                        <div className="text-xs" style={{ color: 'var(--bc-muted)' }}>
                          Uploaded {new Date(doc.uploaded_at).toLocaleDateString()}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`badge ${statusBadge[doc.status] || 'badge-gray'}`}>{doc.status}</span>
                    {['required', 'overdue', 'rejected'].includes(doc.status) && (
                      <DocumentUploadButton projectId={project.id} documentId={doc.id} />
                    )}
                    {doc.storage_path && (
                      <button className="text-xs px-3 py-1 rounded-lg border transition-all hover:border-[var(--bc-gold)]"
                        style={{ borderColor: 'var(--bc-border)', color: 'var(--bc-muted)' }}>
                        📥 View
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {docs.length === 0 && (
                <div className="px-5 py-6 text-center text-sm" style={{ color: 'var(--bc-muted)' }}>No documents required yet</div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
