import { cn } from '@/lib/utils'
import { getStatusColor } from '@/lib/utils'

interface BadgeProps {
  status: string
  label?: string
  className?: string
}

export default function Badge({ status, label, className }: BadgeProps) {
  return (
    <span className={cn('badge', getStatusColor(status), className)}>
      {label || status}
    </span>
  )
}
