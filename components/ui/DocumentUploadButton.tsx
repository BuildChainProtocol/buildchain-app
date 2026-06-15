'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface DocumentUploadButtonProps {
  projectId: string
  documentId?: string
  label?: string
}

export default function DocumentUploadButton({ projectId, documentId, label = 'Upload' }: DocumentUploadButtonProps) {
  const router = useRouter()
  const [state, setState] = useState<'idle' | 'uploading' | 'done' | 'error'>('idle')
  const [errMsg, setErrMsg] = useState('')

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setState('uploading')
    setErrMsg('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('project_id', projectId)
      if (documentId) fd.append('document_id', documentId)
      const res = await fetch('/api/documents', { method: 'POST', body: fd })
      if (!res.ok) {
        const j = await res.json()
        throw new Error(j.error || 'Upload failed')
      }
      setState('done')
      // Refresh server component data without full page reload
      setTimeout(() => {
        router.refresh()
        setState('idle')
      }, 1200)
    } catch (err: any) {
      setErrMsg(err.message || 'Upload failed')
      setState('error')
      setTimeout(() => setState('idle'), 3000)
    }
  }

  const labelText =
    state === 'uploading' ? '⏳ Uploading…' :
    state === 'done' ? '✓ Uploaded!' :
    state === 'error' ? `❌ ${errMsg}` :
    `📎 ${label}`

  const borderColor =
    state === 'done' ? '#2ecc71' :
    state === 'error' ? '#e74c3c' :
    'var(--bc-border)'

  const textColor =
    state === 'done' ? '#2ecc71' :
    state === 'error' ? '#e74c3c' :
    'var(--bc-muted)'

  return (
    <label
      className="cursor-pointer px-3 py-1 rounded-lg text-xs font-bold border transition-all"
      style={{
        borderColor,
        color: textColor,
        pointerEvents: state === 'uploading' ? 'none' : 'auto',
      }}>
      {labelText}
      <input
        type="file"
        className="hidden"
        accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls,.doc,.docx"
        onChange={handleFile}
        disabled={state === 'uploading'}
      />
    </label>
  )
}
