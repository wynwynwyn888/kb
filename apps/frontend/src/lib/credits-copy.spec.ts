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
  it('Agency credits page uses premium annual allowance language', () => {
    const s = read('src/app/app/agency/settings/quotas/page.tsx');
    expect(s).toContain('Agency credit settings');
    expect(s).toContain('Default credits for new workspace');
    expect(s).toContain('Annual credits remaining');
    expect(s).toContain('Low-credit workspaces');
    expect(s).toContain('Paused workspaces');
    expect(s).toContain('One assistant reply uses one credit');
    expect(s).not.toContain('Delta / range');
    expect(s).not.toContain('Negative allowed');
    expect(s).not.toContain('subaccount.topup');
    expect(s).not.toContain('Wallet policy');
    // Avoid provider/cost language in client-facing copy.
    expect(s).not.toContain('OpenAI');
    expect(s).not.toContain('token cost');
    expect(s).not.toContain('model cost');
  });

  it('Tenant usage avoids developer debit codes in visible ledger labels', () => {
    const s = read('src/app/app/tenant/[tenantId]/usage/page.tsx');
    expect(s).toContain('Annual credits remaining');
    expect(s).toContain('Credits used this year');
    expect(s).toContain('annual allowance');
    expect(s).not.toContain('reply_debit');
    expect(s).not.toContain('reply debits');
    expect(s).toContain('ledgerMovementCustomerLabel');
    // Avoid provider/cost language in client-facing copy.
    expect(s).not.toContain('OpenAI');
  });
});
