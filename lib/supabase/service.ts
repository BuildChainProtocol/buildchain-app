import { createClient } from '@supabase/supabase-js'

/**
 * The service-key client: bypasses row-level security. A route uses it only
 * AFTER it has checked, with the caller's own session, that the caller may do
 * what they asked. Draw state, signing material and funding requests are
 * written through it, because the database refuses those writes from any
 * signed-in user (see migrations 020, 021 and 023).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function serviceClient(): any {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}
