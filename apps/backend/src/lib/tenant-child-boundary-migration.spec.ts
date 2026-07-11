import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('tenant-owned message and handover migration', () => {
  const migration = readFileSync(
    join(
      process.cwd(),
      'prisma/migrations/20260711170000_tenant_owned_messages_handovers/migration.sql',
    ),
    'utf8',
  );

  it('adds and backfills tenant ownership for both child tables', () => {
    expect(migration).toContain('ALTER TABLE public.messages');
    expect(migration).toContain('ALTER TABLE public.handover_events');
    expect(migration).toMatch(/UPDATE public\.messages[\s\S]+SET tenant_id = c\.tenant_id/);
    expect(migration).toMatch(/UPDATE public\.handover_events[\s\S]+SET tenant_id = c\.tenant_id/);
  });

  it('rejects a tenant id that disagrees with the parent conversation', () => {
    expect(migration).toContain('tenant ownership mismatch for conversation');
    expect(migration).toContain('messages_conversation_tenant_fkey');
    expect(migration).toContain('handover_events_conversation_tenant_fkey');
  });

  it('enables RLS only with authenticated membership policies present', () => {
    expect(migration).toContain('ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('ALTER TABLE public.handover_events ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('CREATE POLICY messages_member_select');
    expect(migration).toContain('CREATE POLICY handover_events_member_select');
    expect(migration).toContain('tu.profile_id = auth.uid()::text');
    expect(migration).toContain('au.profile_id = auth.uid()::text');
    expect(migration).toContain("au.role IN ('OWNER', 'ADMIN', 'OPERATOR')");
  });
});
