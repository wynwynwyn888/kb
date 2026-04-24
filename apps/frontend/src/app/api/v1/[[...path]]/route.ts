import type { NextRequest } from 'next/server';
import { proxyToNest, resolveRouteParams } from '@/lib/server/proxy-to-nest';

/**
 * Catch-all for `/api/v1/*` not covered by a more specific `route.ts` (e.g. `v1/tenants/route.ts`).
 * Forwards to Nest. `params` is Promise in Next 15+.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

type Ctx = { params: Promise<{ path?: string[] }> | { path?: string[] } };

async function getPath(ctx: Ctx): Promise<string[] | undefined> {
  const p = await resolveRouteParams(
    (ctx as { params: { path?: string[] } | Promise<{ path?: string[] }> }).params as
      | { path?: string[] }
      | Promise<{ path?: string[] }>,
  );
  return p.path;
}

function pathAfterV1(segments: string[] | undefined): string {
  return (segments ?? []).join('/');
}

export async function GET(req: NextRequest, ctx: Ctx) {
  return proxyToNest(req, pathAfterV1(await getPath(ctx)));
}
export async function POST(req: NextRequest, ctx: Ctx) {
  return proxyToNest(req, pathAfterV1(await getPath(ctx)));
}
export async function PUT(req: NextRequest, ctx: Ctx) {
  return proxyToNest(req, pathAfterV1(await getPath(ctx)));
}
export async function PATCH(req: NextRequest, ctx: Ctx) {
  return proxyToNest(req, pathAfterV1(await getPath(ctx)));
}
export async function DELETE(req: NextRequest, ctx: Ctx) {
  return proxyToNest(req, pathAfterV1(await getPath(ctx)));
}
export async function OPTIONS(req: NextRequest, ctx: Ctx) {
  return proxyToNest(req, pathAfterV1(await getPath(ctx)));
}
