'use client'

import { useEffect } from 'react'

/**
 * An invitation or password-reset email comes back from the sign-in service
 * with its one-time tokens in the address's #fragment, which the server never
 * sees. Depending on the service's settings it may land on the home page or
 * the sign-in page rather than on /auth/accept. Wherever it lands, send it to
 * /auth/accept with the fragment intact.
 */
export default function AuthHashForward() {
  useEffect(() => {
    const hash = window.location.hash
    if (!hash || window.location.pathname === '/auth/accept') return
    if (/[#&](access_token|error_code|error_description)=/.test(hash)) {
      window.location.replace('/auth/accept' + hash)
    }
  }, [])
  return null
}
