import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('required tenant ownership migration', () => {
  const migration = readFileSync(
    join(
      process.cwd(),
      'prisma/migrations/20260712130000_require_tenant_ownership/migration.sql',
    ),
    'utf8',
  );
  const schema = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf8');

  it('validates all three existing tenant foreign keys', () => {
    expect(migration).toContain('VALIDATE CONSTRAINT messages_tenant_id_fkey');
    expect(migration).toContain('VALIDATE CONSTRAINT handover_events_tenant_id_fkey');
    expect(migration).toContain(
      'VALIDATE CONSTRAINT tenant_bot_profile_knowledge_vaults_tenant_id_fkey',
    );
  });

  it('validates non-null proofs before installing column NOT NULL', () => {
    expect(migration).toContain('CHECK (tenant_id IS NOT NULL) NOT VALID');
    expect(migration).toMatch(
      /VALIDATE CONSTRAINT messages_tenant_id_not_null[\s\S]+ALTER COLUMN tenant_id SET NOT NULL/,
    );
    expect(migration).toMatch(
      /VALIDATE CONSTRAINT handover_events_tenant_id_not_null[\s\S]+ALTER COLUMN tenant_id SET NOT NULL/,
    );
    expect(migration).toMatch(
      /VALIDATE CONSTRAINT profile_vault_links_tenant_id_not_null[\s\S]+ALTER COLUMN tenant_id SET NOT NULL/,
    );
  });

  it('keeps Prisma aligned with required database ownership', () => {
    const message = schema.match(/model Message \{[\s\S]*?\n\}/)?.[0] ?? '';
    const handover = schema.match(/model HandoverEvent \{[\s\S]*?\n\}/)?.[0] ?? '';
    const link = schema.match(/model TenantBotProfileKnowledgeVault \{[\s\S]*?\n\}/)?.[0] ?? '';

    for (const model of [message, handover, link]) {
      expect(model).toMatch(/tenantId\s+String\s+@map\("tenant_id"\)/);
      expect(model).not.toMatch(/tenantId\s+String\?/);
      expect(model).toMatch(/tenant\s+Tenant\s+@relation/);
    }
  });
});
