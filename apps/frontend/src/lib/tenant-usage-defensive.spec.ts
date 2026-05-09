import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), 'utf8');
}

describe('Tenant usage defensive defaults', () => {
  it('uses safe defaults and friendly error copy', () => {
    const s = read('src/app/app/tenant/[tenantId]/usage/page.tsx');
    expect(s).toContain('const ledgerItems = Array.isArray(ledger) ? ledger : []');
    expect(s).toContain('Usage data is temporarily unavailable. Please try again.');
    expect(s).toContain('No credits on file yet.');
    expect(s).toContain('No automated reply debits this month yet.');
  });
});

