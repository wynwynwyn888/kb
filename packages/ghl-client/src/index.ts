// GHL API client placeholder
// TODO: Full implementation when GHL API integration is built

import axios, { AxiosInstance } from 'axios';

export interface GhlClientConfig {
  baseUrl: string;
  accessToken: string;
  locationId: string;
}

export interface GhlConversation {
  id: string;
  contactId: string;
  status: string;
  lastMessageTime: string;
}

export interface GhlContact {
  id: string;
  name: string;
  phone: string;
  email?: string;
  tags: string[];
}

export interface GhlMessage {
  id: string;
  conversationId: string;
  content: string;
  direction: 'inbound' | 'outbound';
  timestamp: string;
  attachments?: GhlAttachment[];
}

export interface GhlAttachment {
  id: string;
  type: string;
  url: string;
}

// GhlClient class - placeholder for future GHL API implementation
export class GhlClient {
  private client: AxiosInstance;
  private locationId: string;

  constructor(config: GhlClientConfig) {
    this.locationId = config.locationId;
    this.client = axios.create({
      baseURL: config.baseUrl,
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        'Content-Type': 'application/json',
      },
    });
  }

  // TODO: Implement actual GHL API methods
  async getConversation(conversationId: string): Promise<GhlConversation | null> {
    // PLACEHOLDER - needs actual GHL API implementation
    throw new Error('GHL client not yet implemented');
  }

  async getContact(contactId: string): Promise<GhlContact | null> {
    // PLACEHOLDER - needs actual GHL API implementation
    throw new Error('GHL client not yet implemented');
  }

  async sendMessage(conversationId: string, content: string): Promise<GhlMessage | null> {
    // PLACEHOLDER - needs actual GHL API implementation
    throw new Error('GHL client not yet implemented');
  }

  async addTags(contactId: string, tags: string[]): Promise<void> {
    // PLACEHOLDER - needs actual GHL API implementation
    throw new Error('GHL client not yet implemented');
  }

  async removeTags(contactId: string, tags: string[]): Promise<void> {
    // PLACEHOLDER - needs actual GHL API implementation
    throw new Error('GHL client not yet implemented');
  }

  async getCalendarEvents(startDate: string, endDate: string): Promise<unknown[]> {
    // PLACEHOLDER - needs actual GHL API implementation
    throw new Error('GHL client not yet implemented');
  }

  async createCalendarEvent(event: {
    title: string;
    startTime: string;
    endTime: string;
    contactId?: string;
    description?: string;
  }): Promise<unknown> {
    // PLACEHOLDER - needs actual GHL API implementation
    throw new Error('GHL client not yet implemented');
  }

  // Webhook verification placeholder
  static verifyWebhook(payload: unknown, signature: string): boolean {
    // TODO: Implement webhook signature verification
    return true;
  }
}

// Factory function to create client from connection data
export async function createGhlClient(
  accessToken: string,
  locationId: string
): Promise<GhlClient> {
  return new GhlClient({
    baseUrl: process.env.GHL_API_BASE_URL || 'https://api.gohighlevel.com',
    accessToken,
    locationId,
  });
}