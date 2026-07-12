import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('tenant tagging settings first-cutover migration', () => {
  const sql = readFileSync(
    join(process.cwd(), 'prisma/migrations/20260712170000_tenant_tagging_settings_select_rls/migration.sql'),
    'utf8',
  );

  it('adds only an authenticated SELECT policy using the shared tenant helper', () => {
    expect(sql).toMatch(/CREATE POLICY tenant_tagging_settings_member_select/i);
    expect(sql).toMatch(/FOR SELECT TO authenticated/i);
    expect(sql).toMatch(/can_read_tenant\s*\(tenant_id\)/i);
    expect(sql).not.toMatch(/FOR\s+(INSERT|UPDATE|DELETE|ALL)/i);
    expect(sql).not.toMatch(/FORCE ROW LEVEL SECURITY/i);
  });
});
