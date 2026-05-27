interface ProgressBarProps {
  value: number // 0-100
  color?: 'gold' | 'blue' | 'green' | 'red'
  showLabel?: boolean
  height?: number
}

const colors = {
  gold: 'var(--bc-gold)',
  blue: 'var(--bc-blue)',
  green: '#2ecc71',
  red: '#e74c3c',
}

export default function ProgressBar({ value, color = 'gold', showLabel = false, height = 6 }: ProgressBarProps) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)', height }}>
        <div className="h-full rounded-full transition-all duration-300"
          style={{ width: `${Math.min(value, 100)}%`, background: colors[color] }} />
      </div>
      {showLabel && <span className="text-xs font-medium w-8 text-right" style={{ color: colors[color] }}>{value}%</span>}
    </div>
  )
}
