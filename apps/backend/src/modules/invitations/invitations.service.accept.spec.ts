// Invite acceptance: profile bootstrap, validation, and idempotency.

import { jest as jestGlobal } from '@jest/globals';
import { ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InvitationsService } from './invitations.service';
import type { AuthService } from '../auth/auth.service';

const authGetUser = jest.fn();

const supabaseMock = {
  auth: {
    getUser: (...a: unknown[]) => authGetUser(...a),
    admin: {},
  },
  from: jest.fn(),
};

jestGlobal.mock('../../lib/supabase', () => ({
  getSupabaseService: () => supabaseMock,
  getSupabaseServer: () => ({ auth: { resetPasswordForEmail: jest.fn() } }),
}));

function chainTerminal(final: { data: unknown; error: { message: string; code?: string } | null }) {
  const tail = {
    single: jest.fn().mockResolvedValue(final),
    maybeSingle: jest.fn().mockResolvedValue(final),
  };
  const c: Record<string, jest.Mock> = {
    select: jest.fn(),
    eq: jest.fn(),
    insert: jest.fn().mockResolvedValue({ data: null, error: null }),
    update: jest.fn(() => ({
      eq: jest.fn().mockResolvedValue({ error: null }),
    })),
    is: jest.fn(),
    gt: jest.fn(),
    limit: jest.fn(),
    order: jest.fn(),
  };
  c.select.mockImplementation(() => c);
  c.eq.mockImplementation(() => c);
  c.is.mockImplementation(() => c);
  c.gt.mockImplementation(() => c);
  c.limit.mockImplementation(() => c);
  c.order.mockImplementation(() => c);
  Object.assign(c, tail);
  return c;
}

