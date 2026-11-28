import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import InvoiceView from '@/components/shared/InvoiceView'

export default function AdminInvoicePage({ params }: { params: { id: string } }) {
  return (
    <div>
      <Link href="/admin/fees" data-noprint className="inline-flex items-center gap-1.5 text-sm mb-4 underline" style={{ color: 'var(--bc-blue)' }}>
        <ArrowLeft size={14} /> Back to Protocol Fees
      </Link>
      <InvoiceView id={params.id} admin />
    </div>
  )
}
