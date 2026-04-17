// Shared enums - re-exported for convenience

export enum TenantStatus {
  Active = 'active',
  Suspended = 'suspended',
  Pending = 'pending',
}

export enum ConnectionStatus {
  Active = 'active',
  Expired = 'expired',
  Revoked = 'revoked',
}

export enum ConversationStatus {
  Active = 'active',
  Handover = 'handover',
  Closed = 'closed',
  Pending = 'pending',
}

export enum ConversationChannel {
  WhatsApp = 'whatsapp',
  SMS = 'sms',
  Chat = 'chat',
  Email = 'email',
}

export enum MessageDirection {
  Inbound = 'inbound',
  Outbound = 'outbound',
}

export enum MessageSender {
  Contact = 'contact',
  Ai = 'ai',
  Agent = 'agent',
  System = 'system',
}

export enum ContentType {
  Text = 'text',
  Image = 'image',
  Video = 'video',
  Document = 'document',
  Audio = 'audio',
}

export enum DocumentStatus {
  Pending = 'pending',
  Processing = 'processing',
  Ready = 'ready',
  Failed = 'failed',
}

export enum HandoverType {
  Request = 'request',
  Transfer = 'transfer',
}

export enum HandoverStatus {
  Active = 'active',
  Resumed = 'resumed',
  Timeout = 'timeout',
}

export enum QuotaTransactionType {
  Credit = 'credit',
  Debit = 'debit',
}

export enum ActionType {
  TagContact = 'tag_contact',
  UpdateCalendar = 'update_calendar',
  SendReply = 'send_reply',
  KbRetrieve = 'kb_retrieve',
  AiGenerate = 'ai_generate',
}

export enum ActionStatus {
  Pending = 'pending',
  Success = 'success',
  Failed = 'failed',
}

export enum AgencyUserRole {
  Owner = 'owner',
  Admin = 'admin',
  Member = 'member',
}

export enum TenantUserRole {
  Admin = 'admin',
  Agent = 'agent',
  Viewer = 'viewer',
}

export enum AiProvider {
  OpenAI = 'openai',
  Anthropic = 'anthropic',
  Google = 'google',
  Azure = 'azure',
  Custom = 'custom',
}

export enum NotificationType {
  Handover = 'handover',
  QuotaWarning = 'quota_warning',
  KbIngestComplete = 'kb_ingest_complete',
  Error = 'error',
}