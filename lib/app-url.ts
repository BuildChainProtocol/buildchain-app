/**
 * The site's public address, for links that go out in emails.
 *
 * NEXT_PUBLIC_APP_URL is meant to hold it, but a value copied from a local
 * set-up ("http://localhost:3000") would send every emailed link to the
 * recipient's own machine. On the hosted site a localhost value is ignored
 * and the real address is used.
 */
const PRODUCTION = 'https://www.buildchain.finance'

export function appUrl(): string {
  const configured = (process.env.NEXT_PUBLIC_APP_URL ?? '').trim().replace(/\/+$/, '')
  const local = /localhost|127\.0\.0\.1|\[::1\]/i.test(configured)
  if (configured && !local) return configured
  // On Vercel (any environment) never hand out a localhost link.
  if (process.env.VERCEL) return PRODUCTION
  return configured || 'http://localhost:3000'
}
