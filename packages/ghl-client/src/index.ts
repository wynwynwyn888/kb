// GHL API client - focused on connection verification, health check, and outbound messaging
// For Private Integration tokens (not Marketplace OAuth)
//
// IMPORTANT: GHL Private Integration tokens are static bearer tokens.
// They do NOT have OAuth-style refresh. The token is used directly.

import axios from 'axios';
import type { AxiosInstance, AxiosError } from 'axios';

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

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null;
}

/** Official GHL (HighLevel) API host per current docs. */
const GHL_API_BASE_DEFAULT = 'https://services.leadconnectorhq.com';

/**
 * `services.gohighlevel.com` does not resolve (ENOTFOUND) — the API lives on leadconnectorhq.com.
 * Maps legacy env values so deployments that copied old examples still work.
 */
export function resolveGhlApiBaseUrl(envValue: string | undefined): string {
  const raw = (envValue ?? '').trim();
  if (!raw) return GHL_API_BASE_DEFAULT;
  const withoutTrailingSlashes = raw.replace(/\/+$/, '');
  try {
    const u = new URL(withoutTrailingSlashes);
    if (u.hostname === 'services.gohighlevel.com') {
      return GHL_API_BASE_DEFAULT;
    }
  } catch {
    return GHL_API_BASE_DEFAULT;
  }
  return withoutTrailingSlashes;
}

/** Trimmed non-empty string id, or null. */
export function normalizeGhlLocationId(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s.length > 0 ? s : null;
}

/**
 * GHL GET /locations/:locationId may return a flat location object, or wrap it
 * (e.g. `{ location: { ... } }`). The sub-account id is often `locationId`, while
 * `id` may be a different internal id — comparing only `response.data.id` caused false
 * "Location ID mismatch" for valid connections.
 */
export function extractGhlLocationPayload(data: unknown): Record<string, unknown> | null {
  if (!isRecord(data)) return null;
  const unwrapKeys = ['location', 'Location', 'data'];
  for (const key of unwrapKeys) {
    const inner = data[key];
    if (
      isRecord(inner) &&
      (inner['locationId'] !== undefined ||
        inner['id'] !== undefined ||
        inner['name'] !== undefined)
    ) {
      return inner;
    }
  }
  return data;
}

