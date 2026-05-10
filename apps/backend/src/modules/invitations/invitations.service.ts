// Invitations — Supabase Auth admin generateLink (invite / recovery). Service role stays server-side only.

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { getSupabaseService } from '../../lib/supabase';
import type { AgencyRole, TenantRole } from '../../lib/enums';
import { AuthService } from '../auth/auth.service';

const INVITE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function inviteAppBaseUrl(): string {
  const u = (process.env['INVITE_APP_BASE_URL'] ?? process.env['NEXT_PUBLIC_APP_URL'] ?? 'http://localhost:3000').trim();
  return u.replace(/\/+$/, '');
}

@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);
  private readonly supabase = getSupabaseService();

  constructor(private readonly auth: AuthService) {}

  async listAgencyInvites(actorProfileId: string, agencyId: string) {
    await this.assertAgencyAdminOrOwner(actorProfileId, agencyId);
    const { data, error } = await this.supabase
      .from('user_invitations')
      .select('id, email_original, role, status, expires_at, created_at, accepted_at')
      .eq('agency_id', agencyId)
      .eq('scope', 'AGENCY')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async createAgencyInvite(
    actorProfileId: string,
    agencyId: string,
    emailRaw: string,
    roleUi: 'ADMIN' | 'USER',
  ): Promise<{ invitationId: string; actionLink: string; emailSent: false }> {
    await this.assertAgencyAdminOrOwner(actorProfileId, agencyId);
    const email = emailRaw.trim();
    if (!email || !email.includes('@')) throw new BadRequestException('Valid email is required');
    const emailNormalized = normalizeEmail(email);

    const agencyRole: AgencyRole = roleUi === 'ADMIN' ? 'ADMIN' : 'MEMBER';

    const existingMember = await this.findAgencyMembershipByEmail(agencyId, emailNormalized);
    if (existingMember) {
      throw new ConflictException('This user already has access.');
    }

    const inviteRow = await this.upsertPendingInvite({
      scope: 'AGENCY',
      agencyId,
      tenantId: null,
      emailNormalized,
      emailOriginal: email,
      role: agencyRole,
      invitedByProfileId: actorProfileId,
    });

    const redirectTo = `${inviteAppBaseUrl()}/auth/invite?invite_id=${encodeURIComponent(inviteRow.id)}&scope=agency`;
    const actionLink = await this.generateInviteLink(email, redirectTo, { invite_id: inviteRow.id, scope: 'agency' });

    return { invitationId: inviteRow.id, actionLink, emailSent: false };
  }

  async acceptAgencyInvite(actorProfileId: string, inviteId: string, accessToken: string) {
    const email = await this.emailForAuthUser(accessToken, actorProfileId);
    const inv = (await this.loadPendingInvite(inviteId, 'AGENCY')) as {
      email_normalized: string;
      agency_id: string;
      role: string;
    };
    if (inv.email_normalized !== normalizeEmail(email)) {
      throw new ForbiddenException('Signed-in email does not match this invite');
    }

    const agencyId = inv.agency_id;
    const existing = await this.findAgencyMembershipByProfile(agencyId, actorProfileId);
    if (existing) {
      await this.markInviteAccepted(inviteId, actorProfileId);
      return { alreadyMember: true as const };
    }

    const role = inv.role as AgencyRole;
    const now = new Date().toISOString();
    const { error: insErr } = await this.supabase.from('agency_users').insert({
      id: randomUUID(),
      agency_id: agencyId,
      profile_id: actorProfileId,
      role,
      created_at: now,
      updated_at: now,
    });
    if (insErr) {
      if (/duplicate|23505/i.test(insErr.message)) {
        await this.markInviteAccepted(inviteId, actorProfileId);
        return { alreadyMember: true as const };
      }
      throw new BadRequestException(insErr.message);
    }
    await this.markInviteAccepted(inviteId, actorProfileId);
    return { accepted: true as const };
  }

  async listWorkspaceInvites(actorProfileId: string, tenantId: string) {
    await this.assertCanManageWorkspaceInvites(actorProfileId, tenantId);
    const { data, error } = await this.supabase
      .from('user_invitations')
      .select('id, email_original, role, status, expires_at, created_at, accepted_at')
      .eq('tenant_id', tenantId)
      .eq('scope', 'WORKSPACE')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async createWorkspaceInvite(
    actorProfileId: string,
    tenantId: string,
    emailRaw: string,
    roleUi: 'ADMIN' | 'USER',
  ): Promise<{ invitationId: string; actionLink: string; emailSent: false }> {
    await this.assertCanManageWorkspaceInvites(actorProfileId, tenantId);
    const email = emailRaw.trim();
    if (!email || !email.includes('@')) throw new BadRequestException('Valid email is required');
    const emailNormalized = normalizeEmail(email);

    const tenantRole: TenantRole = roleUi === 'ADMIN' ? 'ADMIN' : 'AGENT';

    const { data: t, error: te } = await this.supabase.from('tenants').select('id, agency_id').eq('id', tenantId).single();
    if (te || !t) throw new NotFoundException('Workspace not found');
    const agencyId = t.agency_id as string;

    const existingMember = await this.findTenantMembershipByEmail(tenantId, emailNormalized);
    if (existingMember) {
      throw new ConflictException('This user already has access.');
    }

    const inviteRow = await this.upsertPendingInvite({
      scope: 'WORKSPACE',
      agencyId,
      tenantId,
      emailNormalized,
      emailOriginal: email,
      role: tenantRole,
      invitedByProfileId: actorProfileId,
    });

    const redirectTo = `${inviteAppBaseUrl()}/auth/invite?invite_id=${encodeURIComponent(inviteRow.id)}&scope=workspace`;
    const actionLink = await this.generateInviteLink(email, redirectTo, {
      invite_id: inviteRow.id,
      scope: 'workspace',
      tenant_id: tenantId,
    });

    return { invitationId: inviteRow.id, actionLink, emailSent: false };
  }

  async acceptWorkspaceInvite(actorProfileId: string, inviteId: string, accessToken: string) {
    const email = await this.emailForAuthUser(accessToken, actorProfileId);
    const inv = (await this.loadPendingInvite(inviteId, 'WORKSPACE')) as {
      email_normalized: string;
      tenant_id: string;
      role: string;
    };
    if (inv.email_normalized !== normalizeEmail(email)) {
      throw new ForbiddenException('Signed-in email does not match this invite');
    }
    const tenantId = inv.tenant_id;
    const existing = await this.findTenantMembershipByProfile(tenantId, actorProfileId);
    if (existing) {
      await this.markInviteAccepted(inviteId, actorProfileId);
      return { alreadyMember: true as const };
    }
    const role = inv.role as TenantRole;
    const now = new Date().toISOString();
    const { error: insErr } = await this.supabase.from('tenant_users').insert({
      id: randomUUID(),
      tenant_id: tenantId,
      profile_id: actorProfileId,
      role,
      created_at: now,
      updated_at: now,
    });
    if (insErr) {
      if (/duplicate|23505/i.test(insErr.message)) {
        await this.markInviteAccepted(inviteId, actorProfileId);
        return { alreadyMember: true as const };
      }
      throw new BadRequestException(insErr.message);
    }
    await this.markInviteAccepted(inviteId, actorProfileId);
    return { accepted: true as const };
  }

  async generateAgencyMemberRecoveryLink(actorProfileId: string, agencyId: string, membershipId: string) {
    await this.assertAgencyAdminOrOwner(actorProfileId, agencyId);
    const { data: row, error } = await this.supabase
      .from('agency_users')
      .select('id, agency_id, profile_id, profiles(email)')
      .eq('id', membershipId)
      .single();
    if (error || !row || (row as { agency_id: string }).agency_id !== agencyId) throw new NotFoundException('Member not found');
    const em = ((row as { profiles?: { email?: string } }).profiles?.email ?? '').trim();
    if (!em) throw new BadRequestException('Member has no email on file');
    const redirectTo = `${inviteAppBaseUrl()}/auth/reset-password`;
    return { actionLink: await this.generateRecoveryLink(em, redirectTo), emailSent: false as const };
  }

  async generateTenantMemberRecoveryLink(actorProfileId: string, tenantId: string, membershipId: string) {
    await this.assertCanManageWorkspaceInvites(actorProfileId, tenantId);
    const { data: row, error } = await this.supabase
      .from('tenant_users')
      .select('id, tenant_id, profile_id, profiles(email)')
      .eq('id', membershipId)
      .single();
    if (error || !row || (row as { tenant_id: string }).tenant_id !== tenantId) {
      throw new NotFoundException('Member not found');
    }
    const em = ((row as { profiles?: { email?: string } }).profiles?.email ?? '').trim();
    if (!em) throw new BadRequestException('Member has no email on file');
    const redirectTo = `${inviteAppBaseUrl()}/auth/reset-password`;
    return { actionLink: await this.generateRecoveryLink(em, redirectTo), emailSent: false as const };
  }

  private async emailForAuthUser(accessToken: string, profileId: string): Promise<string> {
    const { data, error } = await this.supabase.auth.getUser(accessToken);
    if (error || !data.user?.email) throw new UnauthorizedException('Invalid session');
    if (data.user.id !== profileId) {
      this.logger.warn(`accept invite: auth user id ${data.user.id} !== profile id ${profileId}`);
    }
    return data.user.email;
  }

  private async assertAgencyAdminOrOwner(actorProfileId: string, agencyId: string) {
    const ok = await this.auth.isAgencyAdmin(actorProfileId, agencyId);
    if (!ok) throw new ForbiddenException('Agency admin access required');
  }

  /** Workspace ADMIN or agency OWNER/ADMIN for the workspace's agency. */
  private async assertCanManageWorkspaceInvites(actorProfileId: string, tenantId: string) {
    if (await this.auth.isTenantAdmin(actorProfileId, tenantId)) return;
    const { data: t } = await this.supabase.from('tenants').select('agency_id').eq('id', tenantId).maybeSingle();
    const aid = t?.agency_id as string | undefined;
    if (aid && (await this.auth.isAgencyAdmin(actorProfileId, aid))) return;
    throw new ForbiddenException('Workspace admin or agency admin access required');
  }

  private async findAgencyMembershipByEmail(agencyId: string, emailNormalized: string): Promise<boolean> {
    const { data: prof } = await this.supabase.from('profiles').select('id').ilike('email', emailNormalized).maybeSingle();
    if (!prof?.id) return false;
    const { data: mem } = await this.supabase
      .from('agency_users')
      .select('id')
      .eq('agency_id', agencyId)
      .eq('profile_id', prof.id as string)
      .maybeSingle();
    return Boolean(mem);
  }

  private async findAgencyMembershipByProfile(agencyId: string, profileId: string): Promise<boolean> {
    const { data } = await this.supabase
      .from('agency_users')
      .select('id')
      .eq('agency_id', agencyId)
      .eq('profile_id', profileId)
      .maybeSingle();
    return Boolean(data);
  }

  private async findTenantMembershipByEmail(tenantId: string, emailNormalized: string): Promise<boolean> {
    const { data: prof } = await this.supabase.from('profiles').select('id').ilike('email', emailNormalized).maybeSingle();
    if (!prof?.id) return false;
    const { data: mem } = await this.supabase
      .from('tenant_users')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('profile_id', prof.id as string)
      .maybeSingle();
    return Boolean(mem);
  }

  private async findTenantMembershipByProfile(tenantId: string, profileId: string): Promise<boolean> {
    const { data } = await this.supabase
      .from('tenant_users')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('profile_id', profileId)
      .maybeSingle();
    return Boolean(data);
  }

  private async upsertPendingInvite(params: {
    scope: 'AGENCY' | 'WORKSPACE';
    agencyId: string;
    tenantId: string | null;
    emailNormalized: string;
    emailOriginal: string;
    role: string;
    invitedByProfileId: string;
  }): Promise<{ id: string }> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + INVITE_TTL_MS).toISOString();
    const id = randomUUID();

    let existingQuery = this.supabase
      .from('user_invitations')
      .select('id')
      .eq('email_normalized', params.emailNormalized)
      .eq('scope', params.scope)
      .eq('agency_id', params.agencyId)
      .eq('status', 'PENDING')
      .gt('expires_at', now.toISOString());
    existingQuery =
      params.scope === 'WORKSPACE'
        ? existingQuery.eq('tenant_id', params.tenantId as string)
        : existingQuery.is('tenant_id', null);
    const { data: existing } = await existingQuery.maybeSingle();

    if (existing?.id) {
      const { error: upErr } = await this.supabase
        .from('user_invitations')
        .update({
          expires_at: expiresAt,
          role: params.role,
          invited_by_profile_id: params.invitedByProfileId,
        })
        .eq('id', existing.id as string);
      if (upErr) this.logger.warn(`invite refresh failed: ${upErr.message}`);
      return { id: existing.id as string };
    }

    const { error } = await this.supabase.from('user_invitations').insert({
      id,
      email_normalized: params.emailNormalized,
      email_original: params.emailOriginal,
      scope: params.scope,
      agency_id: params.agencyId,
      tenant_id: params.tenantId,
      role: params.role,
      invited_by_profile_id: params.invitedByProfileId,
      status: 'PENDING',
      expires_at: expiresAt,
    });
    if (error) throw new BadRequestException(error.message);
    return { id };
  }

  private async loadPendingInvite(inviteId: string, scope: 'AGENCY' | 'WORKSPACE') {
    const { data, error } = await this.supabase.from('user_invitations').select('*').eq('id', inviteId).single();
    if (error || !data) throw new NotFoundException('Invite not found');
    const inv = data as Record<string, unknown>;
    if (inv['scope'] !== scope) throw new BadRequestException('Invalid invite scope');
    if (inv['status'] !== 'PENDING') throw new ConflictException('This invite is no longer valid');
    if (new Date(String(inv['expires_at'])).getTime() < Date.now()) {
      await this.supabase.from('user_invitations').update({ status: 'EXPIRED' }).eq('id', inviteId);
      throw new HttpException('Invite expired', HttpStatus.GONE);
    }
    return inv;
  }

  private async markInviteAccepted(inviteId: string, profileId: string) {
    const now = new Date().toISOString();
    await this.supabase
      .from('user_invitations')
      .update({ status: 'ACCEPTED', accepted_at: now, accepted_profile_id: profileId })
      .eq('id', inviteId);
  }

  private async generateInviteLink(email: string, redirectTo: string, data: Record<string, string>) {
    const { data: linkData, error } = await this.supabase.auth.admin.generateLink({
      type: 'invite',
      email,
      options: { redirectTo, data },
    });
    if (error) {
      this.logger.warn(`generateLink invite failed: ${error.message}`);
      throw new BadRequestException(error.message);
    }
    const props = linkData as { properties?: { action_link?: string }; action_link?: string };
    const actionLink = props.properties?.action_link ?? props.action_link;
    if (!actionLink) throw new BadRequestException('Could not create invite link');
    return actionLink;
  }

  private async generateRecoveryLink(email: string, redirectTo: string) {
    const { data: linkData, error } = await this.supabase.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: { redirectTo },
    });
    if (error) {
      this.logger.warn(`generateLink recovery failed: ${error.message}`);
      throw new BadRequestException(error.message);
    }
    const props = linkData as { properties?: { action_link?: string }; action_link?: string };
    const actionLink = props.properties?.action_link ?? props.action_link;
    if (!actionLink) throw new BadRequestException('Could not create reset link');
    return actionLink;
  }
}
