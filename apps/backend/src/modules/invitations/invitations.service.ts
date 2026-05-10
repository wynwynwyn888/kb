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

/**
 * Resolve the public app origin used in Supabase invite/recovery `redirectTo`.
 *
 * Order: `INVITE_APP_BASE_URL` → `NEXT_PUBLIC_APP_URL` → (dev only) `http://localhost:3000`.
 * In production the localhost fallback is blocked: missing config throws at call time
 * so invite/reset endpoints fail fast with a clear operator error instead of silently
 * generating links that point to localhost.
 */
function inviteAppBaseUrl(): string {
  const raw = (process.env['INVITE_APP_BASE_URL'] ?? process.env['NEXT_PUBLIC_APP_URL'] ?? '').trim();
  if (raw) return raw.replace(/\/+$/, '');
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error(
      'INVITE_APP_BASE_URL is not set. Set INVITE_APP_BASE_URL (or NEXT_PUBLIC_APP_URL) on the backend to the public app origin (e.g. https://app.example.com) before issuing invite or recovery links.',
    );
  }
  return 'http://localhost:3000';
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

  /**
   * Recovery-link permission rules (agency team page):
   *  - OWNER may reset OWNER (self only), ADMIN, OPERATOR, or MEMBER ("USER").
   *  - ADMIN may reset MEMBER/OPERATOR ("USER") only — never OWNER, never another ADMIN.
   *  - Nobody else can reset OWNER (block peer-admin → owner takeover).
   */
  async generateAgencyMemberRecoveryLink(actorProfileId: string, agencyId: string, membershipId: string) {
    await this.assertAgencyAdminOrOwner(actorProfileId, agencyId);
    const { data: row, error } = await this.supabase
      .from('agency_users')
      .select('id, agency_id, profile_id, role, profiles(email)')
      .eq('id', membershipId)
      .single();
    if (error || !row || (row as { agency_id: string }).agency_id !== agencyId) throw new NotFoundException('Member not found');
    const targetProfileId = (row as { profile_id: string }).profile_id;
    const targetRole = String((row as { role?: string }).role ?? '').toUpperCase();

    const actorRole = await this.getAgencyRole(actorProfileId, agencyId);
    if (!actorRole) throw new ForbiddenException('Agency admin access required');

    // OWNER target: only the owner themselves may issue a reset for that account.
    if (targetRole === 'OWNER' && targetProfileId !== actorProfileId) {
      throw new ForbiddenException('You cannot reset another owner. Owners must reset their own password.');
    }
    // ADMIN target: only an OWNER may issue (peer ADMIN → ADMIN is blocked).
    if (targetRole === 'ADMIN' && actorRole !== 'OWNER' && targetProfileId !== actorProfileId) {
      throw new ForbiddenException('Only an owner can reset another admin\u2019s password.');
    }

    const em = ((row as { profiles?: { email?: string } }).profiles?.email ?? '').trim();
    if (!em) throw new BadRequestException('Member has no email on file');
    const redirectTo = `${inviteAppBaseUrl()}/auth/reset-password`;
    const actionLink = await this.generateRecoveryLink(em, redirectTo);
    await this.auditRecoveryLink({
      agencyId,
      tenantId: null,
      actorProfileId,
      targetProfileId,
      targetRole,
      scope: 'AGENCY',
    });
    return { actionLink, emailSent: false as const };
  }

  /**
   * Recovery-link permission rules (workspace team page):
   *  - Agency OWNER/ADMIN may reset any workspace user under their agency, except an
   *    agency OWNER (which would be a privilege escalation through the workspace surface).
   *  - Workspace ADMIN may reset workspace AGENT/VIEWER ("USER") only — never another
   *    workspace ADMIN, never any agency-level user.
   */
  async generateTenantMemberRecoveryLink(actorProfileId: string, tenantId: string, membershipId: string) {
    await this.assertCanManageWorkspaceInvites(actorProfileId, tenantId);
    const { data: row, error } = await this.supabase
      .from('tenant_users')
      .select('id, tenant_id, profile_id, role, profiles(email)')
      .eq('id', membershipId)
      .single();
    if (error || !row || (row as { tenant_id: string }).tenant_id !== tenantId) {
      throw new NotFoundException('Member not found');
    }
    const targetProfileId = (row as { profile_id: string }).profile_id;
    const targetRole = String((row as { role?: string }).role ?? '').toUpperCase();

    const { data: tenantRow } = await this.supabase
      .from('tenants')
      .select('agency_id')
      .eq('id', tenantId)
      .maybeSingle();
    const agencyId = (tenantRow as { agency_id?: string } | null)?.agency_id ?? null;

    const actorAgencyRole = agencyId ? await this.getAgencyRole(actorProfileId, agencyId) : null;
    const actorIsAgencyStaff = actorAgencyRole === 'OWNER' || actorAgencyRole === 'ADMIN';
    const actorIsWorkspaceAdmin = !actorIsAgencyStaff && (await this.auth.isTenantAdmin(actorProfileId, tenantId));

    // Block agency-OWNER target via the workspace surface — even an agency ADMIN cannot
    // reset an OWNER through here. Owner resets must go through the agency team page.
    if (agencyId) {
      const targetAgencyRole = await this.getAgencyRole(targetProfileId, agencyId);
      if (targetAgencyRole === 'OWNER' && targetProfileId !== actorProfileId) {
        throw new ForbiddenException('Cannot reset an agency owner from the workspace team.');
      }
    }

    // Workspace ADMIN may not reset another workspace ADMIN (peer escalation).
    if (actorIsWorkspaceAdmin && targetRole === 'ADMIN' && targetProfileId !== actorProfileId) {
      throw new ForbiddenException('Workspace admins cannot reset another admin\u2019s password.');
    }

    const em = ((row as { profiles?: { email?: string } }).profiles?.email ?? '').trim();
    if (!em) throw new BadRequestException('Member has no email on file');
    const redirectTo = `${inviteAppBaseUrl()}/auth/reset-password`;
    const actionLink = await this.generateRecoveryLink(em, redirectTo);
    await this.auditRecoveryLink({
      agencyId,
      tenantId,
      actorProfileId,
      targetProfileId,
      targetRole,
      scope: 'WORKSPACE',
    });
    return { actionLink, emailSent: false as const };
  }

  /** Best-effort audit row for recovery-link issuance (reuses `quota_audit_logs` like other agency events). */
  private async auditRecoveryLink(params: {
    agencyId: string | null;
    tenantId: string | null;
    actorProfileId: string;
    targetProfileId: string;
    targetRole: string;
    scope: 'AGENCY' | 'WORKSPACE';
  }): Promise<void> {
    if (!params.agencyId) return;
    const { error } = await this.supabase.from('quota_audit_logs').insert({
      id: randomUUID(),
      agency_id: params.agencyId,
      profile_id: params.actorProfileId,
      tenant_id: params.tenantId,
      action: params.scope === 'AGENCY' ? 'agency.member.password_reset_link' : 'workspace.member.password_reset_link',
      delta: 0,
      previous_total: null,
      new_total: null,
      metadata: { targetProfileId: params.targetProfileId, targetRole: params.targetRole },
    });
    if (error) {
      this.logger.warn(`recovery link audit insert failed: ${error.message}`);
    }
  }

  private async getAgencyRole(profileId: string, agencyId: string): Promise<string | null> {
    const { data } = await this.supabase
      .from('agency_users')
      .select('role')
      .eq('agency_id', agencyId)
      .eq('profile_id', profileId)
      .maybeSingle();
    const r = (data as { role?: string } | null)?.role;
    return r ? String(r).toUpperCase() : null;
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
    if (error) {
      // Race against `user_invitations_pending_unique`: another request created
      // the same PENDING (agency, tenant, scope, email) row between SELECT and
      // INSERT. Recover the existing row instead of erroring.
      const msg = error.message ?? '';
      if (/23505/.test(msg) || /duplicate key/i.test(msg) || /user_invitations_pending_unique/i.test(msg)) {
        let recoverQuery = this.supabase
          .from('user_invitations')
          .select('id')
          .eq('email_normalized', params.emailNormalized)
          .eq('scope', params.scope)
          .eq('agency_id', params.agencyId)
          .eq('status', 'PENDING');
        recoverQuery =
          params.scope === 'WORKSPACE'
            ? recoverQuery.eq('tenant_id', params.tenantId as string)
            : recoverQuery.is('tenant_id', null);
        const { data: recovered } = await recoverQuery.maybeSingle();
        if (recovered?.id) return { id: recovered.id as string };
        throw new ConflictException('A pending invite already exists for this email.');
      }
      throw new BadRequestException(msg || 'Failed to create invite');
    }
    return { id };
  }

  /**
   * Load a PENDING invite for the requested scope. All "wrong scope / wrong status /
   * not found" cases collapse to a single "Invalid or expired invite." error so the
   * response never reveals whether an inviteId exists under a different scope.
   */
  private async loadPendingInvite(inviteId: string, scope: 'AGENCY' | 'WORKSPACE') {
    const { data, error } = await this.supabase.from('user_invitations').select('*').eq('id', inviteId).single();
    if (error || !data) throw new NotFoundException('Invalid or expired invite.');
    const inv = data as Record<string, unknown>;
    if (inv['scope'] !== scope) throw new NotFoundException('Invalid or expired invite.');
    if (inv['status'] !== 'PENDING') throw new NotFoundException('Invalid or expired invite.');
    if (new Date(String(inv['expires_at'])).getTime() < Date.now()) {
      await this.supabase.from('user_invitations').update({ status: 'EXPIRED' }).eq('id', inviteId);
      throw new HttpException('Invalid or expired invite.', HttpStatus.GONE);
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