/** All string ids on a location payload that might equal the requested sub-account id. */
export function collectGhlSubAccountIds(payload: Record<string, unknown>): string[] {
  const out: string[] = [];
  const add = (v: unknown) => {
    const n = normalizeGhlLocationId(v);
    if (n && !out.includes(n)) out.push(n);
  };
  add(payload['locationId']);
  add(payload['id']);
  return out;
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

// Outbound message types
// CONFIRMED LIVE — GHL Private Integration:
//   POST /conversations/messages
//   SMS confirmed via live browser network capture (2026-04-19)
//
// Channel mapping — all channels MUST be live-verified before use:
//   SMS      — VERIFIED LIVE (live browser capture)
//   WHATSAPP — TODO: unverified, do not use
//   FACEBOOK — TODO: unverified, do not use
//   INSTAGRAM— TODO: unverified, do not use
//   TIKTOK   — TODO: unverified, do not use
//
// GHL API outbound payload per channel (this client uses one shape for all mapped channels):
//   SMS: { contactId, type: "SMS", message, attachments: [], channel: "sms", fromOneToOneConversation: true, locationId }
//
// WHATSAPP — NOT VERIFIED IN THIS REPO YET (CHANNEL_MAP.WHATSAPP stays null).
// Before enabling: capture a successful Private Integration POST /conversations/messages for WhatsApp
// the same way SMS was verified (browser DevTools or scripted call), and confirm the exact `type` and
// `channel` strings GHL accepts alongside `message`. Public help articles may show newer/alternate
// payload shapes (e.g. nested `content`); do not copy those into this map without matching live proof
// for the same request shape this client sends.

export type OutboundChannel = 'SMS' | 'WHATSAPP' | 'FACEBOOK' | 'INSTAGRAM' | 'TIKTOK';

interface OutboundChannelConfig {
  /** GHL API 'type' field value */
  type: string;
  /** GHL API 'channel' field value (lowercase) */
  channel: string;
  /** GHL API 'fromOneToOneConversation' flag */
  fromOneToOneConversation: boolean;
  /** GHL API 'attachments' array (currently empty for SMS) */
  attachments: unknown[];
}

/**
 * Internal channel map. null = unverified, do not use.
 * Add new verified channels here after live confirmation (see WHATSAPP note above).
 */
const CHANNEL_MAP: Record<OutboundChannel, OutboundChannelConfig | null> = {
  SMS: {
    type: 'SMS',
    channel: 'sms',
    fromOneToOneConversation: true,
    attachments: [],
  },
  /** null until `type`/`channel` for WhatsApp are proven for this client's body shape — see file header. */
  WHATSAPP: null,
  FACEBOOK: null,
  INSTAGRAM: null,
  TIKTOK: null,
};

export function isChannelVerified(channel: OutboundChannel): boolean {
  return CHANNEL_MAP[channel] !== null;
}

export function getChannelConfig(channel: OutboundChannel): OutboundChannelConfig | null {
  return CHANNEL_MAP[channel];
}

export interface GhlSendMessageRequest {
  locationId: string;
  contactId: string;
  message: string;
  channel: OutboundChannel;
}

export interface GhlSendMessageResponse {
  id: string;
  conversationId: string;
  status: string;
  timestamp: string;
}

// Contact tagging types
export interface TagContactRequest {
  contactId: string;
  tags: string[];
}

// Booking / appointment types
export interface BookSlotRequest {
  locationId: string;
  calendarId: string;
  contactId: string;
  startTime: string;
  endTime: string;
  title?: string;
  timezone?: string;
  appointmentStatus?: string;
}

// GHL Client class for connection verification and outbound messaging
export class GhlClient {
  private client: AxiosInstance;
  private locationId: string;

  constructor(config: GhlClientConfig) {
    this.locationId = config.locationId;
    this.client = axios.create({
      baseURL: config.baseUrl || 'https://services.leadconnectorhq.com',
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
      // Endpoint: GET /locations/{locationId} — see extractGhlLocationPayload for response shapes.
      const response = await this.client.get<unknown>(`/locations/${this.locationId}`);

      const requested = normalizeGhlLocationId(this.locationId);
      if (!requested) {
        return { valid: false, error: 'Location ID is required' };
      }

      const payload = extractGhlLocationPayload(response.data);
      if (!payload) {
        return { valid: false, error: 'Location ID mismatch' };
      }

      const idsOnPayload = collectGhlSubAccountIds(payload);
      if (!idsOnPayload.includes(requested)) {
        return { valid: false, error: 'Location ID mismatch' };
      }

      const name = typeof payload['name'] === 'string' ? payload['name'] : '';
      const accountId =
        typeof payload['accountId'] === 'string'
          ? payload['accountId']
          : typeof payload['companyId'] === 'string'
            ? payload['companyId']
            : '';
      const status = typeof payload['status'] === 'string' ? payload['status'] : '';

      return {
        valid: true,
        location: {
          id: requested,
          name,
          accountId,
          status,
        },
      };
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
      const response = await this.client.get<unknown>(`/locations/${this.locationId}`);
      const requested = normalizeGhlLocationId(this.locationId);
      const payload = extractGhlLocationPayload(response.data);
      if (!requested || !payload || !collectGhlSubAccountIds(payload).includes(requested)) {
        return null;
      }
      const name = typeof payload['name'] === 'string' ? payload['name'] : '';
      const accountId =
        typeof payload['accountId'] === 'string'
          ? payload['accountId']
          : typeof payload['companyId'] === 'string'
            ? payload['companyId']
            : '';
      const status = typeof payload['status'] === 'string' ? payload['status'] : '';
      return { id: requested, name, accountId, status };
    } catch {
      return null;
    }
  }

/**
 * Send an outbound message through GHL.
 *
 * CONFIRMED LIVE — SMS via GHL Private Integration (2026-04-19):
 *   POST /conversations/messages
 *   SMS Request: { contactId, type: "SMS", message, attachments: [], channel: "sms", fromOneToOneConversation: true, locationId }
 *   SMS Response: HTTP 201 — exact field names not yet confirmed; messageId may be "id" or "messageId"
 *   Failure: HTTP 4xx with GHL error body { message? }
 *
 * Other channels (WHATSAPP, FACEBOOK, etc.) are unverified — will return an explicit error.
 */
  async sendMessage(request: GhlSendMessageRequest): Promise<{ success: boolean; messageId?: string; conversationId?: string; error?: string }> {
    const config = getChannelConfig(request.channel);
    if (!config) {
      const supported = Object.keys(CHANNEL_MAP).filter(k => CHANNEL_MAP[k as OutboundChannel] !== null);
      return { success: false, error: `Channel ${request.channel} is not yet verified. Supported: ${supported.join(', ') || 'none'}` };
    }

    try {
      const body = {
        contactId: request.contactId,
        type: config.type,
        message: request.message,
        attachments: config.attachments,
        channel: config.channel,
        fromOneToOneConversation: config.fromOneToOneConversation,
        locationId: request.locationId,
      };
      const response = await this.client.post<{ id?: string; messageId?: string; conversationId: string; status: string; timestamp: string }>(
        '/conversations/messages',
        body,
      );
      if (process.env['NODE_ENV'] !== 'production') {
        this.logger.debug(
          `[SEND_VERIFY] POST /conversations/messages [${request.channel}] — HTTP ${response.status}, messageId=${response.data?.messageId ?? response.data?.id ?? 'unset'}, conversationId=${response.data?.conversationId}`,
        );
      }
      return {
        success: true,
        messageId: response.data?.messageId ?? response.data?.id,
        conversationId: response.data?.conversationId,
      };
    } catch (error) {
      return this.handleSendError(error);
    }
  }

  private logger = {
    debug: (msg: string) => {
      if (process.env['NODE_ENV'] !== 'production') console.debug(msg);
    },
    warn: (msg: string) => {
      if (process.env['NODE_ENV'] !== 'production') console.warn(msg);
    },
  };

  private extractGhlErrorMessage(error: unknown): string | null {
    if (axios.isAxiosError(error)) {
      const data = error.response?.data;
      if (!data) return null;
      if (typeof data === 'string') return data.slice(0, 300);
      if (typeof data === 'object' && data !== null) {
        const obj = data as Record<string, unknown>;
        const msg = obj['message'] ?? obj['error'] ?? obj['code'];
        if (typeof msg === 'string') return msg.slice(0, 300);
      }
    }
    return null;
  }

  private handleSendError(error: unknown): { success: boolean; error: string } {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const ghlMessage = this.extractGhlErrorMessage(error);
      if (process.env['NODE_ENV'] !== 'production') {
        this.logger.debug(`[SEND_VERIFY] POST /conversations/messages — HTTP ${status ?? 'unknown'}, ghlMessage=${ghlMessage ?? 'none'}`);
      }
      if (status === 401) return { success: false, error: 'Invalid or expired token' };
      if (status === 403) return { success: false, error: 'Insufficient permissions for this location' };
      if (status === 404) return { success: false, error: 'Conversation or location not found' };
      if (status === 429) return { success: false, error: 'Rate limited by GHL API' };
      if (status === 422) {
        // 422 Unprocessable Entity — body validation failed
        // Extract structured field first, then fall back to raw body excerpt
        const ghlBody = this.extractGhlErrorMessage(error);
        const rawBody = error.response?.data;
        let bodyExcerpt = ghlBody;
        if (!bodyExcerpt && rawBody !== undefined) {
          // Fall back to raw response body as string (first 500 chars)
          bodyExcerpt = typeof rawBody === 'string'
            ? rawBody.slice(0, 500)
            : JSON.stringify(rawBody).slice(0, 500);
        }
        const note = bodyExcerpt ?? `HTTP ${status}`;
        return { success: false, error: note };
      }
      return { success: false, error: ghlMessage || error.message || 'Send failed' };
    }
    return { success: false, error: 'Unknown error during send' };
  }

  // ---------------------------------------------------------------------------
  // Contact tagging
  // ---------------------------------------------------------------------------

  /**
   * Add tags to a contact.
   *
   * VERIFIED LIVE — GHL Private Integration:
   *   POST https://services.leadconnectorhq.com/contacts/{contactId}/tags
   *   Body: { "tags": ["tag1", "tag2"] }
   *   Success: HTTP 201 (empty body)
   *   Failure: HTTP 4xx with GHL error body
   */
  async tagContact(request: TagContactRequest): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await this.client.post(`/contacts/${request.contactId}/tags`, {
        tags: request.tags,
      });
      if (process.env['NODE_ENV'] !== 'production') {
        console.debug(
          `[TAG_VERIFY] POST /contacts/${request.contactId}/tags — HTTP ${response.status}, tagCount=${request.tags.length}`,
        );
      }
      return { success: true };
    } catch (error) {
      return this.handleTagError(error, request.contactId);
    }
  }

  private handleTagError(error: unknown, contactId?: string): { success: boolean; error: string } {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const reason = process.env['NODE_ENV'] !== 'production'
        ? `[TAG_VERIFY] POST /contacts/${contactId ?? '?'}/tags — HTTP ${status}`
        : undefined;
      if (status === 401) {
        return { success: false, error: 'Invalid or expired token' };
      }
      if (status === 403) {
        return { success: false, error: 'Insufficient permissions for this location' };
      }
      if (status === 404) {
        return { success: false, error: 'Contact not found' };
      }
      if (status === 429) {
        return { success: false, error: 'Rate limited by GHL API' };
      }
      // Log non-standard errors in dev only — no raw tokens/payloads
      if (process.env['NODE_ENV'] !== 'production' && reason) {
        console.debug(`${reason}, error=${error.message || 'unknown'}`);
      }
      return { success: false, error: error.message || 'Tag operation failed' };
    }
    return { success: false, error: 'Unknown error during tag operation' };
  }

  // ---------------------------------------------------------------------------
  // Booking / Calendar
  // ---------------------------------------------------------------------------

  /**
   * Book an appointment slot on a GHL calendar.
   *
   * CONFIRMED LIVE — GHL Private Integration:
   *   POST https://services.leadconnectorhq.com/calendars/events/appointments
   *   Body: { locationId, calendarId, contactId, startTime, endTime, title?, timezone?, appointmentStatus? }
   *   Success: HTTP 201 with appointment JSON { id, ... }
   *   Failure: HTTP 4xx with GHL error body { message: "..." }
   */
  async bookSlot(request: BookSlotRequest): Promise<{ success: boolean; appointmentId?: string; error?: string }> {
    try {
      const response = await this.client.post('/calendars/events/appointments', {
        locationId: request.locationId,
        calendarId: request.calendarId,
        contactId: request.contactId,
        startTime: request.startTime,
        endTime: request.endTime,
        title: request.title,
        timezone: request.timezone,
        appointmentStatus: request.appointmentStatus,
      });
      if (process.env['NODE_ENV'] !== 'production') {
        console.debug(
          `[BOOK_VERIFY] POST /calendars/events/appointments — HTTP ${response.status}, appointmentId=${response.data?.id ?? 'unknown'}`,
        );
      }
      return { success: true, appointmentId: response.data?.id };
    } catch (error) {
      return this.handleBookingError(error);
    }
  }

  private handleBookingError(error: unknown): { success: boolean; error: string } {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      if (process.env['NODE_ENV'] !== 'production') {
        console.debug(`[BOOK_VERIFY] POST /calendars/events/appointments — HTTP ${status ?? 'unknown'}`);
      }
      // Try to extract structured GHL error from response body
      const ghlMessage = this.extractGhlErrorMessage(error);
      if (status === 401) return { success: false, error: 'Invalid or expired token' };
      if (status === 403) return { success: false, error: 'Insufficient permissions for this location' };
      if (status === 404) return { success: false, error: 'Contact, calendar, or location not found' };
      if (status === 429) return { success: false, error: 'Rate limited by GHL API' };
      return { success: false, error: ghlMessage || error.message || 'Booking failed' };
    }
    return { success: false, error: 'Unknown error during booking' };
  }

  /**
   * Normalize error for safe handling
   */
  private handleError(error: unknown): { valid: boolean; error: string } {
    if (axios.isAxiosError(error)) {
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
    baseUrl: resolveGhlApiBaseUrl(process.env['GHL_API_BASE_URL']),
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




