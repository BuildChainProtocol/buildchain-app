import Link from 'next/link'

// BUILD_ID — bump this any time you deploy so you can confirm which
// version is live: look for "v6" in the bottom-right corner of the page.
const BUILD_ID = 'v6'

export default function LoginPage({
  searchParams,
}: {
  searchParams: { error?: string }
}) {
  const errorMessage = searchParams.error
    ? decodeURIComponent(searchParams.error)
    : null

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: 'var(--bc-dark)' }}
    >
      <div className="w-full max-w-md px-6">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-3">
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center font-black text-base"
              style={{ background: 'var(--bc-gold)', color: 'var(--bc-dark)' }}
            >
              BC
            </div>
            <span className="text-2xl font-bold">
              Build<span style={{ color: 'var(--bc-gold)' }}>Chain</span> Protocol
            </span>
          </div>
          <p style={{ color: 'var(--bc-muted)' }} className="text-sm">
            Construction loan management platform
          </p>
        </div>

        <div
          className="rounded-xl p-8 border"
          style={{ background: 'var(--bc-navy)', borderColor: 'var(--bc-border)' }}
        >
          <h1 className="text-xl font-bold mb-6">Sign in to your account</h1>

          {errorMessage && (
            <div
              className="mb-4 p-3 rounded-lg text-sm border"
              style={{
                background: 'rgba(231,76,60,0.1)',
                borderColor: 'rgba(231,76,60,0.3)',
                color: '#e74c3c',
              }}
            >
              {errorMessage}
            </div>
          )}

          {/* Plain HTML form — no JavaScript needed.
              Posts to the Route Handler which returns a real 303 redirect.
              The browser commits Set-Cookie headers before following the
              redirect, so session cookies are always in the jar at /admin. */}
          <form method="POST" action="/api/auth/sign-in" className="space-y-4">
            <div>
              <label
                htmlFor="email"
                className="block text-xs font-semibold uppercase tracking-wide mb-1.5"
                style={{ color: 'var(--bc-muted)' }}
              >
                Email Address
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                className="w-full rounded-lg px-3 py-2.5 text-sm outline-none transition-colors"
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid var(--bc-border)',
                  color: '#e8edf2',
                }}
                placeholder="you@company.com"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-xs font-semibold uppercase tracking-wide mb-1.5"
                style={{ color: 'var(--bc-muted)' }}
              >
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                autoComplete="current-password"
                className="w-full rounded-lg px-3 py-2.5 text-sm outline-none"
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid var(--bc-border)',
                  color: '#e8edf2',
                }}
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              className="w-full py-2.5 rounded-lg font-bold text-sm transition-all mt-2"
              style={{ background: 'var(--bc-gold)', color: 'var(--bc-dark)' }}
            >
              Sign In
            </button>
          </form>

          <div
            className="mt-6 pt-6 border-t text-center text-sm"
            style={{ borderColor: 'var(--bc-border)', color: 'var(--bc-muted)' }}
          >
            Don&apos;t have an account?{' '}
            <Link
              href="/signup"
              style={{ color: 'var(--bc-gold)' }}
              className="font-semibold hover:underline"
            >
              Sign up
            </Link>
          </div>
        </div>

        <p className="text-center text-xs mt-6" style={{ color: 'var(--bc-muted)' }}>
          Secured by Supabase · BuildChain Protocol © 2026
        </p>
      </div>

      {/* Build stamp — confirm deployment went through */}
      <span
        style={{
          position: 'fixed',
          bottom: 8,
          right: 12,
          fontSize: 10,
          opacity: 0.3,
          color: 'var(--bc-muted)',
          fontFamily: 'monospace',
        }}
      >
        {BUILD_ID}
      </span>
    </div>
  )
}
