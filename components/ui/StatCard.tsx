import { cn } from '@/lib/utils'

interface StatCardProps {
  label: string
  value: string | number
  sub?: string
  subColor?: 'green' | 'orange' | 'default'
  icon?: string
  iconBg?: string
}

export default function StatCard({ label, value, sub, subColor = 'default', icon, iconBg }: StatCardProps) {
  const subColors = {
    green: 'text-green-400',
    orange: 'text-yellow-400',
    default: 'text-[var(--bc-muted)]',
  }

  return (
    <div className="rounded-xl p-5 border" style={{ background: 'var(--bc-card)', borderColor: 'var(--bc-border)' }}>
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--bc-muted)' }}>{label}</div>
          <div className="text-3xl font-extrabold text-white">{value}</div>
          {sub && <div className={cn('text-xs mt-1', subColors[subColor])}>{sub}</div>}
        </div>
        {icon && (
          <div className="w-10 h-10 rounded-lg flex items-center justify-center text-lg flex-shrink-0"
            style={{ background: iconBg || 'rgba(201,168,76,0.15)' }}>
            {icon}
          </div>
        )}
      </div>
    </div>
  )
}
