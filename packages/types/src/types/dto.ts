// DTOs for API requests/responses

import type {
  AiProvider,
  ConversationChannel,
  TenantStatus,
  HandoverType,
  MessageDirection,
  MessageSender,
  ContentType,
  NotificationType,
  TenantUserRole,
  AgencyUserRole,
} from './entities.js';

// Auth
export interface LoginDto {
  email: string;
  password: string;
}

export interface RegisterDto {
  email: string;
  password: string;
  agencyName: string;
}

export interface AuthResponse {
  user: UserDto;
  accessToken: string;
  refreshToken: string;
}

export interface UserDto {
  id: string;
  email: string;
  name?: string;
}

// Agency
export interface CreateAgencyDto {
  name: string;
}

export interface UpdateAgencyDto {
  name?: string;
  settings?: {
    defaultOutputFormat?: 'bubble' | 'plain' | 'markdown';
    allowTenantModelOverride?: boolean;
    quotaWarningThreshold?: number;
  };
}

// Tenant
export interface CreateTenantDto {
  name: string;
  ghlLocationId: string;
  timezone?: string;
  language?: string;
}

export interface UpdateTenantDto {
  name?: string;
  status?: TenantStatus;
  settings?: {
    timezone?: string;
    language?: string;
    autoTransferOnHandover?: boolean;
  };
}

// Conversation
export interface CreateConversationDto {
  ghlConversationId: string;
  contactId: string;
  channel: ConversationChannel;
  contactName?: string;
  contactPhone?: string;
}

export interface SendMessageDto {
  content: string;
  contentType?: ContentType;
}

export interface ProcessInboundMessageDto {
  ghlLocationId: string;
  ghlConversationId: string;
  ghlContactId: string;
  messageContent: string;
  messageType: 'text' | 'image' | 'audio' | 'video';
  timestamp: string;
}

// Message
export interface CreateMessageDto {
  conversationId: string;
  direction: MessageDirection;
  sender: MessageSender;
  content: string;
  contentType?: ContentType;
  metadata?: Record<string, unknown>;
}

// Prompt
export interface CreatePromptConfigDto {
  name: string;
  systemPrompt: string;
  temperature?: number;
  modelOverride?: string;
  maxTokens?: number;
  promptVariables?: Record<string, string>;
}

export interface UpdatePromptConfigDto {
  name?: string;
  systemPrompt?: string;
  temperature?: number;
  modelOverride?: string;
  maxTokens?: number;
  promptVariables?: Record<string, string>;
}

// Knowledge Base
export interface UploadDocumentDto {
  title: string;
  source: string;
  mimeType: string;
  content: string; // base64 or raw
}

export interface SearchKnowledgeDto {
  query: string;
  topK?: number;
  filter?: Record<string, string>;
}

// AI Router
export interface RouteRequestDto {
  tenantId: string;
  conversationId: string;
  prompt: string;
  context?: {
    recentMessages?: MessageDto[];
    kbResults?: KnowledgeResultDto[];
    systemPrompt?: string;
  };
}

export interface MessageDto {
  id: string;
  content: string;
  sender: MessageSender;
  createdAt: Date;
}

export interface KnowledgeResultDto {
  content: string;
  score: number;
  sourceDocId: string;
}

export interface RouteResponseDto {
  model: string;
  provider: AiProvider;
  response: string;
  usage?: {
    tokens: number;
    promptTokens: number;
    completionTokens: number;
  };
}

// Formatter
export interface FormatRequestDto {
  content: string;
  format: 'bubble' | 'plain' | 'markdown';
  maxBubbleLength?: number;
}

export interface FormatResponseDto {
  formatted: string;
  bubbles: BubbleDto[];
}

export interface BubbleDto {
  content: string;
  index: number;
}

// Handover
export interface InitiateHandoverDto {
  conversationId: string;
  type: HandoverType;
  note?: string;
}

export interface ResumeHandoverDto {
  conversationId: string;
}

// Quota
export interface CheckQuotaDto {
  tenantId: string;
  amount: number;
}

export interface DeductQuotaDto {
  tenantId: string;
  amount: number;
  conversationId?: string;
  description: string;
}

export interface QuotaStatusDto {
  wallet: {
    totalQuota: number;
    usedQuota: number;
    remainingQuota: number;
    periodEnd: Date;
  };
  dailyUsage: number;
  monthlyUsage: number;
}

// Calendar
export interface CalendarEventDto {
  title: string;
  startTime: Date;
  endTime: Date;
  contactId?: string;
  description?: string;
}

// Contact
export interface TagContactDto {
  tenantId: string;
  ghlContactId: string;
  tags: string[];
}

export interface UpdateContactDto {
  tenantId: string;
  ghlContactId: string;
  data: Record<string, unknown>;
}

// GHL Connection
export interface ConnectGhlDto {
  tenantId: string;
  authorizationCode: string;
}

export interface GhlWebhookPayload {
  locationId: string;
  event: string;
  data: Record<string, unknown>;
  timestamp: string;
}

// Pagination
export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// Filter/Sort
export interface QueryOptions {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  filters?: Record<string, unknown>;
}