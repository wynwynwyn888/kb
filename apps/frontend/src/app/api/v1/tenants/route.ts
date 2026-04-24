import type { NextRequest } from 'next/server';
import { proxyToNest } from '@/lib/server/proxy-to-nest';

/**
 * Explicit route for `POST|GET|PATCH /api/v1/tenants` so it always wins over catch-alls
 * in all Next.js versions and methods (avoids "Cannot POST /api/v1/tenants" from 405/404).
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export function GET(req: NextRequest) {
  return proxyToNest(req, 'tenants');
}

export function POST(req: NextRequest) {
  return proxyToNest(req, 'tenants');
}

export function PUT(req: NextRequest) {
  return proxyToNest(req, 'tenants');
}

export function PATCH(req: NextRequest) {
  return proxyToNest(req, 'tenants');
}

export function DELETE(req: NextRequest) {
  return proxyToNest(req, 'tenants');
}

export function OPTIONS(req: NextRequest) {
  return proxyToNest(req, 'tenants');
}
