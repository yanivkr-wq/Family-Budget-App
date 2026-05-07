import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone', // for Docker
  reactStrictMode: true,
  poweredByHeader: false,
  // Dev-only: permit common local hostnames so server actions don't 403-silent
  // when the page is served from one origin and posts back from another (e.g.,
  // when the LAN IP is used instead of localhost, or behind a local proxy).
  // This is ignored in production builds.
  allowedDevOrigins: [
    'localhost',
    '127.0.0.1',
    '192.168.68.102',
    '0.0.0.0',
  ],
  experimental: {
    serverActions: {
      bodySizeLimit: '5mb', // CSV imports
      allowedOrigins: [
        'localhost:3010',
        '127.0.0.1:3010',
        '192.168.68.102:3010',
      ],
    },
    // Tree-shake big libs — keeps the JS payload small per route.
    // recharts is dynamic-imported but still benefits when its bundle compiles.
    optimizePackageImports: [
      'lucide-react',
      'recharts',
      '@radix-ui/react-dialog',
      '@radix-ui/react-dropdown-menu',
      '@radix-ui/react-select',
      '@radix-ui/react-toast',
      '@radix-ui/react-popover',
    ],
    // Client router cache: how long an already-rendered page stays fresh
    // when the user navigates back to it. Default in Next 15 is 0s (every
    // back-nav refetches). 30s makes tab-switching feel INSTANT — clicking
    // /transactions → /recurring → /transactions reuses the cached HTML
    // for the second /transactions hit instead of waiting on the server.
    // After 30s, Next refetches naturally; mutations call revalidatePath()
    // so the cache is busted on writes regardless of TTL.
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
    // Dev only: cache server-component fetches across HMR reloads so
    // editing a client component doesn't re-run every server-side query.
    serverComponentsHmrCache: true,
  },
  serverExternalPackages: ['postgres', '@node-rs/argon2'],
  transpilePackages: ['@fba/db', '@fba/shared'],
};

export default nextConfig;
