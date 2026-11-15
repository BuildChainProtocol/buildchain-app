import { cn } from '@/lib/utils'

interface StatCardProps {
  label: string
  value: string | number
  sub?: string
  subColor?: 'green' | 'orange' | 'default'
  /** Kept for existing callers; the figure-first card no longer draws an icon. */
  icon?: string
  iconBg?: string
}

// A KPI tile: the figure in serif, the label in small caps under it, then the note.
export default function StatCard({ label, value, sub, subColor = 'default' }: StatCardProps) {
  const subColors = {
    green: 'text-green-700',
    orange: 'text-amber-700',
    default: 'text-[var(--bc-muted)]',
  }

  return (
    <div className="rounded-lg px-5 py-4 border" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
      <div className="bc-figure text-[28px] leading-tight tabular-nums truncate">{value}</div>
      <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--bc-muted)' }}>{label}</div>
      {sub && <div className={cn('text-[11px] mt-1.5', subColors[subColor])}>{sub}</div>}
    </div>
  )
}
