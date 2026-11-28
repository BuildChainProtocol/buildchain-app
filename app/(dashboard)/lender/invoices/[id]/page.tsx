import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import InvoiceView from '@/components/shared/InvoiceView'

export default function LenderInvoicePage({ params }: { params: { id: string } }) {
  return (
    <div>
      <Link href="/lender/funding" data-noprint className="inline-flex items-center gap-1.5 text-sm mb-4 underline" style={{ color: 'var(--bc-blue)' }}>
        <ArrowLeft size={14} /> Back to Funding
      </Link>
      <InvoiceView id={params.id} />
    </div>
  )
}
