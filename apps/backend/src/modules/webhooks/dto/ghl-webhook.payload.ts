// GHL webhook payload types

export interface GhlInboundMessageData {
  conversationId: string;
  contactId: string;
  message: string;
  messageType: string;
  id?: string;
  contactName?: string;
  phoneNumber?: string;
  channel?: string;
}

export interface GhlWebhookPayload {
  locationId: string;
  event: string;
  data: GhlInboundMessageData;
  timestamp: string;
  version?: string;
}

export interface NormalizedWebhookPayload {
  ghlLocationId: string;
  ghlConversationId: string;
  ghlContactId: string;
  messageContent: string;
  messageType: 'text' | 'image' | 'audio' | 'video' | 'unknown';
  timestamp: string;
  externalEventId: string;
  eventType: string;
  dedupeKey: string;
  channelRaw: string | null;
}
