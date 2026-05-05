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
    optimizePackageImports: [
      'lucide-react',
      '@radix-ui/react-dialog',
      '@radix-ui/react-dropdown-menu',
      '@radix-ui/react-select',
      '@radix-ui/react-toast',
      '@radix-ui/react-popover',
    ],
  },
  serverExternalPackages: ['postgres', '@node-rs/argon2'],
  transpilePackages: ['@fba/db', '@fba/shared'],
};

export default nextConfig;
