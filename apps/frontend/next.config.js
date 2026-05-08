const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  /** Trace + minimal server bundle for Docker; static chunks still live under `.next/static` (copied in Dockerfile). */
  output: 'standalone',
  /** Monorepo root so `next build` standalone tracing includes workspace packages when cwd is `apps/frontend`. */
  transpilePackages: ['@aisbp/types', '@aisbp/formatter'],
  /**
   * In dev, avoid the browser reusing a **cached HTML document** that still references old
   * `/_next/static/chunks/*` hashes after `next dev` restarts — that shows up as 404 on
   * `main-app.js`, `layout.js`, `page.js`, and the login form never hydrates (looks like “can’t log in”).
   */
  async headers() {
    if (process.env.NODE_ENV === 'production') {
      return [];
    }
    return [
      {
        source: '/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-store, must-revalidate' }],
      },
    ];
  },
  /**
   * `/api/v1` is handled by `src/app/api/v1/[[...path]]/route.ts` (BFF proxy) so POST/GET
   * always reach Nest reliably. Do not add a same-path rewrite or it can shadow the route.
   */
  async rewrites() {
    const backend = process.env.BACKEND_DEV_URL || 'http://127.0.0.1:3001';
    return [
      { source: '/docs', destination: `${backend}/docs` },
      { source: '/docs/:path*', destination: `${backend}/docs/:path*` },
    ];
  },
  async redirects() {
    return [
      { source: '/dashboard', destination: '/app', permanent: false },
      { source: '/dashboard/agency', destination: '/app/agency', permanent: false },
      { source: '/dashboard/tenant', destination: '/app', permanent: false },
      { source: '/tenants', destination: '/app', permanent: false },
      {
        source: '/tenants/:id/settings',
        destination: '/app/agency/settings/ghl?subaccount=:id',
        permanent: false,
      },
      {
        source: '/tenants/:id/conversations',
        destination: '/app/tenant/:id/conversations',
        permanent: false,
      },
      {
        source: '/tenants/:id/provider',
        destination: '/app/agency/settings/ai',
        permanent: false,
      },
    ];
  },
};

module.exports = nextConfig;