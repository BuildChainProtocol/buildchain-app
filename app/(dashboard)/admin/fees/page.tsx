import FeeStatement from '@/components/shared/FeeStatement'

export default function AdminFeesPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Protocol Fees</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--bc-muted)' }}>
          Every released draw, the fee it carries, and whether that fee is waived
        </p>
      </div>
      <FeeStatement showLender />
    </div>
  )
}
