/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  transpilePackages: [],
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
};

module.exports = nextConfig;
