// GHL API client - focused on connection verification and health check
// For Private Integration tokens (not Marketplace OAuth)
//
// IMPORTANT: GHL Private Integration tokens are static bearer tokens.
// They do NOT have OAuth-style refresh. The token is used directly.

import axios, { AxiosInstance, AxiosError } from 'axios';

export interface GhlClientConfig {
  baseUrl: string;
  accessToken: string;
  locationId: string;
}

// GHL API Response types
export interface GhlLocationInfo {
  id: string;
  name: string;
  accountId: string;
  status: string;
}

export interface GhlHealthResponse {
  success: boolean;
  locationId: string;
  accountId?: string;
  timestamp: string;
}

export interface GhlApiError {
  code: string;
  message: string;
  status: number;
}

// GHL Client class for connection verification
export class GhlClient {
  private client: AxiosInstance;
  private locationId: string;

  constructor(config: GhlClientConfig) {
    this.locationId = config.locationId;
    this.client = axios.create({
      baseURL: config.baseUrl || 'https://services.gohighlevel.com',
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        'Content-Type': 'application/json',
        'Version': '2021-07-28',
      },
      timeout: 10000,
    });
  }

  /**
   * Verify the access token is valid for the given location
   *
   * IMPORTANT - Endpoint Assumptions:
   * This implementation assumes the endpoint is:
   *   GET /locations/{locationId}
   *
   * This assumption needs to be verified against actual GHL Private Integration API.
   * Different GHL API versions or integration types may use different endpoints.
   *
   * TODO: Verify exact endpoint with live GHL Private Integration
   * TODO: Test with actual Private Integration token (not test/sandbox)
   * TODO: Determine if this endpoint requires specific OAuth scope vs PI token scope
   */
  async verifyConnection(): Promise<{ valid: boolean; location?: GhlLocationInfo; error?: string }> {
    try {
      // Endpoint assumed: GET /locations/{locationId}
      // Base URL: https://services.gohighlevel.com (or configurable via GHL_API_BASE_URL)
      //
      // NOTE: This has NOT been tested against a real GHL Private Integration yet.
      // The response parsing expects specific fields: id, name, accountId, status
      const response = await this.client.get<GhlLocationInfo>(
        `/locations/${this.locationId}`
      );

      if (response.data && response.data.id === this.locationId) {
        return {
          valid: true,
          location: response.data,
        };
      }

      return { valid: false, error: 'Location ID mismatch' };
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Perform health check on the connection
   * Delegates to verifyConnection - may expand later
   */
  async healthCheck(): Promise<GhlHealthResponse> {
    const result = await this.verifyConnection();

    return {
      success: result.valid,
      locationId: this.locationId,
      accountId: result.location?.accountId,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get location details for display purposes
   * Safe to call - only returns non-secret metadata
   */
  async getLocationInfo(): Promise<GhlLocationInfo | null> {
    try {
      const response = await this.client.get<GhlLocationInfo>(
        `/locations/${this.locationId}`
      );
      return response.data;
    } catch {
      return null;
    }
  }

  /**
   * Normalize error for safe handling
   */
  private handleError(error: unknown): { valid: boolean; error: string } {
    if (error instanceof AxiosError) {
      if (error.response?.status === 401) {
        return { valid: false, error: 'Invalid or expired token' };
      }
      if (error.response?.status === 403) {
        return { valid: false, error: 'Insufficient permissions for this location' };
      }
      if (error.response?.status === 404) {
        return { valid: false, error: 'Location not found' };
      }
      return { valid: false, error: error.message || 'API request failed' };
    }
    return { valid: false, error: 'Unknown error occurred' };
  }

  /**
   * Get masked token for logging
   * Never log actual tokens - this is for debugging/monitoring only
   */
  getMaskedToken(): string {
    if (!this.locationId || this.locationId.length <= 8) {
      return '****';
    }
    return this.locationId.substring(0, 4) + '...' + this.locationId.substring(this.locationId.length - 4);
  }
}

// Factory function to create client
export function createGhlClient(
  accessToken: string,
  locationId: string
): GhlClient {
  return new GhlClient({
    baseUrl: process.env['GHL_API_BASE_URL'] || 'https://services.gohighlevel.com',
    accessToken,
    locationId,
  });
}

// Re-export GhlConnectionStatus from Prisma for use in backend services
export type GhlConnectionStatus = 'DISCONNECTED' | 'CONNECTED' | 'INVALID' | 'ERROR';

// Safe error factory
export function createGhlApiError(code: string, message: string, status: number): GhlApiError {
  return { code, message, status };
}

// Export types for use in other packages
// (Types are already exported via their inline interface declarations above)