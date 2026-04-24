/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@aisbp/types'],
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