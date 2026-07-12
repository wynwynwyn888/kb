// GHL Service - handles connection management for Private Integration
// Manages connection state, verification, and token storage
//
// GHL Private Integration tokens:
// - These are static access tokens, NOT OAuth tokens
// - They do NOT refresh - they are long-lived API keys
// - The token itself is used directly as the bearer token for GHL API
//
// Tokens are stored encrypted (`encrypt()`); always `decrypt()` before calling GHL (`createGhlClient`).

import { randomUUID } from 'node:crypto';
import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
  Optional,
} from '@nestjs/common';
import { getSupabaseService } from '../../lib/supabase';
import { decrypt, encrypt, maskToken, safeLog } from '../../lib/encryption';
import { createGhlClient, GhlConnectionStatus, type GhlClient } from '@aisbp/ghl-client';
import { AuthorizationShadowService } from '../authorization/authorization-shadow.service';
import { agencyRoleCanReadTenant } from '../authorization/authorization-policy.service';

export interface SaveConnectionDto {
  ghlLocationId: string;
  privateIntegrationToken: string;
}

export interface ConnectionStatusResponse {
  status: GhlConnectionStatus;
  ghlLocationId: string;
  verifiedAt: Date | null;
  lastHealthCheckAt: Date | null;
  lastError: string | null;
  isConnected: boolean;
  maskToken?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class GhlService {
  private readonly logger = new Logger(GhlService.name);
  private supabase = getSupabaseService();

  constructor(@Optional() private readonly authorizationShadow?: AuthorizationShadowService) {}

  private async fetchTenantDisplayName(id: string): Promise<string> {
    const { data } = await this.supabase.from('tenants').select('name').eq('id', id).maybeSingle();
    const row = data as { name?: string | null } | null;
    const n = row?.name?.trim();
    return n && n.length > 0 ? n : id;
  }

  /**
   * Before saving a CONNECTED CRM row for this workspace, ensure no other workspace
   * already owns this GHL location (connected row or legacy tenants.ghl_location_id).
   */
  private async assertGhlLocationSaveAllowed(savingTenantId: string, ghlLocationId: string): Promise<void> {
    const { data: connectedOthers, error: cErr } = await this.supabase
      .from('tenant_ghl_connections')
      .select('tenant_id')
      .eq('ghl_location_id', ghlLocationId)
      .eq('status', 'CONNECTED')
      .neq('tenant_id', savingTenantId);

    if (cErr) {
      this.logger.warn(`assertGhlLocationSaveAllowed connected query error: ${cErr.message}`);
    } else if (connectedOthers && connectedOthers.length > 0) {
      const first = (connectedOthers as { tenant_id: string }[])[0];
      if (!first?.tenant_id) return;
      const name = await this.fetchTenantDisplayName(first.tenant_id);
      throw new ConflictException(
        `This CRM location is already connected to "${name}". Disconnect it there before using it here.`,
      );
    }

    const { data: staleOther, error: sErr } = await this.supabase
      .from('tenants')
      .select('id, name')
      .eq('ghl_location_id', ghlLocationId)
      .neq('id', savingTenantId)
      .maybeSingle();

    if (sErr) {
      this.logger.warn(`assertGhlLocationSaveAllowed legacy tenant query error: ${sErr.message}`);
      return;
    }

    if (staleOther) {
      const row = staleOther as { id: string; name?: string | null };
      this.logger.warn(
        `crmLegacyGhlLocationIdBlocksSave otherTenantId=${row.id} otherWorkspaceName=${JSON.stringify(row.name ?? '')} locationId=${ghlLocationId} savingTenantId=${savingTenantId}`,
      );
      const label = row.name?.trim() ? `"${row.name.trim()}"` : `"${row.id}"`;
      throw new ConflictException(
        `This CRM location is already listed on workspace ${label}. Disconnect or clear CRM there before using it here.`,
      );
    }
  }

  private decryptGhlTokenOrThrow(encrypted: string): string {
    try {
      return decrypt(String(encrypted));
    } catch {
      throw new BadRequestException(
        'Could not read the stored HighLevel token. Disconnect and save the connection again with a fresh private integration token.',
      );
    }
  }

  /**
   * Get GHL connection status for a tenant
   * Returns safe information only - never exposes raw token
   */
  async getConnectionStatus(tenantId: string, profileId: string): Promise<ConnectionStatusResponse | null> {
    // Verify tenant access
    const hasAccess = await this.checkTenantAccess(tenantId, profileId);
    if (!hasAccess) {
      throw new ForbiddenException('Access denied to this tenant');
    }

    // Get connection from DB
    const { data, error } = await this.supabase
      .from('tenant_ghl_connections')
      .select('*')
      .eq('tenant_id', tenantId)
      .single();

    if (error || !data) {
      return null;
    }

    return {
      status: data.status as GhlConnectionStatus,
      ghlLocationId: data.ghl_location_id,
      verifiedAt: data.verified_at ? new Date(data.verified_at) : null,
      lastHealthCheckAt: data.last_health_check_at ? new Date(data.last_health_check_at) : null,
      lastError: data.last_error || null,
      isConnected: data.status === 'CONNECTED',
      maskToken: data.ghl_location_id ? maskToken(String(data.ghl_location_id)) : undefined,
      metadata: data.metadata || {},
    };
  }

  /**
   * Save or update GHL connection for a tenant
   * Token is stored encrypted, never returned in raw form
   */
  async saveConnection(tenantId: string, profileId: string, dto: SaveConnectionDto): Promise<ConnectionStatusResponse> {
    // Verify tenant access
    const hasAccess = await this.checkTenantAccess(tenantId, profileId);
    if (!hasAccess) {
      throw new ForbiddenException('Access denied to this tenant');
    }

    const ghlLocationId = dto.ghlLocationId.trim();
    if (!ghlLocationId) {
      throw new BadRequestException('GHL location ID is required');
    }

    await this.assertGhlLocationSaveAllowed(tenantId, ghlLocationId);

    const { data: existingRow } = await this.supabase
      .from('tenant_ghl_connections')
      .select('id, private_token_encrypted')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    const incomingToken = dto.privateIntegrationToken.trim();
    let tokenForGhl = incomingToken;
    if (!tokenForGhl) {
      if (existingRow?.private_token_encrypted) {
        try {
          tokenForGhl = decrypt(String(existingRow.private_token_encrypted));
        } catch {
          throw new BadRequestException('Could not read stored token. Paste a new private integration token.');
        }
      } else {
        throw new BadRequestException('Private integration token is required');
      }
    }

    // Verify token is valid before storing
    const ghlClient = createGhlClient(tokenForGhl, ghlLocationId);
    const verification = await ghlClient.verifyConnection();

    this.logger.log(`Token verification: ${safeLog({
      locationId: ghlLocationId,
      valid: verification.valid,
      error: verification.error,
    })}`);

    if (!verification.valid) {
      throw new BadRequestException(verification.error || 'Invalid token');
    }

    // Encrypt token before storage (use newly pasted token, or re-store same plaintext when field left blank)
    const encryptedToken = incomingToken ? encrypt(incomingToken) : String(existingRow?.private_token_encrypted ?? '');
    if (!encryptedToken) {
      throw new BadRequestException('Private integration token is required');
    }

    // Get location info for metadata
    const locationInfo = await ghlClient.getLocationInfo();

    // Upsert connection record (table has no default for `id` — new rows need a generated UUID)
    const rowId = existingRow?.id && typeof existingRow.id === 'string' ? existingRow.id : randomUUID();
    const connectionData = {
      id: rowId,
      tenant_id: tenantId,
      ghl_location_id: ghlLocationId,
      private_token_encrypted: encryptedToken,
      status: 'CONNECTED' as const,
      verified_at: new Date().toISOString(),
      last_health_check_at: new Date().toISOString(),
      last_error: null,
      metadata: locationInfo ? {
        locationName: locationInfo.name,
        accountId: locationInfo.accountId,
      } : {},
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await this.supabase
      .from('tenant_ghl_connections')
      .upsert(connectionData, {
        onConflict: 'tenant_id',
      })
      .select()
      .single();

    if (error) {
      this.logger.error(
        `Failed to save connection: ${safeLog({ error: error.message, code: error.code, details: error })}`,
      );
      const detail = error.message?.trim() || 'Database error';
      throw new BadRequestException(`Could not save connection: ${detail}`);
    }

    await this.supabase
      .from('tenants')
      .update({ ghl_location_id: ghlLocationId, updated_at: new Date().toISOString() })
      .eq('id', tenantId);

    return {
      status: data.status as GhlConnectionStatus,
      ghlLocationId: data.ghl_location_id,
      verifiedAt: data.verified_at ? new Date(data.verified_at) : null,
      lastHealthCheckAt: data.last_health_check_at ? new Date(data.last_health_check_at) : null,
      lastError: data.last_error || null,
      isConnected: data.status === 'CONNECTED',
      maskToken: maskToken(ghlLocationId),
      metadata: data.metadata || {},
    };
  }

  /**
   * Verify existing connection by calling GHL API
   * Updates status based on verification result
   */
  async verifyConnection(tenantId: string, profileId: string): Promise<ConnectionStatusResponse> {
    // Get existing connection
    const { data: existing, error: fetchError } = await this.supabase
      .from('tenant_ghl_connections')
      .select('*')
      .eq('tenant_id', tenantId)
      .single();

    if (fetchError || !existing) {
      throw new NotFoundException('No connection found for this tenant');
    }

    // Verify access
    const hasAccess = await this.checkTenantAccess(tenantId, profileId);
    if (!hasAccess) {
      throw new ForbiddenException('Access denied to this tenant');
    }

    const plaintextToken = this.decryptGhlTokenOrThrow(String(existing.private_token_encrypted));
    const ghlClient = createGhlClient(plaintextToken, existing.ghl_location_id);
    const verification = await ghlClient.verifyConnection();

    if (verification.valid) {
      await this.assertGhlLocationSaveAllowed(tenantId, String(existing.ghl_location_id).trim());
    }

    // Update status based on verification
    const newStatus = verification.valid ? 'CONNECTED' : 'INVALID';
    const lastError = verification.error || null;

    const { data, error } = await this.supabase
      .from('tenant_ghl_connections')
      .update({
        status: newStatus,
        verified_at: verification.valid ? new Date().toISOString() : existing.verified_at,
        last_health_check_at: new Date().toISOString(),
        last_error: lastError,
      })
      .eq('tenant_id', tenantId)
      .select()
      .single();

    if (error) {
      throw new BadRequestException('Failed to update connection status');
    }

    if (verification.valid && data.ghl_location_id) {
      await this.supabase
        .from('tenants')
        .update({ ghl_location_id: String(data.ghl_location_id).trim(), updated_at: new Date().toISOString() })
        .eq('id', tenantId);
    }

    return {
      status: data.status as GhlConnectionStatus,
      ghlLocationId: data.ghl_location_id,
      verifiedAt: data.verified_at ? new Date(data.verified_at) : null,
      lastHealthCheckAt: data.last_health_check_at ? new Date(data.last_health_check_at) : null,
      lastError: data.last_error || null,
      isConnected: data.status === 'CONNECTED',
      maskToken: maskToken(data.ghl_location_id),
      metadata: data.metadata || {},
    };
  }

  /**
   * Perform health check on existing connection
   * Returns current health status without modifying connection state significantly
   */
  async healthCheck(tenantId: string, profileId: string): Promise<{ healthy: boolean; message: string; timestamp: string }> {
    // Get existing connection
    const { data: existing, error: fetchError } = await this.supabase
      .from('tenant_ghl_connections')
      .select('*')
      .eq('tenant_id', tenantId)
      .single();

    if (fetchError || !existing) {
      return {
        healthy: false,
        message: 'No connection configured',
        timestamp: new Date().toISOString(),
      };
    }

    // Verify access
    const hasAccess = await this.checkTenantAccess(tenantId, profileId);
    if (!hasAccess) {
      throw new ForbiddenException('Access denied to this tenant');
    }

    let plaintextToken: string;
    try {
      plaintextToken = decrypt(String(existing.private_token_encrypted));
    } catch {
      return {
        healthy: false,
        message: 'Stored token could not be read (re-save the connection with a valid token)',
        timestamp: new Date().toISOString(),
      };
    }
    const ghlClient = createGhlClient(plaintextToken, existing.ghl_location_id);
    const health = await ghlClient.healthCheck();

    // Update last health check timestamp and status
    // Note: We don't change CONNECTED status to ERROR based solely on health check
    // to avoid flapping. Only explicit verify changes status.
    await this.supabase
      .from('tenant_ghl_connections')
      .update({
        last_health_check_at: new Date().toISOString(),
      })
      .eq('tenant_id', tenantId);

    return {
      healthy: health.success,
      message: health.success ? 'Connection healthy' : 'Connection unhealthy',
      timestamp: health.timestamp,
    };
  }

  /**
   * Delete/disconnect GHL connection
   *
   * On disconnect:
   * - Record is deleted (no residual encrypted token)
   * - Status implicitly becomes DISCONNECTED (no record)
   * - verifiedAt, lastError are not preserved after delete
   *
   * If you need soft-disconnect (mark as disconnected without deleting),
   * consider using status='DISCONNECTED' with nulled token instead.
   */
  async deleteConnection(tenantId: string, profileId: string): Promise<void> {
    // Verify access
    const hasAccess = await this.checkTenantAccess(tenantId, profileId);
    if (!hasAccess) {
      throw new ForbiddenException('Access denied to this tenant');
    }

    const { data: existingConn } = await this.supabase
      .from('tenant_ghl_connections')
      .select('ghl_location_id')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    const connectionLocationId =
      existingConn && typeof (existingConn as { ghl_location_id?: unknown }).ghl_location_id === 'string'
        ? String((existingConn as { ghl_location_id: string }).ghl_location_id).trim()
        : '';

    const { error } = await this.supabase.from('tenant_ghl_connections').delete().eq('tenant_id', tenantId);

    if (error) {
      throw new BadRequestException('Failed to delete connection');
    }

    if (connectionLocationId) {
      await this.supabase
        .from('tenants')
        .update({ ghl_location_id: null, updated_at: new Date().toISOString() })
        .eq('id', tenantId)
        .eq('ghl_location_id', connectionLocationId);
    }
  }

  /**
   * Ensure the profile may access the tenant (tenant user or same-agency user). Throws 403 if not.
   */
  async ensureTenantAccessOrThrow(tenantId: string, profileId: string): Promise<void> {
    const ok = await this.checkTenantAccess(tenantId, profileId);
    if (!ok) {
      throw new ForbiddenException('Access denied to this tenant');
    }
  }

  /**
   * Ensure the profile may change tenant configuration or invoke credentialed
   * diagnostic tools. Tenant ADMIN and agency OWNER/ADMIN only.
   */
  async ensureTenantWriteAccessOrThrow(tenantId: string, profileId: string): Promise<void> {
    const { data: tenantMember } = await this.supabase
      .from('tenant_users')
      .select('role')
      .eq('profile_id', profileId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (tenantMember?.role === 'ADMIN') {
      void this.authorizationShadow?.observeTenantAccess({
        profileId, tenantId, action: 'write', legacyAllowed: true,
        source: 'GhlService.ensureTenantWriteAccessOrThrow',
      });
      return;
    }

    const { data: tenant } = await this.supabase
      .from('tenants')
      .select('agency_id')
      .eq('id', tenantId)
      .maybeSingle();
    if (tenant?.agency_id) {
      const { data: agencyMember } = await this.supabase
        .from('agency_users')
        .select('role')
        .eq('profile_id', profileId)
        .eq('agency_id', tenant.agency_id)
        .maybeSingle();
      if (agencyMember?.role === 'OWNER' || agencyMember?.role === 'ADMIN') {
        void this.authorizationShadow?.observeTenantAccess({
          profileId, tenantId, action: 'write', legacyAllowed: true,
          source: 'GhlService.ensureTenantWriteAccessOrThrow',
        });
        return;
      }
    }

    void this.authorizationShadow?.observeTenantAccess({
      profileId, tenantId, action: 'write', legacyAllowed: false,
      source: 'GhlService.ensureTenantWriteAccessOrThrow',
    });
    throw new ForbiddenException('You do not have permission to change this workspace');
  }

  /**
   * Authenticated GHL client for subaccount automation (calendars, tags).
   * Requires a CONNECTED tenant_ghl_connections row and a decryptable token.
   */
  async createGhlClientForConnectedTenantOrThrow(
    tenantId: string,
    profileId: string,
  ): Promise<{ client: GhlClient; ghlLocationId: string }> {
    await this.ensureTenantAccessOrThrow(tenantId, profileId);

    const { data: existing, error } = await this.supabase
      .from('tenant_ghl_connections')
      .select('*')
      .eq('tenant_id', tenantId)
      .single();

    if (error || !existing) {
      throw new BadRequestException('No GHL connection found for this tenant');
    }
    if (existing.status !== 'CONNECTED') {
      throw new BadRequestException('GHL integration is not connected');
    }

    const plaintextToken = this.decryptGhlTokenOrThrow(String(existing.private_token_encrypted));
    const client = createGhlClient(plaintextToken, existing.ghl_location_id);
    return { client, ghlLocationId: existing.ghl_location_id };
  }

  /**
   * Worker / internal automation — same as {@link createGhlClientForConnectedTenantOrThrow}
   * but skips end-user access checks. Only for trusted call sites (inbound jobs, system tasks).
   */
  async createGhlClientForConnectedTenantWorkerOrThrow(
    tenantId: string,
  ): Promise<{ client: GhlClient; ghlLocationId: string }> {
    const { data: existing, error } = await this.supabase
      .from('tenant_ghl_connections')
      .select('*')
      .eq('tenant_id', tenantId)
      .single();

    if (error || !existing) {
      throw new BadRequestException('No GHL connection found for this tenant');
    }
    if (existing.status !== 'CONNECTED') {
      throw new BadRequestException('GHL integration is not connected');
    }

    const plaintextToken = this.decryptGhlTokenOrThrow(String(existing.private_token_encrypted));
    const client = createGhlClient(plaintextToken, existing.ghl_location_id);
    return { client, ghlLocationId: existing.ghl_location_id };
  }

  /**
   * Check if user has access to tenant
   */
  private async checkTenantAccess(tenantId: string, profileId: string): Promise<boolean> {
    // Check tenant_users membership
    const { data: tenantMember } = await this.supabase
      .from('tenant_users')
      .select('role')
      .eq('profile_id', profileId)
      .eq('tenant_id', tenantId)
      .single();

    if (tenantMember) {
      void this.observeTenantRead(profileId, tenantId, true);
      return true;
    }

    // Check agency_users membership (agency can access all its tenants)
    const { data: tenant } = await this.supabase
      .from('tenants')
      .select('agency_id')
      .eq('id', tenantId)
      .single();

    if (!tenant) {
      void this.observeTenantRead(profileId, tenantId, false);
      return false;
    }

    const { data: agencyMember } = await this.supabase
      .from('agency_users')
      .select('role')
      .eq('profile_id', profileId)
      .eq('agency_id', tenant.agency_id)
      .single();

    const allowed = agencyRoleCanReadTenant(agencyMember?.role);
    void this.observeTenantRead(profileId, tenantId, allowed);
    return allowed;
  }

  private async observeTenantRead(profileId: string, tenantId: string, legacyAllowed: boolean): Promise<void> {
    try {
      await this.authorizationShadow?.observeTenantAccess({
        profileId,
        tenantId,
        action: 'read',
        legacyAllowed,
        source: 'GhlService.checkTenantAccess',
      });
    } catch {
      // Shadow observation must never affect the legacy authorization result.
    }
  }
}
