import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

/**
 * POST /api/invite
 * Body: { email, role: 'lender' | 'borrower', name, company }
 *
 * Admin-only. Sends a Supabase magic-link invite email.
 * On first sign-in, migration 006 trigger auto-links profile_id.
 */
export async function POST(request: NextRequest) {
  const supabase = createClient()

  // Auth check — caller must be admin
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Only admins can invite users' }, { status: 403 })
  }

  const body = await request.json()
  const { email, role, name, company } = body as {
    email: string
    role: 'lender' | 'borrower' | 'admin'
    name?: string
    company?: string
  }

  if (!email || !role) {
    return NextResponse.json({ error: 'email and role are required' }, { status: 400 })
  }

  // Service role key required for admin invite
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY!

  if (!serviceKey) {
    return NextResponse.json(
      { error: 'SUPABASE_SERVICE_ROLE_KEY not configured — cannot send invites' },
      { status: 500 },
    )
  }

  const admin = createAdminClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    data: {
      role,
      full_name: name || '',
      company_name: company || '',
    },
    redirectTo: `${process.env.NEXT_PUBLIC_APP_URL || 'https://buildchain-app.vercel.app'}/login`,
  })

  if (error) {
    // Supabase returns "User already registered" when re-inviting — handle gracefully
    if (error.message?.includes('already registered') || error.message?.includes('already been registered')) {
      return NextResponse.json({ warning: 'User already has an account. Check if profile_id is already linked.' })
    }
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  // Log the invite
  await supabase.from('activity_log').insert({
    project_id: null,
    user_id: user.id,
    action: 'user_invited',
    entity_type: 'profile',
    entity_id: data.user?.id ?? null,
    details: { email, role, name, company },
  })

  return NextResponse.json({ success: true, userId: data.user?.id })
}
