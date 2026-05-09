import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), 'utf8');
}

describe('Rules of Hooks — no hooks after auth/layout early returns', () => {
  it('AppShell calls useState and useMemo before loading/user early return', () => {
    const s = read('src/components/app/AppShell.tsx');
    const early = s.indexOf('if (loading || !user || !token)');
    const useStateIdx = s.indexOf('const [groupOpen, setGroupOpen]');
    const useMemoIdx = s.indexOf('const groupActiveByLabel = useMemo');
    expect(early).toBeGreaterThan(-1);
    expect(useStateIdx).toBeGreaterThan(-1);
    expect(useMemoIdx).toBeGreaterThan(-1);
    expect(useStateIdx).toBeLessThan(early);
    expect(useMemoIdx).toBeLessThan(early);
  });

  it('TenantWorkspaceGate calls useEffect before incomplete-URL early return', () => {
    const s = read('src/components/app/TenantWorkspaceGate.tsx');
    const early = s.indexOf('if (!loading && !safeTenantId)');
    const effectIdx = s.indexOf('useEffect(() => {');
    expect(early).toBeGreaterThan(-1);
    expect(effectIdx).toBeGreaterThan(-1);
    expect(effectIdx).toBeLessThan(early);
  });

  it('TenantUsagePage calls useEffect before top-level auth loading return', () => {
    const s = read('src/app/app/tenant/[tenantId]/usage/page.tsx');
    const outerLoadingUi = s.indexOf('Checking your workspace access');
    const effectIdx = s.indexOf('useEffect(() => {');
    expect(outerLoadingUi).toBeGreaterThan(-1);
    expect(effectIdx).toBeGreaterThan(-1);
    expect(effectIdx).toBeLessThan(outerLoadingUi);
  });
});
