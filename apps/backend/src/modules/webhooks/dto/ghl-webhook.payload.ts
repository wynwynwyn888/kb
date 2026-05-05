// GHL webhook payload types

export interface GhlInboundMessageData {
  conversationId: string;
  contactId: string;
  message: string;
  messageType: string;
  id?: string;
  contactName?: string;
  phoneNumber?: string;
  email?: string;
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
  /** HTTP(S) URL for inbound voice/audio media when GHL sends attachments instead of plain text. */
  audioMediaUrl?: string | null;
  /** When true, the inbound worker should transcribe before persisting text for orchestration. */
  voiceInboundNeedsTranscribe?: boolean;
  /** When true, contact display/phone used snake_case or alternate GHL webhook keys (not only contactName/phoneNumber). */
  contactFieldsFromExtendedWebhook?: boolean | null;
  contactDisplayName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
}
