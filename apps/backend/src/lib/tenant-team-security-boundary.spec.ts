import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('tenant team security boundary', () => {
  const controller = readFileSync(
    join(process.cwd(), 'src/modules/tenant-users/tenant-users.controller.ts'), 'utf8',
  );
  const service = readFileSync(
    join(process.cwd(), 'src/modules/tenant-users/tenant-users.service.ts'), 'utf8',
  );
  const invitations = readFileSync(
    join(process.cwd(), 'src/modules/invitations/invitations.service.ts'), 'utf8',
  );
  const frontendApi = readFileSync(
    join(process.cwd(), '../frontend/src/lib/api.ts'), 'utf8',
  );
  const migration = readFileSync(
    join(process.cwd(), 'prisma/migrations/20260712190000_tenant_users_last_admin_guard/migration.sql'),
    'utf8',
  );

  it('has no direct-password customer provisioning surface', () => {
    expect(controller).not.toContain("@Post('provision-credentials')");
    expect(service).not.toContain('provisionWorkspaceMemberWithCredentials');
    expect(service).not.toContain('updateUserById');
    expect(service).not.toContain('auth.admin.createUser');
    expect(frontendApi).not.toContain('provisionWorkspaceMemberCredentials');
    expect(frontendApi).not.toContain('/tenant-users/provision-credentials');
  });

  it('keeps agency identities outside customer membership and recovery flows', () => {
    expect(service).toContain('Agency accounts already have workspace access');
    expect(invitations).toContain('Agency accounts already have access to this workspace');
    expect(invitations).toContain('Agency accounts cannot join a customer workspace');
    expect(invitations).toContain('Cannot reset an agency account from the workspace team');
  });

  it('does not expose another user recovery link to a tenant admin', () => {
    expect(invitations).toContain('actorIsWorkspaceAdmin && targetProfileId !== actorProfileId && send.actionLink');
    expect(invitations).toContain('Reset email delivery is unavailable');
  });

  it('serializes and rejects removal or demotion of the last tenant admin', () => {
    expect(migration).toMatch(/CREATE TRIGGER tenant_users_keep_last_admin/i);
    expect(migration).toMatch(/BEFORE DELETE OR UPDATE OF role, tenant_id/i);
    expect(migration).toMatch(/pg_advisory_xact_lock/i);
    expect(migration).toMatch(/remaining_admins < 1/i);
    expect(migration).toMatch(/ERRCODE = '23514'/i);
  });
});
