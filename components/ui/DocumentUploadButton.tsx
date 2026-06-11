'use client'

interface DocumentUploadButtonProps {
  projectId: string
  documentId: string
}

export default function DocumentUploadButton({ projectId, documentId }: DocumentUploadButtonProps) {
  return (
    <label className="cursor-pointer px-3 py-1 rounded-lg text-xs font-bold border transition-all hover:border-[var(--bc-gold)]"
      style={{ borderColor: 'var(--bc-border)', color: 'var(--bc-muted)' }}>
      📎 Upload
      <input
        type="file"
        className="hidden"
        accept=".pdf,.jpg,.jpeg,.png"
        onChange={async (e) => {
          const file = e.target.files?.[0]
          if (!file) return
          const fd = new FormData()
          fd.append('file', file)
          fd.append('project_id', projectId)
          fd.append('document_id', documentId)
          await fetch('/api/documents', { method: 'POST', body: fd })
          window.location.reload()
        }}
      />
    </label>
  )
}
