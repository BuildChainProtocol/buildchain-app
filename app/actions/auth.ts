'use server'

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

type LoginResult = {
  error: string | null
  redirect: string | null
}

export async function loginAction(formData: FormData): Promise<LoginResult> {
  const email = formData.get('email') as string
  const password = formData.get('password') as string

  const cookieStore = cookies()

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Handled by middleware on subsequent requests
          }
        },
      },
    }
  )

  const { data, error } = await supabase.auth.signInWithPassword({ email, password })

  if (error || !data.user) {
    return {
      error: error?.message || 'Invalid email or password.',
      redirect: null,
    }
  }

  // Get role for dashboard redirect
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', data.user.id)
    .single()

  const role = (profile as { role: string } | null)?.role || 'borrower'

  // Return redirect URL — client will use window.location.href for a hard
  // navigation so the browser commits session cookies before the next request
  return { error: null, redirect: `/${role}` }
}
