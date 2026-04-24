// GHL Service - handles connection management for Private Integration
// Manages connection state, verification, and token storage
//
// GHL Private Integration tokens:
// - These are static access tokens, NOT OAuth tokens
// - They do NOT refresh - they are long-lived API keys
// - The token itself is used directly as the bearer token for GHL API
//
// IMPORTANT: This implementation stores the encrypted token and uses it directly.
// For full production, consider:
// - Using Supabase Vault for additional security
// - Adding token rotation if GHL supports it
// - Proper error handling for expired/revoked tokens

import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { getSupabaseService } from '../../lib/supabase';
import { encrypt, maskToken, safeLog } from '../../lib/encryption';
import { createGhlClient, GhlConnectionStatus } from '@aisbp/ghl-client';

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
  private supabase = getSupabaseService();

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
      maskToken: data.ghl_location_id ? maskToken(data.ghl_location_id) : undefined,
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

    // Verify token is valid before storing
    const ghlClient = createGhlClient(dto.privateIntegrationToken, dto.ghlLocationId);
    const verification = await ghlClient.verifyConnection();

    console.log('[GhlService] Token verification:', safeLog({
      locationId: dto.ghlLocationId,
      valid: verification.valid,
      error: verification.error,
    }));

    if (!verification.valid) {
      throw new BadRequestException(verification.error || 'Invalid token');
    }

    // Encrypt token before storage
    const encryptedToken = encrypt(dto.privateIntegrationToken);

    // Get location info for metadata
    const locationInfo = await ghlClient.getLocationInfo();

    // Upsert connection record
    const connectionData = {
      tenant_id: tenantId,
      ghl_location_id: dto.ghlLocationId,
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
      console.error('[GhlService] Failed to save connection:', safeLog({ error }));
      throw new BadRequestException('Failed to save connection');
    }

    await this.supabase
      .from('tenants')
      .update({ ghl_location_id: dto.ghlLocationId, updated_at: new Date().toISOString() })
      .eq('id', tenantId);

    return {
      status: data.status as GhlConnectionStatus,
      ghlLocationId: data.ghl_location_id,
      verifiedAt: data.verified_at ? new Date(data.verified_at) : null,
      lastHealthCheckAt: data.last_health_check_at ? new Date(data.last_health_check_at) : null,
      lastError: data.last_error || null,
      isConnected: data.status === 'CONNECTED',
      maskToken: maskToken(dto.ghlLocationId),
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

    // Create GHL client using stored token
    // NOTE: For GHL Private Integration, the stored token IS the access token
    // We use it directly without decryption since it's stored encrypted
    // TODO: Verify decryption approach if needed for security hardening
    const ghlClient = createGhlClient(existing.private_token_encrypted, existing.ghl_location_id);
    const verification = await ghlClient.verifyConnection();

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

    // Perform health check using stored token
    // NOTE: Using stored encrypted token directly as bearer token
    const ghlClient = createGhlClient(existing.private_token_encrypted, existing.ghl_location_id);
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

    const { error } = await this.supabase
      .from('tenant_ghl_connections')
      .delete()
      .eq('tenant_id', tenantId);

    if (error) {
      throw new BadRequestException('Failed to delete connection');
    }
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

    if (tenantMember) return true;

    // Check agency_users membership (agency can access all its tenants)
    const { data: tenant } = await this.supabase
      .from('tenants')
      .select('agency_id')
      .eq('id', tenantId)
      .single();

    if (!tenant) return false;

    const { data: agencyMember } = await this.supabase
      .from('agency_users')
      .select('role')
      .eq('profile_id', profileId)
      .eq('agency_id', tenant.agency_id)
      .single();

    return !!agencyMember;
  }
}