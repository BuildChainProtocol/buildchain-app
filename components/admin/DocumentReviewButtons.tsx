'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Approve / reject controls for one document, for the admin Documents page.
 * Calls PATCH /api/documents/[id] and shows the server's error if it refuses.
 */
export default function DocumentReviewButtons({ docId, status }: { docId: string; status: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')

  async function setStatus(next: 'approved' | 'rejected') {
    setBusy(next)
    setError('')
    try {
      const res = await fetch(`/api/documents/${docId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json?.error ?? `The document could not be updated (${res.status})`)
        return
      }
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The document could not be updated')
    } finally {
      setBusy(null)
    }
  }

  const canReview = status === 'uploaded' || status === 'pending_review'
  const canReapprove = status === 'rejected'
  if (!canReview && !canReapprove) return null

  return (
    <div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => setStatus('approved')}
          disabled={busy !== null}
          className="text-xs font-bold px-2 py-0.5 rounded transition-all whitespace-nowrap"
          style={{ background: 'rgba(39,174,96,0.15)', color: '#15803d' }}>
          {busy === 'approved' ? '…' : canReapprove ? 'Approve instead' : 'Approve'}
        </button>
        {canReview && (
          <button
            onClick={() => setStatus('rejected')}
            disabled={busy !== null}
            className="text-xs font-bold px-2 py-0.5 rounded transition-all"
            style={{ background: 'rgba(231,76,60,0.1)', color: '#c0392b' }}>
            {busy === 'rejected' ? '…' : 'Reject'}
          </button>
        )}
      </div>
      {error && <div className="text-xs mt-1" style={{ color: '#c0392b' }}>{error}</div>}
    </div>
  )
}
