/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Next.js 14 key (renamed to serverExternalPackages in v15)
    //
    // WHY THIS LIST IS SHORT:
    // xrpl v5 / ripple-keypairs v3 ship CJS builds that try to require() the
    // @noble/* and @scure/* crypto packages, which went pure-ESM in v2.x.
    // That causes ERR_REQUIRE_ESM at runtime.
    //
    // THE FIX: let webpack bundle everything (xrpl, ripple-keypairs, all crypto
    // packages). Webpack handles ESM↔CJS interop perfectly at bundle time —
    // the final output is a single CJS bundle with no bare require() of ESM files.
    //
    // We only mark ws/bufferutil as external because they use native .node addons
    // that webpack cannot (and should not) bundle.
    serverComponentsExternalPackages: [
      'ws',
      'bufferutil',
      'utf-8-validate',
    ],
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
      },
    ],
  },
}

module.exports = nextConfig
