import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { serviceClient } from '@/lib/supabase/service'

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('lenders')
    .select('*')
    .order('company_name')

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // Admins also see which account each record is linked to. Nobody else gets
  // this field. A person can read only their own profile, an admin included,
  // so once the caller is known to be an admin the lookup uses the service key.
  const { data: me } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if ((me as { role?: string } | null)?.role === 'admin') {
    const rows = (data ?? []) as { profile_id: string | null }[]
    const ids = rows.map(r => r.profile_id).filter((v): v is string => !!v)
    const emailById = new Map<string, string | null>()
    if (ids.length > 0) {
      const { data: accounts } = await serviceClient().from('profiles').select('id, email').in('id', ids)
      for (const a of (accounts ?? []) as { id: string; email: string | null }[]) emailById.set(a.id, a.email)
    }
    return NextResponse.json({
      data: rows.map(r => ({ ...r, account_email: r.profile_id ? emailById.get(r.profile_id) ?? null : null })),
    })
  }

  return NextResponse.json({ data })
}

export async function POST(request: NextRequest) {
  const supabase = createClient()
  const body = await request.json()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data, error } = await supabase
    .from('lenders')
    .insert({
      company_name: body.company_name,
      contact_name: body.contact_name || null,
      email: body.email || null,
      phone: body.phone || null,
      loan_types: body.loan_types || [],
      max_ltv: body.max_ltv ? parseFloat(body.max_ltv) : null,
      active: true,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ data }, { status: 201 })
}
