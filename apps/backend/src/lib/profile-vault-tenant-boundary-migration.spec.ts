import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Assistant Profile knowledge-vault tenant boundary', () => {
  const migration = readFileSync(
    join(
      process.cwd(),
      'prisma/migrations/20260711190000_tenant_own_profile_vault_links/migration.sql',
    ),
    'utf8',
  );

  it('backfills direct tenant ownership from the profile', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS tenant_id TEXT');
    expect(migration).toMatch(/UPDATE public\.tenant_bot_profile_knowledge_vaults[\s\S]+SET tenant_id = profile\.tenant_id/);
  });

  it('rejects cross-tenant profile and vault relationships', () => {
    expect(migration).toContain('profile and vault belong to different tenants');
    expect(migration).toContain('existing cross-tenant profile vault links require manual remediation');
    expect(migration).toContain('profile vault link tenant mismatch');
    expect(migration).toContain('CREATE TRIGGER profile_vault_links_enforce_tenant');
  });

  it('enables membership-scoped reads', () => {
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('CREATE POLICY profile_vault_links_member_select');
    expect(migration).toContain("au.role IN ('OWNER', 'ADMIN', 'OPERATOR')");
  });
});
