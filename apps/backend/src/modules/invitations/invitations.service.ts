// Invitations — Supabase Auth invite + recovery email (with action_link fallback).
// Sends real Supabase emails by default; falls back to a copyable action link only when
// the project has no email provider configured (or, for recovery, on transient failure).
// Service role key stays server-side only — the frontend only ever sees the API response.

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
import { getSupabaseServer, getSupabaseService } from '../../lib/supabase';
import type { AgencyRole, TenantRole } from '../../lib/enums';
import { AuthService } from '../auth/auth.service';

const INVITE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function displayNameFromEmail(email: string): string {
  const local = normalizeEmail(email).split('@')[0] ?? 'User';
  return local.replace(/[._-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || 'User';
}

/**
 * Resolve the public app origin used in Supabase invite/recovery `redirectTo`.
 *
 * Order: `INVITE_APP_BASE_URL` → `NEXT_PUBLIC_APP_URL` → (dev only) `http://localhost:3000`.
 * In production:
 *   - missing config → throw (do not silently emit localhost links)
 *   - localhost / 127.0.0.1 hostname → throw (a misconfigured prod deploy must not email
 *     working "localhost" links to real users)
 * Local dev (`NODE_ENV !== 'production'`) keeps the localhost fallback for convenience.
 */
export function resolveInviteAppBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = (env['INVITE_APP_BASE_URL'] ?? env['NEXT_PUBLIC_APP_URL'] ?? '').trim();
  const isProd = env['NODE_ENV'] === 'production';
  if (raw) {
    const trimmed = raw.replace(/\/+$/, '');
    if (isProd && /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(trimmed)) {
      throw new Error(
        'INVITE_APP_BASE_URL points to localhost in production. Set it to the public app origin (e.g. https://app.example.com) before issuing invite or recovery links.',
      );
    }
    return trimmed;
  }
  if (isProd) {
    throw new Error(
      'INVITE_APP_BASE_URL is not set. Set INVITE_APP_BASE_URL (or NEXT_PUBLIC_APP_URL) on the backend to the public app origin (e.g. https://app.example.com) before issuing invite or recovery links.',
    );
  }
  return 'http://localhost:3000';
}

function inviteAppBaseUrl(): string {
  return resolveInviteAppBaseUrl();
}

/**
 * Result of sending an invite (or refreshing one). When Supabase Auth
 * accepts the invite request, `emailSent` is true and `actionLink` is null —
 * the UI should not show a copy-link field. When email delivery is unavailable
 * (no project SMTP configured, or transient send failure), the service falls
 * back to a one-shot magic link the operator can copy/paste, and the UI is
 * expected to label it clearly as a fallback.
 */
type InviteSendResult = {
  invitationId: string;
  emailSent: boolean;
  actionLink: string | null;
};

/**
 * Result of issuing a password recovery. `emailSent: true` means Supabase
 * delivered the recovery email (UI should say "Reset password email sent").
 * `emailSent: false` with an `actionLink` is the fallback path — UI should
 * show a copyable link labelled "Reset link created".
 */
type RecoverySendResult = {
  emailSent: boolean;
  actionLink: string | null;
};

@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);
  private readonly supabase = getSupabaseService();
  /** Anon-key client used for `auth.resetPasswordForEmail`, which only the public client exposes. */
  private readonly supabaseAnon = getSupabaseServer();

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
  ): Promise<InviteSendResult> {
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

    const send = await this.sendAgencyInviteEmail(email, inviteRow.id);
    return { invitationId: inviteRow.id, emailSent: send.emailSent, actionLink: send.actionLink };
  }

  async acceptAgencyInvite(actorProfileId: string, inviteId: string, accessToken: string) {
    const { email, fullName } = await this.resolveAuthSessionForInvite(accessToken, actorProfileId);
    const inv = (await this.loadPendingInvite(inviteId, 'AGENCY')) as {
      email_normalized: string;
      email_original?: string;
      agency_id: string;
      role: string;
    };
    const invitedLabel = String(inv['email_original'] ?? inv.email_normalized ?? '').trim() || inv.email_normalized;
    if (inv.email_normalized !== normalizeEmail(email)) {
      throw new ForbiddenException(
        `This invite was sent to ${invitedLabel}, but you are signed in as ${email.trim()}. Sign out and continue with the invited email.`,
      );
    }

    const agencyId = inv.agency_id;
    const existing = await this.findAgencyMembershipByProfile(agencyId, actorProfileId);
    if (existing) {
      await this.markInviteAccepted(inviteId, actorProfileId);
      return { alreadyMember: true as const };
    }

    await this.ensureProfileForAuthUser({
      profileId: actorProfileId,
      email,
      fullName,
    });

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
      if (/23503|foreign key|violates foreign key/i.test(String(insErr.message))) {
        throw new BadRequestException('We could not attach this account to the invite. Please contact support.');
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
  ): Promise<InviteSendResult> {
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

    const send = await this.sendWorkspaceInviteEmail(email, inviteRow.id, tenantId);
    return { invitationId: inviteRow.id, emailSent: send.emailSent, actionLink: send.actionLink };
  }

  async acceptWorkspaceInvite(actorProfileId: string, inviteId: string, accessToken: string) {
    const { email, fullName } = await this.resolveAuthSessionForInvite(accessToken, actorProfileId);
    const inv = (await this.loadPendingInvite(inviteId, 'WORKSPACE')) as {
      email_normalized: string;
      email_original?: string;
      tenant_id: string;
      role: string;
    };
    const invitedLabel = String(inv['email_original'] ?? inv.email_normalized ?? '').trim() || inv.email_normalized;
    if (inv.email_normalized !== normalizeEmail(email)) {
      throw new ForbiddenException(
        `This invite was sent to ${invitedLabel}, but you are signed in as ${email.trim()}. Sign out and continue with the invited email.`,
      );
    }
    const tenantId = inv.tenant_id;
    const existing = await this.findTenantMembershipByProfile(tenantId, actorProfileId);
    if (existing) {
      await this.markInviteAccepted(inviteId, actorProfileId);
      return { alreadyMember: true as const };
    }

    await this.ensureProfileForAuthUser({
      profileId: actorProfileId,
      email,
      fullName,
    });

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
      if (/23503|foreign key|violates foreign key/i.test(String(insErr.message))) {
        throw new BadRequestException('We could not attach this account to the invite. Please contact support.');
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
    const send = await this.sendRecoveryEmail(em, redirectTo);
    await this.auditRecoveryLink({
      agencyId,
      tenantId: null,
      actorProfileId,
      targetProfileId,
      targetRole,
      scope: 'AGENCY',
    });
    return send;
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
    const send = await this.sendRecoveryEmail(em, redirectTo);
    await this.auditRecoveryLink({
      agencyId,
      tenantId,
      actorProfileId,
      targetProfileId,
      targetRole,
      scope: 'WORKSPACE',
    });
    return send;
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

  /**
   * Resolve the Supabase Auth user for an invite acceptance. JWT `sub` must match the access token user id.
   */
  private async resolveAuthSessionForInvite(
    accessToken: string,
    actorProfileId: string,
  ): Promise<{ email: string; fullName: string | null }> {
    const { data, error } = await this.supabase.auth.getUser(accessToken);
    if (error || !data.user?.email) throw new UnauthorizedException('Invalid session');
    if (data.user.id !== actorProfileId) {
      this.logger.warn(`accept invite: auth user id ${data.user.id} !== JWT profile id ${actorProfileId}`);
      throw new ForbiddenException('Your session does not match this sign-in. Sign out and open the invite link again.');
    }
    const meta = data.user.user_metadata as Record<string, unknown> | undefined;
    const fromMeta =
      typeof meta?.['full_name'] === 'string'
        ? meta['full_name'].trim()
        : typeof meta?.['name'] === 'string'
          ? (meta['name'] as string).trim()
          : '';
    return { email: data.user.email, fullName: fromMeta || null };
  }

  /**
   * Ensure `public.profiles` has a row for this auth user (Supabase invite creates auth.users only).
   * Call only after the invite is verified PENDING and the signed-in email matches the invitation.
   */
  private async ensureProfileForAuthUser(params: {
    profileId: string;
    email: string;
    fullName?: string | null;
  }): Promise<void> {
    const emailTrim = params.email.trim();
    if (!emailTrim) throw new BadRequestException('We could not attach this account to the invite. Please contact support.');

    const { data: existing, error: readErr } = await this.supabase
      .from('profiles')
      .select('id')
      .eq('id', params.profileId)
      .maybeSingle();
    if (readErr) {
      this.logger.warn(`ensureProfile read failed: ${readErr.message}`);
      throw new BadRequestException('We could not attach this account to the invite. Please contact support.');
    }
    if (existing?.id) return;

    const now = new Date().toISOString();
    const fullName = (params.fullName?.trim() || displayNameFromEmail(emailTrim)) || null;
    const { error: insErr } = await this.supabase.from('profiles').insert({
      id: params.profileId,
      email: emailTrim,
      full_name: fullName,
      created_at: now,
      updated_at: now,
    });
    if (insErr) {
      if (/23505|duplicate/i.test(insErr.message)) {
        throw new BadRequestException('We could not attach this account to the invite. Please contact support.');
      }
      this.logger.warn(`ensureProfile insert failed: ${insErr.message}`);
      throw new BadRequestException('We could not attach this account to the invite. Please contact support.');
    }
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

  /**
   * Send an agency invite email through Supabase Auth (`admin.inviteUserByEmail`).
   * Falls back to a copyable magic link only when Supabase explicitly tells us email
   * delivery is not available — e.g. project SMTP not configured. We never silently
   * swallow real send errors.
   */
  private async sendAgencyInviteEmail(email: string, inviteId: string): Promise<{ emailSent: boolean; actionLink: string | null }> {
    const redirectTo = `${inviteAppBaseUrl()}/auth/reset-password?invite_id=${encodeURIComponent(inviteId)}&scope=agency`;
    return this.sendInviteEmail(email, redirectTo, { invite_id: inviteId, scope: 'agency' });
  }

  /** Workspace variant — see {@link sendAgencyInviteEmail}. */
  private async sendWorkspaceInviteEmail(
    email: string,
    inviteId: string,
    tenantId: string,
  ): Promise<{ emailSent: boolean; actionLink: string | null }> {
    const redirectTo = `${inviteAppBaseUrl()}/auth/reset-password?invite_id=${encodeURIComponent(inviteId)}&scope=workspace`;
    return this.sendInviteEmail(email, redirectTo, { invite_id: inviteId, scope: 'workspace', tenant_id: tenantId });
  }

  private async sendInviteEmail(
    email: string,
    redirectTo: string,
    data: Record<string, string>,
  ): Promise<{ emailSent: boolean; actionLink: string | null }> {
    // Primary path — Supabase sends the invite email through configured SMTP.
    const { error: sendErr } = await this.supabase.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data,
    });
    if (!sendErr) {
      this.logger.log(`invite email sent via supabase to ${email}`);
      return { emailSent: true, actionLink: null };
    }

    if (this.isMissingEmailProviderError(sendErr)) {
      // Project SMTP not configured. Fall back to a one-shot magic link the operator
      // can paste into their own email — the UI labels this as "copy link" mode.
      this.logger.warn(
        `invite email skipped — Supabase project has no email provider configured; falling back to action_link for ${email}`,
      );
      const actionLink = await this.generateMagicInviteLink(email, redirectTo, data);
      return { emailSent: false, actionLink };
    }

    // A real send failure (rate limit, bad SMTP, etc.) — do NOT pretend it was sent.
    this.logger.warn(`invite email failed: ${sendErr.message}`);
    throw new BadRequestException(sendErr.message || 'Could not send invite email');
  }

  /**
   * Send a recovery email through Supabase Auth using the public client
   * (`auth.resetPasswordForEmail`). On failure or when SMTP is not configured,
   * fall back to `admin.generateLink({ type: 'recovery' })` so the operator can
   * still copy a working link — the UI clearly labels the two states.
   */
  private async sendRecoveryEmail(email: string, redirectTo: string): Promise<RecoverySendResult> {
    const { error: sendErr } = await this.supabaseAnon.auth.resetPasswordForEmail(email, { redirectTo });
    if (!sendErr) {
      this.logger.log(`recovery email sent via supabase to ${email}`);
      return { emailSent: true, actionLink: null };
    }

    if (this.isMissingEmailProviderError(sendErr)) {
      this.logger.warn(
        `recovery email skipped — Supabase project has no email provider configured; falling back to action_link for ${email}`,
      );
      const actionLink = await this.generateMagicRecoveryLink(email, redirectTo);
      return { emailSent: false, actionLink };
    }

    this.logger.warn(`recovery email send failed (${sendErr.message}); falling back to action_link for ${email}`);
    // For recovery the spec allows a fallback in any failure case so admins are not
    // blocked entirely if email is misconfigured. The fallback UI is clearly distinct.
    const actionLink = await this.generateMagicRecoveryLink(email, redirectTo);
    return { emailSent: false, actionLink };
  }

  private isMissingEmailProviderError(err: { message?: string; status?: number; name?: string }): boolean {
    const m = String(err?.message ?? '').toLowerCase();
    return /email provider|email service|email is not configured|smtp/.test(m);
  }

  private async generateMagicInviteLink(email: string, redirectTo: string, data: Record<string, string>): Promise<string> {
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

  private async generateMagicRecoveryLink(email: string, redirectTo: string): Promise<string> {
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

  // ---------------------------------------------------------------------------
  // Pending invite revoke + resend
  // ---------------------------------------------------------------------------

  async revokeAgencyInvite(actorProfileId: string, agencyId: string, inviteId: string): Promise<{ revoked: true }> {
    await this.assertAgencyAdminOrOwner(actorProfileId, agencyId);
    await this.revokePendingInvite({ scope: 'AGENCY', agencyId, tenantId: null, inviteId });
    return { revoked: true };
  }

  async revokeWorkspaceInvite(actorProfileId: string, tenantId: string, inviteId: string): Promise<{ revoked: true }> {
    await this.assertCanManageWorkspaceInvites(actorProfileId, tenantId);
    const { data: t } = await this.supabase.from('tenants').select('agency_id').eq('id', tenantId).maybeSingle();
    const agencyId = (t as { agency_id?: string } | null)?.agency_id ?? null;
    if (!agencyId) throw new NotFoundException('Workspace not found');
    await this.revokePendingInvite({ scope: 'WORKSPACE', agencyId, tenantId, inviteId });
    return { revoked: true };
  }

  async resendAgencyInvite(actorProfileId: string, agencyId: string, inviteId: string): Promise<InviteSendResult> {
    await this.assertAgencyAdminOrOwner(actorProfileId, agencyId);
    const inv = await this.loadPendingInviteForResend({ scope: 'AGENCY', agencyId, tenantId: null, inviteId });
    await this.refreshInviteExpiry(inviteId);
    const send = await this.sendAgencyInviteEmail(inv.email_original, inviteId);
    return { invitationId: inviteId, emailSent: send.emailSent, actionLink: send.actionLink };
  }

  async resendWorkspaceInvite(actorProfileId: string, tenantId: string, inviteId: string): Promise<InviteSendResult> {
    await this.assertCanManageWorkspaceInvites(actorProfileId, tenantId);
    const { data: t } = await this.supabase.from('tenants').select('agency_id').eq('id', tenantId).maybeSingle();
    const agencyId = (t as { agency_id?: string } | null)?.agency_id ?? null;
    if (!agencyId) throw new NotFoundException('Workspace not found');
    const inv = await this.loadPendingInviteForResend({ scope: 'WORKSPACE', agencyId, tenantId, inviteId });
    await this.refreshInviteExpiry(inviteId);
    const send = await this.sendWorkspaceInviteEmail(inv.email_original, inviteId, tenantId);
    return { invitationId: inviteId, emailSent: send.emailSent, actionLink: send.actionLink };
  }

  /** Fetch a pending invite within the caller's scope (404s otherwise — no cross-scope leakage). */
  private async loadPendingInviteForResend(params: {
    scope: 'AGENCY' | 'WORKSPACE';
    agencyId: string;
    tenantId: string | null;
    inviteId: string;
  }): Promise<{ id: string; email_original: string }> {
    const { data, error } = await this.supabase
      .from('user_invitations')
      .select('id, email_original, scope, status, agency_id, tenant_id')
      .eq('id', params.inviteId)
      .maybeSingle();
    if (error || !data) throw new NotFoundException('Invite not found');
    const row = data as { scope?: string; status?: string; agency_id?: string; tenant_id?: string | null; email_original?: string };
    if (row.scope !== params.scope) throw new NotFoundException('Invite not found');
    if (row.agency_id !== params.agencyId) throw new NotFoundException('Invite not found');
    if (params.scope === 'WORKSPACE' && row.tenant_id !== params.tenantId) throw new NotFoundException('Invite not found');
    if (row.status !== 'PENDING') throw new BadRequestException('Only pending invites can be re-sent.');
    if (!row.email_original?.trim()) throw new BadRequestException('Invite has no email on file');
    return { id: params.inviteId, email_original: row.email_original.trim() };
  }

  /** Mark a PENDING invite as REVOKED. Idempotent — already-revoked rows return successfully. */
  private async revokePendingInvite(params: {
    scope: 'AGENCY' | 'WORKSPACE';
    agencyId: string;
    tenantId: string | null;
    inviteId: string;
  }): Promise<void> {
    const { data, error } = await this.supabase
      .from('user_invitations')
      .select('id, scope, status, agency_id, tenant_id')
      .eq('id', params.inviteId)
      .maybeSingle();
    if (error || !data) throw new NotFoundException('Invite not found');
    const row = data as { scope?: string; status?: string; agency_id?: string; tenant_id?: string | null };
    if (row.scope !== params.scope) throw new NotFoundException('Invite not found');
    if (row.agency_id !== params.agencyId) throw new NotFoundException('Invite not found');
    if (params.scope === 'WORKSPACE' && row.tenant_id !== params.tenantId) throw new NotFoundException('Invite not found');
    if (row.status === 'REVOKED') return;
    if (row.status !== 'PENDING') throw new BadRequestException('Only pending invites can be revoked.');
    const { error: upErr } = await this.supabase
      .from('user_invitations')
      .update({ status: 'REVOKED' })
      .eq('id', params.inviteId);
    if (upErr) throw new BadRequestException(upErr.message || 'Failed to revoke invite');
  }

  private async refreshInviteExpiry(inviteId: string): Promise<void> {
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();
    const { error } = await this.supabase
      .from('user_invitations')
      .update({ expires_at: expiresAt })
      .eq('id', inviteId);
    if (error) this.logger.warn(`invite expiry refresh failed: ${error.message}`);
  }
}
