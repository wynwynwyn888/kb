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
    const securityHeaders = [
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
    ];
    if (process.env.NODE_ENV === 'production') {
      return [
        {
          source: '/:path*',
          headers: [
            ...securityHeaders,
            { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
          ],
        },
      ];
    }
    return [
      {
        source: '/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-store, must-revalidate' }, ...securityHeaders],
      },
    ];
  },
  /**
   * `/api/v1` is handled by `src/app/api/v1/[[...path]]/route.ts` (BFF proxy) so POST/GET
   * always reach Nest reliably. Do not add a same-path rewrite or it can shadow the route.
   */
  async rewrites() {
    const backend = process.env.BACKEND_DEV_URL || 'http://127.0.0.1:3001';
    const rewrites = [];
    const swaggerEnabled =
      process.env.NODE_ENV !== 'production' ||
      String(process.env.SWAGGER_ENABLED ?? '').trim().toLowerCase() === 'true';
    if (swaggerEnabled) {
      rewrites.push(
        { source: '/docs', destination: `${backend}/docs` },
        { source: '/docs/:path*', destination: `${backend}/docs/:path*` },
      );
    }
    return rewrites;
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