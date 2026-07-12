import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('restore conditional safety indexes migration', () => {
  const migration = readFileSync(
    join(
      process.cwd(),
      'prisma/migrations/20260712120000_restore_safety_indexes/migration.sql',
    ),
    'utf8',
  );

  const expectedIndexes = [
    'tenant_bot_profiles_one_active_per_tenant',
    'quota_ledgers_idempotency_key_unique',
    'user_invitations_pending_unique',
    'tenants_one_agency_workspace_per_agency',
    'workspace_credit_warning_events_sent_unique',
    'tenant_ghl_connections_connected_location_uidx',
    'workspace_credit_reset_reminder_events_sent_unique',
  ];

  it.each(expectedIndexes)('restores %s idempotently', indexName => {
    expect(migration).toContain(`CREATE UNIQUE INDEX IF NOT EXISTS ${indexName}`);
  });

  it('uses a short lock timeout', () => {
    expect(migration).toContain("SET lock_timeout = '5s'");
  });

  it('treats null billing period boundaries as equal without a timezone-dependent expression', () => {
    expect(migration.match(/NULLS NOT DISTINCT/g)).toHaveLength(2);
    expect(migration).not.toContain("'1970-01-01T00:00:00Z'::timestamptz");
  });
});
