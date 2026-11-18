import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@muse/core', '@muse/tokens'],
  poweredByHeader: false,
  output: 'standalone',
  distDir: process.env.NEXT_DIST_DIR || '.next',
  async headers() {
    return [{
      source: '/(.*)',
      headers: [
        { key: 'x-content-type-options', value: 'nosniff' },
        { key: 'referrer-policy', value: 'strict-origin-when-cross-origin' },
        { key: 'permissions-policy', value: 'camera=(), geolocation=(), microphone=(self)' },
      ],
    }];
  },
};
export default config;
