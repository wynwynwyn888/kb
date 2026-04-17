// Core entity types for multi-tenant SaaS platform

export interface BaseEntity {
  id: string; // UUID
  createdAt: Date;
  updatedAt: Date;
}

// Tenancy
export interface Agency extends BaseEntity {
  name: string;
  ownerUserId: string;
  settings: AgencySettings;
}

export interface AgencySettings {
  defaultOutputFormat: 'bubble' | 'plain' | 'markdown';
  allowTenantModelOverride: boolean;
  quotaWarningThreshold: number; // percentage
}

export interface AgencyUser extends BaseEntity {
  agencyId: string;
  userId: string;
  role: AgencyUserRole;
}

export type AgencyUserRole = 'owner' | 'admin' | 'member';

export interface Tenant extends BaseEntity {
  agencyId: string;
  name: string;
  ghlLocationId: string;
  status: TenantStatus;
  settings: TenantSettings;
}

export type TenantStatus = 'active' | 'suspended' | 'pending';

export interface TenantSettings {
  timezone: string;
  language: string;
  autoTransferOnHandover: boolean;
}

export interface TenantUser extends BaseEntity {
  tenantId: string;
  userId: string;
  role: TenantUserRole;
}

export type TenantUserRole = 'admin' | 'agent' | 'viewer';

// GHL Integration
export interface GhlConnection {
  id: string;
  tenantId: string;
  ghlLocationId: string;
  accessToken: string; // encrypted
  refreshToken: string; // encrypted
  expiresAt: Date;
  status: ConnectionStatus;
}

export type ConnectionStatus = 'active' | 'expired' | 'revoked';

// AI/Model
export interface AgencyModelProvider {
  id: string;
  agencyId: string;
  provider: AiProvider;
  apiKey: string; // encrypted
  endpoint?: string;
  settings: ProviderSettings;
}

export type AiProvider = 'openai' | 'anthropic' | 'google' | 'azure' | 'custom';

export interface ProviderSettings {
  defaultModel: string;
  maxTokens?: number;
  temperature?: number;
  embeddingModel?: string;
}

export interface AgencySystemPolicy {
  id: string;
  agencyId: string;
  name: string;
  content: string; // system prompt template
  priority: number;
  isDefault: boolean;
}

export interface TenantPromptConfig {
  id: string;
  tenantId: string;
  name: string;
  systemPrompt: string;
  temperature: number;
  modelOverride?: string;
  maxTokens?: number;
  promptVariables: Record<string, string>;
}

export interface TenantModelOverride {
  id: string;
  tenantId: string;
  provider: AiProvider;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

// Knowledge Base
export interface KnowledgeDocument extends BaseEntity {
  tenantId: string;
  title: string;
  source: string;
  mimeType: string;
  size: number;
  status: DocumentStatus;
  metadata: Record<string, string>;
}

export type DocumentStatus = 'pending' | 'processing' | 'ready' | 'failed';

export interface KnowledgeChunk extends BaseEntity {
  documentId: string;
  content: string;
  embedding: number[]; // pgvector
  tokenCount: number;
  metadata: ChunkMetadata;
}

export interface ChunkMetadata {
  page?: number;
  section?: string;
  summary?: string;
}

// Conversations
export interface Conversation extends BaseEntity {
  tenantId: string;
  ghlConversationId: string;
  contactId: string;
  channel: ConversationChannel;
  status: ConversationStatus;
  lastMessageAt: Date;
  metadata: ConversationMetadata;
}

export type ConversationChannel = 'whatsapp' | 'sms' | 'chat' | 'email';
export type ConversationStatus = 'active' | 'handover' | 'closed' | 'pending';

export interface ConversationMetadata {
  ghlContactName?: string;
  ghlContactPhone?: string;
  sessionStartedAt?: Date;
  lastAiResponseAt?: Date;
}

export interface Message extends BaseEntity {
  conversationId: string;
  direction: MessageDirection;
  sender: MessageSender;
  content: string;
  contentType: ContentType;
  metadata: MessageMetadata;
}

export type MessageDirection = 'inbound' | 'outbound';
export type MessageSender = 'contact' | 'ai' | 'agent' | 'system';
export type ContentType = 'text' | 'image' | 'video' | 'document' | 'audio';

export interface MessageMetadata {
  ghlMessageId?: string;
  ghlAttachmentUrl?: string;
  bubbleIndex?: number;
  formattedContent?: string;
  rawAiResponse?: string;
  tokensUsed?: number;
}

// Handover
export interface HandoverEvent extends BaseEntity {
  conversationId: string;
  type: HandoverType;
  status: HandoverStatus;
  initiatedBy: 'contact' | 'ai' | 'agent';
  note?: string;
  resumedAt?: Date;
}

export type HandoverType = 'request' | 'transfer';
export type HandoverStatus = 'active' | 'resumed' | 'timeout';

// Quota
export interface QuotaWallet extends BaseEntity {
  tenantId: string;
  totalQuota: number;
  usedQuota: number;
  periodStart: Date;
  periodEnd: Date;
}

export interface QuotaLedger extends BaseEntity {
  walletId: string;
  amount: number;
  type: QuotaTransactionType;
  description: string;
  conversationId?: string;
}

export type QuotaTransactionType = 'credit' | 'debit';

// Actions
export interface ActionLog extends BaseEntity {
  tenantId: string;
  conversationId?: string;
  actionType: ActionType;
  status: ActionStatus;
  details: Record<string, unknown>;
  error?: string;
}

export type ActionType = 'tag_contact' | 'update_calendar' | 'send_reply' | 'kb_retrieve' | 'ai_generate';
export type ActionStatus = 'pending' | 'success' | 'failed';

// Audit
export interface AuditLog extends BaseEntity {
  agencyId: string;
  userId: string;
  tenantId?: string;
  action: string;
  resource: string;
  resourceId?: string;
  changes: Record<string, { before?: unknown; after?: unknown }>;
  ipAddress?: string;
}

// Notifications
export interface Notification extends BaseEntity {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  read: boolean;
  data?: Record<string, unknown>;
}

export type NotificationType = 'handover' | 'quota_warning' | 'kb_ingest_complete' | 'error';