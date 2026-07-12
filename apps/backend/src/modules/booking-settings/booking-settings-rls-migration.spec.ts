import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('booking settings caller RPC migration', () => {
  const sql = readFileSync(
    join(process.cwd(), 'prisma/migrations/20260712220000_booking_settings_caller_rpc/migration.sql'),
    'utf8',
  );

  it('keeps the sensitive table closed and exposes a fixed tenant-authorized RPC', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.get_tenant_booking_settings/i);
    expect(sql).toMatch(/SECURITY DEFINER/i);
    expect(sql).toMatch(/public\.can_read_tenant\(p_tenant_id\)/i);
    expect(sql).not.toMatch(/CREATE POLICY\s+tenant_booking_settings/i);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.get_tenant_booking_settings\(TEXT\) FROM anon/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_tenant_booking_settings\(TEXT\) TO authenticated/i);
  });

  it('limits management and redacts staff notification fields for read-only roles', () => {
    expect(sql).toMatch(/tu\.role = 'ADMIN'/i);
    expect(sql).toMatch(/au\.role IN \('OWNER', 'ADMIN'\)/i);
    expect(sql).toMatch(/CASE WHEN access\.can_manage THEN bs\.internal_booking_alert_number ELSE NULL END/i);
    expect(sql).toMatch(/CASE WHEN access\.can_manage THEN bs\.internal_booking_alert_template ELSE NULL END/i);
    expect(sql).not.toMatch(/FOR\s+(INSERT|UPDATE|DELETE|ALL)/i);
  });
});
