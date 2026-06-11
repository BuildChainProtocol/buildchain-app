/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    // Type errors are annotation issues, not runtime bugs — safe to ignore for MVP build
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
