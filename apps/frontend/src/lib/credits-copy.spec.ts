import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function read(rel: string): string {
  // Vitest runs with cwd at `apps/frontend`; accept either repo-root-relative or app-relative paths.
  try {
    return readFileSync(join(process.cwd(), rel), 'utf8');
  } catch {
    return readFileSync(join(process.cwd(), '..', '..', rel), 'utf8');
  }
}

describe('Credits copy (client-facing)', () => {
  it('Agency credits page uses Credits and not Quotas', () => {
    const s = read('src/app/app/agency/settings/quotas/page.tsx');
    expect(s).toContain('Credits');
    // Avoid provider/cost language in client-facing copy.
    expect(s).not.toContain('OpenAI');
    expect(s).not.toContain('token cost');
    expect(s).not.toContain('model cost');
  });

  it('Tenant usage page avoids Quota wording and provider details', () => {
    const s = read('src/app/app/tenant/[tenantId]/usage/page.tsx');
    expect(s).toContain('Credits');
    // Avoid provider/cost language in client-facing copy.
    expect(s).not.toContain('OpenAI');
    expect(s).not.toContain('provider');
    expect(s).not.toContain('model');
  });
});

