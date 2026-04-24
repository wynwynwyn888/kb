import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

/** Nest base URL in server runtime (no trailing slash). */
export function getNestBaseUrl(): string {
  return (
    process.env['BACKEND_URL'] || process.env['BACKEND_DEV_URL'] || 'http://127.0.0.1:3001'
  ).replace(/\/$/, '');
}

/**
 * `pathAfterV1` e.g. `tenants` or `tenants/abc-uuid` or `agency-ai-config` (no leading slash).
 */
export async function proxyToNest(
  req: NextRequest,
  pathAfterV1: string,
): Promise<NextResponse> {
  const u = new URL(req.url);
  const target = `${getNestBaseUrl()}/api/v1/${pathAfterV1.split('/').map(s => encodeURIComponent(s)).join('/')}${u.search}`;

  const method = req.method;
  const headers = new Headers();
  req.headers.forEach((value, key) => {
    const k = key.toLowerCase();
    if (k === 'host' || k === 'connection' || k === 'content-length' || k === 'keep-alive') return;
    headers.set(key, value);
  });

  const init: RequestInit = { method, headers, redirect: 'manual' as RequestRedirect };
  if (method !== 'GET' && method !== 'HEAD') {
    const buf = await req.arrayBuffer();
    if (buf.byteLength > 0) init.body = buf;
  }

  const res = await fetch(target, init);

  if (res.status === 404) {
    const text = await res.text();
    if (/Cannot (POST|GET|PUT|PATCH|DELETE) /i.test(text)) {
      return NextResponse.json(
        {
          message:
            'The API process does not have this route—usually a stale or wrong server build on the backend port. Rebuild and restart the API.',
          statusCode: 502,
          hint: 'In apps/backend: npx nest build, then node patch-dist.mjs, then start the process on the port in BACKEND_URL (default 127.0.0.1:3001).',
          upstream: target,
        },
        { status: 502 },
      );
    }
    return new NextResponse(text, { status: 404, statusText: res.statusText, headers: filterResHeaders(res.headers) });
  }

  return new NextResponse(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: filterResHeaders(res.headers),
  });
}

function filterResHeaders(res: Headers) {
  const resHeaders = new Headers();
  res.forEach((v, k) => {
    const l = k.toLowerCase();
    if (l === 'content-encoding' || l === 'transfer-encoding') return;
    resHeaders.set(k, v);
  });
  return resHeaders;
}

/** Resolve `params` for Next 14 (sync) and Next 15+ (Promise). */
export async function resolveRouteParams<T>(params: T | Promise<T>): Promise<T> {
  return await Promise.resolve(params);
}
