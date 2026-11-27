import { timingSafeEqual } from 'crypto'

/**
 * Compare a presented API key with the configured one in constant time.
 * False when either is missing, so an unset key never opens a route.
 */
export function sameKey(presented: string | null | undefined, expected: string | null | undefined): boolean {
  if (!presented || !expected) return false
  const a = Buffer.from(presented)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** The key from an "Authorization: Bearer <key>" header. */
export function bearer(header: string | null | undefined): string {
  return (header ?? '').replace(/^Bearer\s+/i, '').trim()
}
