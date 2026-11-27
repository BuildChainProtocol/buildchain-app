import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { feeRateBps } from '@/lib/fees'

// The protocol fee statement: one line per released draw. A record only.
// Row-level security shows an admin every line and a lender only their own.
//   GET ?month=YYYY-MM   (default: the current month, UTC)
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const now = new Date()
  const month = req.nextUrl.searchParams.get('month') ?? `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return NextResponse.json({ error: 'month must look like 2026-12' }, { status: 400 })
  const [y, m] = month.split('-').map(Number)
  const from = new Date(Date.UTC(y, m - 1, 1)).toISOString()
  const to = new Date(Date.UTC(y, m, 1)).toISOString()

  const { data, error } = await supabase.from('fee_accruals')
    .select('id, released_at, release_amount, rate_bps, fee_amount, waived, waiver_reason, settlement_method, network, projects ( name, loan_number ), lenders ( company_name ), draw_requests ( request_number )')
    .gte('released_at', from).lt('released_at', to).order('released_at')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lines: any[] = data ?? []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sum = (rows: any[], f: (r: any) => number) => Math.round(rows.reduce((t, r) => t + f(r), 0) * 100) / 100
  return NextResponse.json({
    month, rateBps: feeRateBps(), lines,
    totals: {
      released: sum(lines, r => Number(r.release_amount)),
      fees: sum(lines, r => Number(r.fee_amount)),
      waived: sum(lines.filter(r => r.waived), r => Number(r.fee_amount)),
      due: sum(lines.filter(r => !r.waived), r => Number(r.fee_amount)),
    },
  })
}
