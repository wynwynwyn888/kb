import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('single-agency RLS membership evaluation migration', () => {
  const migration = readFileSync(
    join(
      process.cwd(),
      'prisma/migrations/20260712150000_fix_rls_membership_evaluation/migration.sql',
    ),
    'utf8',
  );

  it('uses a fixed-path, stable, security-definer boolean helper', () => {
    expect(migration).toContain('FUNCTION public.can_read_tenant');
    expect(migration).toContain('RETURNS BOOLEAN');
    expect(migration).toContain('STABLE');
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain('SET search_path = pg_catalog, public');
  });

  it('supports assigned tenant users and privileged single-agency operators', () => {
    expect(migration).toContain('FROM public.tenant_users');
    expect(migration).toContain('tu.profile_id = auth.uid()::text');
    expect(migration).toContain('JOIN public.agency_users');
    expect(migration).toContain("au.role IN ('OWNER', 'ADMIN', 'OPERATOR')");
    expect(migration).not.toContain("'MEMBER'");
  });

  it('locks execution to authenticated and internal roles', () => {
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.can_read_tenant(TEXT) FROM PUBLIC');
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.can_read_tenant(TEXT) FROM anon');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.can_read_tenant(TEXT) TO authenticated');
  });

  it.each(['messages', 'handover_events', 'tenant_bot_profile_knowledge_vaults'])(
    'uses the helper for %s reads',
    table => {
      expect(migration).toContain(`ON public.${table}`);
      expect(migration).toContain('USING (public.can_read_tenant(tenant_id))');
    },
  );
});
