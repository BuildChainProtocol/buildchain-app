/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Next.js 14 key (renamed to serverExternalPackages in v15)
    //
    // xrpl v5 / ripple-keypairs v3 / @xrplf/isomorphic ship CJS builds that
    // require() @noble/* and @scure/* packages, which went pure-ESM in v2.x.
    //
    // THE FIX: Node.js 22.12+ made require() of synchronous ES modules stable.
    // All @noble/* and @scure/* packages are synchronous (no top-level await),
    // so they load fine when Node.js 22 is the runtime.
    //
    // We keep xrpl and deps as EXTERNAL (not bundled) so webpack doesn't touch
    // them. Node.js 22 then loads them at runtime with require() of ESM working.
    serverComponentsExternalPackages: [
      'xrpl',
      'ripple-keypairs',
      'ripple-address-codec',
      'ripple-binary-codec',
      '@xrplf/isomorphic',
      '@noble/hashes',
      '@noble/curves',
      '@scure/base',
      '@scure/bip32',
      '@scure/bip39',
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