describe('InvitationsService accept flows', () => {
  const actorId = 'auth-user-uuid-1';
  const inviteId = 'invite-uuid-1';
  const agencyId = 'agency-1';
  const token = 'jwt-token';

  let service: InvitationsService;

  beforeEach(() => {
    jestGlobal.clearAllMocks();
    authGetUser.mockReset();
    (supabaseMock.from as jest.Mock).mockReset();
    service = new InvitationsService({} as AuthService);
  });

  it('acceptAgencyInvite creates profile when missing then inserts membership', async () => {
    authGetUser.mockResolvedValue({
      data: {
        user: {
          id: actorId,
          email: 'invitee@example.com',
          user_metadata: { full_name: 'Invitee Person' },
        },
      },
      error: null,
    });

    const inviteRow = {
      id: inviteId,
      email_normalized: 'invitee@example.com',
      email_original: 'invitee@example.com',
      agency_id: agencyId,
      role: 'MEMBER',
      scope: 'AGENCY',
      status: 'PENDING',
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    };

    const profilesChain = chainTerminal({ data: null, error: null });
    profilesChain.insert.mockResolvedValue({ error: null });

    const agencyUsersMember = chainTerminal({ data: null, error: null });
    const agencyUsersInsert = { insert: jest.fn().mockResolvedValue({ error: null }) };

    const invitationsChain = chainTerminal({ data: inviteRow, error: null });
    invitationsChain.update.mockReturnValue({
      eq: jest.fn().mockResolvedValue({ error: null }),
    });

    (supabaseMock.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'user_invitations') return invitationsChain;
      if (table === 'profiles') return profilesChain;
      if (table === 'agency_users') {
        return {
          select: () => agencyUsersMember,
          insert: agencyUsersInsert.insert,
        };
      }
      return chainTerminal({ data: null, error: null });
    });

    const r = await service.acceptAgencyInvite(actorId, inviteId, token);
    expect(r).toEqual({ accepted: true });
    expect(profilesChain.insert).toHaveBeenCalled();
    expect(agencyUsersInsert.insert).toHaveBeenCalled();
  });

  it('acceptAgencyInvite skips profile insert when profile already exists', async () => {
    authGetUser.mockResolvedValue({
      data: { user: { id: actorId, email: 'invitee@example.com', user_metadata: {} } },
      error: null,
    });

    const inviteRow = {
      id: inviteId,
      email_normalized: 'invitee@example.com',
      email_original: 'invitee@example.com',
      agency_id: agencyId,
      role: 'MEMBER',
      scope: 'AGENCY',
      status: 'PENDING',
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    };

    const profilesChain = chainTerminal({ data: { id: actorId }, error: null });
    profilesChain.insert.mockResolvedValue({ error: null });

    const agencyUsersMember = chainTerminal({ data: null, error: null });
    const agencyUsersInsert = { insert: jest.fn().mockResolvedValue({ error: null }) };

    const invitationsChain = chainTerminal({ data: inviteRow, error: null });
    invitationsChain.update.mockReturnValue({
      eq: jest.fn().mockResolvedValue({ error: null }),
    });

    (supabaseMock.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'user_invitations') return invitationsChain;
      if (table === 'profiles') return profilesChain;
      if (table === 'agency_users') {
        return {
          select: () => agencyUsersMember,
          insert: agencyUsersInsert.insert,
        };
      }
      return chainTerminal({ data: null, error: null });
    });

    await service.acceptAgencyInvite(actorId, inviteId, token);
    expect(profilesChain.insert).not.toHaveBeenCalled();
    expect(agencyUsersInsert.insert).toHaveBeenCalled();
  });

  it('acceptAgencyInvite fails on email mismatch', async () => {
    authGetUser.mockResolvedValue({
      data: { user: { id: actorId, email: 'other@gmail.com', user_metadata: {} } },
      error: null,
    });

    const inviteRow = {
      id: inviteId,
      email_normalized: 'invitee@example.com',
      email_original: 'invitee@example.com',
      agency_id: agencyId,
      role: 'MEMBER',
      scope: 'AGENCY',
      status: 'PENDING',
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    };

    const invitationsChain = chainTerminal({ data: inviteRow, error: null });
    (supabaseMock.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'user_invitations') return invitationsChain;
      return chainTerminal({ data: null, error: null });
    });

    await expect(service.acceptAgencyInvite(actorId, inviteId, token)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('acceptAgencyInvite rejects revoked invite', async () => {
    authGetUser.mockResolvedValue({
      data: { user: { id: actorId, email: 'invitee@example.com', user_metadata: {} } },
      error: null,
    });

    const inviteRow = {
      id: inviteId,
      email_normalized: 'invitee@example.com',
      agency_id: agencyId,
      role: 'MEMBER',
      scope: 'AGENCY',
      status: 'REVOKED',
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    };

    const invitationsChain = chainTerminal({ data: inviteRow, error: null });
    (supabaseMock.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'user_invitations') return invitationsChain;
      return chainTerminal({ data: null, error: null });
    });

    await expect(service.acceptAgencyInvite(actorId, inviteId, token)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('acceptAgencyInvite rejects already-accepted invite', async () => {
    authGetUser.mockResolvedValue({
      data: { user: { id: actorId, email: 'invitee@example.com', user_metadata: {} } },
      error: null,
    });

    const inviteRow = {
      id: inviteId,
      email_normalized: 'invitee@example.com',
      agency_id: agencyId,
      role: 'MEMBER',
      scope: 'AGENCY',
      status: 'ACCEPTED',
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    };

    const invitationsChain = chainTerminal({ data: inviteRow, error: null });
    (supabaseMock.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'user_invitations') return invitationsChain;
      return chainTerminal({ data: null, error: null });
    });

    await expect(service.acceptAgencyInvite(actorId, inviteId, token)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('acceptAgencyInvite rejects when access token user id does not match JWT profile id', async () => {
    authGetUser.mockResolvedValue({
      data: { user: { id: 'other-user', email: 'invitee@example.com', user_metadata: {} } },
      error: null,
    });

    const inviteRow = {
      id: inviteId,
      email_normalized: 'invitee@example.com',
      agency_id: agencyId,
      role: 'MEMBER',
      scope: 'AGENCY',
      status: 'PENDING',
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    };

    const invitationsChain = chainTerminal({ data: inviteRow, error: null });
    (supabaseMock.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'user_invitations') return invitationsChain;
      return chainTerminal({ data: null, error: null });
    });

    await expect(service.acceptAgencyInvite(actorId, inviteId, token)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('acceptAgencyInvite maps profile insert duplicate to support message', async () => {
    authGetUser.mockResolvedValue({
      data: { user: { id: actorId, email: 'invitee@example.com', user_metadata: {} } },
      error: null,
    });

    const inviteRow = {
      id: inviteId,
      email_normalized: 'invitee@example.com',
      email_original: 'invitee@example.com',
      agency_id: agencyId,
      role: 'MEMBER',
      scope: 'AGENCY',
      status: 'PENDING',
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    };

    const profilesChain = chainTerminal({ data: null, error: null });
    profilesChain.insert.mockResolvedValue({ error: { message: 'duplicate key value violates unique constraint' } });

    const invitationsChain = chainTerminal({ data: inviteRow, error: null });

    const agencyUsersMember = chainTerminal({ data: null, error: null });

    (supabaseMock.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'user_invitations') return invitationsChain;
      if (table === 'profiles') return profilesChain;
      if (table === 'agency_users') {
        return {
          select: () => agencyUsersMember,
          insert: jest.fn(),
        };
      }
      return chainTerminal({ data: null, error: null });
    });

    await expect(service.acceptAgencyInvite(actorId, inviteId, token)).rejects.toThrow(
      /We could not attach this account to the invite/i,
    );
  });

  it('acceptWorkspaceInvite creates profile when missing', async () => {
    authGetUser.mockResolvedValue({
      data: { user: { id: actorId, email: 'ws@example.com', user_metadata: {} } },
      error: null,
    });

    const inviteRow = {
      id: inviteId,
      email_normalized: 'ws@example.com',
      email_original: 'ws@example.com',
      tenant_id: 'tenant-1',
      agency_id: agencyId,
      role: 'AGENT',
      scope: 'WORKSPACE',
      status: 'PENDING',
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    };

    const profilesChain = chainTerminal({ data: null, error: null });
    profilesChain.insert.mockResolvedValue({ error: null });

    const tenantUsersMember = chainTerminal({ data: null, error: null });
    const tenantUsersInsert = { insert: jest.fn().mockResolvedValue({ error: null }) };

    const invitationsChain = chainTerminal({ data: inviteRow, error: null });
    invitationsChain.update.mockReturnValue({
      eq: jest.fn().mockResolvedValue({ error: null }),
    });

    (supabaseMock.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'user_invitations') return invitationsChain;
      if (table === 'profiles') return profilesChain;
      if (table === 'tenant_users') {
        return {
          select: () => tenantUsersMember,
          insert: tenantUsersInsert.insert,
        };
      }
      return chainTerminal({ data: null, error: null });
    });

    const r = await service.acceptWorkspaceInvite(actorId, inviteId, token);
    expect(r).toEqual({ accepted: true });
    expect(profilesChain.insert).toHaveBeenCalled();
  });

  it('acceptAgencyInvite throws Unauthorized when getUser has no email', async () => {
    authGetUser.mockResolvedValue({
      data: { user: { id: actorId, email: null, user_metadata: {} } },
      error: null,
    });

    (supabaseMock.from as jest.Mock).mockImplementation(() => chainTerminal({ data: null, error: null }));

    await expect(service.acceptAgencyInvite(actorId, inviteId, token)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('acceptAgencyInvite maps membership FK failure to support message', async () => {
    authGetUser.mockResolvedValue({
      data: { user: { id: actorId, email: 'invitee@example.com', user_metadata: {} } },
      error: null,
    });

    const inviteRow = {
      id: inviteId,
      email_normalized: 'invitee@example.com',
      email_original: 'invitee@example.com',
      agency_id: agencyId,
      role: 'MEMBER',
      scope: 'AGENCY',
      status: 'PENDING',
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    };

    const profilesChain = chainTerminal({ data: { id: actorId }, error: null });
    const agencyUsersMember = chainTerminal({ data: null, error: null });
    const agencyUsersInsert = {
      insert: jest.fn().mockResolvedValue({
        error: { message: 'insert or update on table "agency_users" violates foreign key constraint' },
      }),
    };

    const invitationsChain = chainTerminal({ data: inviteRow, error: null });

    (supabaseMock.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'user_invitations') return invitationsChain;
      if (table === 'profiles') return profilesChain;
      if (table === 'agency_users') {
        return {
          select: () => agencyUsersMember,
          insert: agencyUsersInsert.insert,
        };
      }
      return chainTerminal({ data: null, error: null });
    });

    await expect(service.acceptAgencyInvite(actorId, inviteId, token)).rejects.toThrow(
      /We could not attach this account to the invite/i,
    );
  });
});
