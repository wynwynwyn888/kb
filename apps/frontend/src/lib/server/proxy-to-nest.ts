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

  let res: Response;
  try {
    res = await fetch(target, init);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'fetch failed';
    const dev = process.env.NODE_ENV === 'development';
    return NextResponse.json(
      {
        message: dev
          ? 'Could not reach the application server from this web app. Start the API (and Redis if your team uses queues), then refresh.'
          : 'The application is temporarily unavailable. Please try again in a moment.',
        statusCode: 502,
        hint: dev
          ? 'Tip: from the project root, run the full dev command your team uses so the API is listening where the web app expects it.'
          : '',
        cause: message,
        upstream: dev ? target : undefined,
      },
      { status: 502 },
    );
  }

  if (res.status === 404) {
    const text = await res.text();
    if (/Cannot (POST|GET|PUT|PATCH|DELETE) /i.test(text)) {
      const dev = process.env.NODE_ENV === 'development';
      return NextResponse.json(
        {
          message: dev
            ? 'This screen called an API route that is not available on the running server. Restart or redeploy the API so it matches this app version.'
            : 'Something is out of date on the server. Please try again later or contact support.',
          statusCode: 502,
          hint: dev ? 'If you develop locally, rebuild and restart the API process, then hard-refresh the browser.' : '',
          upstream: dev ? target : undefined,
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
