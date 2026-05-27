import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount)
}

export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`
}

export function getDrawProgress(drawn: number, total: number): number {
  if (total === 0) return 0
  return Math.round((drawn / total) * 100)
}

export function getStageLabel(stage: string): string {
  const labels: Record<string, string> = {
    application: 'Application',
    review: 'In Review',
    approved: 'Approved',
    active: 'Active Build',
    complete: 'Complete',
    cancelled: 'Cancelled',
  }
  return labels[stage] || stage
}

export function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    // Draw statuses
    draft: 'bg-gray-500/15 text-gray-400',
    submitted: 'bg-blue-500/15 text-blue-400',
    pending: 'bg-yellow-500/15 text-yellow-400',
    approved: 'bg-green-500/15 text-green-400',
    funded: 'bg-green-500/15 text-green-400',
    declined: 'bg-red-500/15 text-red-400',
    // Project stages
    application: 'bg-gray-500/15 text-gray-400',
    review: 'bg-yellow-500/15 text-yellow-400',
    active: 'bg-green-500/15 text-green-400',
    complete: 'bg-blue-500/15 text-blue-400',
    cancelled: 'bg-red-500/15 text-red-400',
    // Doc statuses
    required: 'bg-gray-500/15 text-gray-400',
    uploaded: 'bg-yellow-500/15 text-yellow-400',
    overdue: 'bg-red-500/15 text-red-400',
    rejected: 'bg-red-500/15 text-red-400',
    not_required: 'bg-gray-500/10 text-gray-500',
  }
  return colors[status] || 'bg-gray-500/15 text-gray-400'
}

export function timeAgo(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000)

  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
