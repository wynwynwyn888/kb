import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function prismaModels(schema: string): string[] {
  return [...schema.matchAll(/^model\s+(\w+)\s+\{/gm)].map(match => match[1]!).sort();
}

function cataloguedModels(catalogue: string): string[] {
  return [
    ...catalogue.matchAll(
      /^\| `([A-Z]\w*)` \| `[a-z0-9_]+` \| (?:platform|agency|tenant|user|inherited)(?: root)?:/gm,
    ),
  ]
    .map(match => match[1]!)
    .sort();
}

describe('tenant data catalogue', () => {
  const backendRoot = process.cwd();
  const schema = readFileSync(join(backendRoot, 'prisma/schema.prisma'), 'utf8');
  const catalogue = readFileSync(
    join(backendRoot, '../../docs/security/tenant-data-catalogue.md'),
    'utf8',
  );

  it('classifies every Prisma application model exactly once', () => {
    const models = prismaModels(schema);
    const entries = cataloguedModels(catalogue);

    expect(models).toHaveLength(39);
    expect(new Set(entries).size).toBe(entries.length);
    expect(entries).toEqual(models);
  });

  it('distinguishes the infrastructure migration ledger from application models', () => {
    expect(schema).not.toMatch(/^model\s+PrismaMigrations\s+\{/m);
    expect(catalogue).toContain('| `_prisma_migrations` | platform infrastructure |');
    expect(catalogue).toContain('40 public tables');
    expect(catalogue).toContain('39 application models');
  });

  it('records an ownership class and service-role surface for every model', () => {
    const rows = catalogue
      .split('\n')
      .filter(line =>
        /^\| `([A-Z]\w*)` \| `[a-z0-9_]+` \| (?:platform|agency|tenant|user|inherited)(?: root)?:/.test(
          line,
        ),
      );

    expect(rows).toHaveLength(39);
    for (const row of rows) {
      expect(row).toMatch(/\| (platform|agency|tenant|user|inherited)(?: root)?:/);
      const cells = row.split('|').map(cell => cell.trim());
      expect(cells).toHaveLength(10);
      expect(cells[7]).not.toBe('');
      expect(cells[8]).not.toBe('');
    }
  });

  it('matches the policy names created by the latest RLS migration', () => {
    const migration = readFileSync(
      join(
        backendRoot,
        'prisma/migrations/20260712150000_fix_rls_membership_evaluation/migration.sql',
      ),
      'utf8',
    );
    const migrationPolicies = [...migration.matchAll(/CREATE POLICY\s+(\w+)/g)]
      .map(match => match[1]!)
      .sort();
    const policySection = catalogue
      .split('## Current RLS policy inventory')[1]!
      .split('## Deployed single-agency read contract')[0]!;
    const documentedPolicies = [...policySection.matchAll(/^\| `(\w+)` \|/gm)]
      .map(match => match[1]!)
      .sort();

    expect(documentedPolicies).toEqual(migrationPolicies);
    expect(catalogue).toContain('`public.can_read_tenant(tenant_id)`');
  });

  it('keeps the deployed role contract explicit', () => {
    expect(catalogue).toContain('Agency OWNER, ADMIN, and OPERATOR');
    expect(catalogue).toContain('Agency MEMBER alone grants no tenant access');
    expect(catalogue).toContain('Revoked, unrelated, and anonymous users');
  });
});
