import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('tenant roster RLS/RPC migration', () => {
  const sql = readFileSync(
    join(process.cwd(), 'prisma/migrations/20260712210000_tenant_roster_rls_rpc/migration.sql'),
    'utf8',
  );

  it('adds authenticated SELECT only for tenant_users', () => {
    expect(sql).toMatch(/CREATE POLICY tenant_users_member_select/i);
    expect(sql).toMatch(/FOR SELECT TO authenticated/i);
    expect(sql).toMatch(/can_read_tenant\(tenant_id\)/i);
    expect(sql).not.toMatch(/FOR\s+(INSERT|UPDATE|DELETE|ALL)/i);
  });

  it('exposes profile fields only through a tenant-authorized security-definer RPC', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.list_tenant_members/i);
    expect(sql).toMatch(/SECURITY DEFINER/i);
    expect(sql).toMatch(/public\.can_read_tenant\(p_tenant_id\)/i);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.list_tenant_members\(TEXT\) FROM anon/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.list_tenant_members\(TEXT\) TO authenticated/i);
    expect(sql).not.toMatch(/CREATE POLICY[\s\S]*ON public\.profiles/i);
  });
});
