import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), 'utf8');
}

describe('Tenant usage direct-load safety', () => {
  it('gates fetch on auth and tenant resolution', () => {
    const s = read('src/app/app/tenant/[tenantId]/usage/page.tsx');
    expect(s).toContain('resolveTenantIdFromParams');
    expect(s).toContain('authLoading');
    expect(s).toContain('Checking your workspace access');
    expect(s).toContain('if (!tenantParam)');
    expect(s).toContain('void (async () => {');
    expect(s).toMatch(/getTenantCreditsUsage\(token,\s*tenantParam\)/);
    expect(s).not.toContain('Unexpected end of JSON input');
    expect(s).not.toContain("Failed to execute 'json'");
  });

  it('WorkspaceSwitcher avoids calling toLowerCase on missing names', () => {
    const w = read('src/components/app/WorkspaceSwitcher.tsx');
    expect(w).toContain('(t?.name ??');
    expect(w).toContain("String(t?.id ?? '').toLowerCase()");
  });

  it('wraps app shell with ChunkLoadRecoveryBoundary', () => {
    const lay = read('src/app/app/layout.tsx');
    expect(lay).toContain('AppRouteChrome');

    const chrome = read('src/components/app/AppRouteChrome.tsx');
    expect(chrome).toContain('ChunkLoadRecoveryBoundary');
  });
});
