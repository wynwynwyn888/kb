export interface MockFlag {
  key: string;
  value: string;
  enabled: boolean;
  note?: string;
}

export interface MockOutboundSend {
  id: string;
  status: string;
  tenantId: string;
  conversationId: string;
  replyId: string;
  bubbleSequence: number;
  providerMessageId: string | null;
  attempt: number;
  lastError: string | null;
  sentAt: string | null;
  createdAt: string;
}

export interface MockGhlSync {
  lastSync: string;
  fetched: number;
  inserted: number;
  deduped: number;
  appSkipped: number;
  latencyMs: number;
  lastError: string | null;
  note: string;
}

export interface MockConversationHealth {
  conversationId: string;
  contactId: string;
  lastInbound: string | null;
  lastAiReply: string | null;
  lastManualMessage: string | null;
  staleSkipped: number;
  duplicateSkipped: number;
  status: string;
}

export interface MockTenantReadiness {
  tenantId: string;
  name: string;
  ghlConnection: string;
  locationId: string | null;
  lastSuccessfulSend: string | null;
  lastFailedSend: string | null;
  badContactIdCount: number;
  syncEnabled: boolean;
  status: string;
}

export interface MockErrorEvent {
  id: string;
  severity: string;
  source: string;
  eventType: string;
  tenantId: string | null;
  conversationId: string | null;
  message: string;
  createdAt: string;
}

export interface MockAuditEvent {
  id: string;
  eventType: string;
  eventSource: string;
  severity: string;
  tenantId: string | null;
  conversationId: string | null;
  createdAt: string;
}

export interface MockQueueStats {
  queue: string;
  waiting: number;
  active: number;
  failed: number;
  delayed: number;
  retryCount: number;
}

const now = () => new Date().toISOString();
const minsAgo = (m: number) => new Date(Date.now() - m * 60 * 1000).toISOString();
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600 * 1000).toISOString();

export function getMockFlags(): MockFlag[] {
  return [
    { key: 'AISBP_OUTBOUND_IDEMPOTENCY_ENABLED', value: 'true', enabled: true },
    { key: 'AISBP_STALE_SEND_CHECK_ENABLED', value: 'true', enabled: true },
    { key: 'AISBP_CONV_ORDERING_ENABLED', value: 'true', enabled: true },
    { key: 'AISBP_TENANT_CAPS_ENABLED', value: 'true', enabled: true },
    { key: 'GHL_PRE_REPLY_CONTEXT_SYNC', value: 'true', enabled: true, note: 'tenant-limited' },
    { key: 'AISBP_OUTBOUND_THROUGH_KB_ENABLED', value: 'false', enabled: false },
    { key: 'AISBP_TENANT_CAP_SEND', value: '5', enabled: true },
    { key: 'AISBP_INBOUND_DEBOUNCE_MS', value: '2000', enabled: true },
    { key: 'GHL_PRE_REPLY_CONTEXT_SYNC_TENANTS', value: '34c62859-...', enabled: true },
  ];
}

export function getMockOutboundSends(): MockOutboundSend[] {
  return [
    { id: 'os-1', status: 'sent', tenantId: '34c62859', conversationId: 'b6bac998', replyId: 'rpl-abc', bubbleSequence: 0, providerMessageId: 'ghl_msg_881', attempt: 1, lastError: null, sentAt: minsAgo(15), createdAt: minsAgo(16) },
    { id: 'os-2', status: 'sent', tenantId: '34c62859', conversationId: 'b6bac998', replyId: 'rpl-abc', bubbleSequence: 1, providerMessageId: 'ghl_msg_882', attempt: 1, lastError: null, sentAt: minsAgo(15), createdAt: minsAgo(16) },
    { id: 'os-3', status: 'failed_provider_rejected', tenantId: '34c62859', conversationId: 'c6d0250f', replyId: 'rpl-def', bubbleSequence: 0, providerMessageId: null, attempt: 3, lastError: 'GHL 400: Contact not found', sentAt: null, createdAt: hoursAgo(2) },
    { id: 'os-4', status: 'sent', tenantId: '34c62859', conversationId: 'b6bac998', replyId: 'rpl-ghi', bubbleSequence: 0, providerMessageId: 'ghl_msg_890', attempt: 1, lastError: null, sentAt: hoursAgo(3), createdAt: hoursAgo(3) },
    { id: 'os-5', status: 'duplicate_skipped', tenantId: '34c62859', conversationId: 'b6bac998', replyId: 'rpl-jkl', bubbleSequence: 0, providerMessageId: null, attempt: 1, lastError: null, sentAt: null, createdAt: hoursAgo(5) },
    { id: 'os-6', status: 'stale_cancelled', tenantId: '34c62859', conversationId: 'b6bac998', replyId: 'rpl-mno', bubbleSequence: 0, providerMessageId: null, attempt: 1, lastError: null, sentAt: null, createdAt: hoursAgo(1) },
    { id: 'os-7', status: 'failed_provider_rejected', tenantId: '34c62859', conversationId: 'b6bac998', replyId: 'rpl-pqr', bubbleSequence: 0, providerMessageId: null, attempt: 2, lastError: 'GHL 429: Rate limited', sentAt: null, createdAt: minsAgo(30) },
  ];
}

export function getMockGhlSync(): MockGhlSync[] {
  return [
    {
      lastSync: minsAgo(10),
      fetched: 20,
      inserted: 8,
      deduped: 12,
      appSkipped: 0,
      latencyMs: 312,
      lastError: null,
      note: 'Includes manual "pineapple 4821" imported as SYSTEM OUTBOUND',
    },
    {
      lastSync: minsAgo(45),
      fetched: 15,
      inserted: 2,
      deduped: 10,
      appSkipped: 3,
      latencyMs: 287,
      lastError: null,
      note: 'Includes manual "mango 7392" imported as SYSTEM OUTBOUND — AI correctly referenced it',
    },
  ];
}

export function getMockConversationHealth(): MockConversationHealth[] {
  return [
    { conversationId: 'b6bac998', contactId: 'kfmh8xHdo4KFVLO43BWI (+6588658634)', lastInbound: minsAgo(15), lastAiReply: minsAgo(14), lastManualMessage: minsAgo(10), staleSkipped: 1, duplicateSkipped: 1, status: 'OK' },
    { conversationId: 'c6d0250f', contactId: '+6588658634 (resolved→kfmh8...)', lastInbound: hoursAgo(2), lastAiReply: hoursAgo(2), lastManualMessage: null, staleSkipped: 0, duplicateSkipped: 0, status: 'OK (fallback)' },
    { conversationId: '07fd8cdd', contactId: '+60123456789', lastInbound: hoursAgo(48), lastAiReply: null, lastManualMessage: null, staleSkipped: 0, duplicateSkipped: 0, status: 'Needs backfill' },
    { conversationId: 'b6bac998', contactId: 'kfmh8xHdo4KFVLO43BWI', lastInbound: minsAgo(45), lastAiReply: minsAgo(44), lastManualMessage: minsAgo(10), staleSkipped: 0, duplicateSkipped: 2, status: 'OK' },
  ];
}

export function getMockTenantReadiness(): MockTenantReadiness[] {
  return [
    { tenantId: '34c62859-95b1-49a8-911c-cc44ced05452', name: 'AISBP Agency', ghlConnection: 'CONNECTED', locationId: 'oI3MIP3nZkj4rSKEwJDo', lastSuccessfulSend: minsAgo(15), lastFailedSend: hoursAgo(2), badContactIdCount: 2, syncEnabled: true, status: 'Ready' },
  ];
}

export function getMockErrorEvents(): MockErrorEvent[] {
  return [
    { id: 'err-1', severity: 'error', source: 'outbound-send', eventType: 'outbound_send_failed', tenantId: '34c62859', conversationId: 'c6d0250f', message: 'GHL 400: Contact with id +6588658634 not found', createdAt: hoursAgo(2) },
    { id: 'err-2', severity: 'error', source: 'outbound-send', eventType: 'outbound_send_failed', tenantId: '34c62859', conversationId: 'b6bac998', message: 'GHL 429: Rate limited', createdAt: minsAgo(30) },
    { id: 'err-3', severity: 'warn', source: 'outbound-send', eventType: 'ghl_api_rate_limited', tenantId: '34c62859', conversationId: null, message: 'GHL 429 at location oI3MIP3...', createdAt: minsAgo(30) },
    { id: 'err-4', severity: 'warn', source: 'send-bubble', eventType: 'stale_send_cancelled', tenantId: '34c62859', conversationId: 'b6bac998', message: 'Newer inbound detected, re-queued orchestration', createdAt: minsAgo(45) },
  ];
}

export function getMockAuditEvents(): MockAuditEvent[] {
  const t = minsAgo(2);
  return [
    { id: 'ae-1', eventType: 'outbound_send_sent', eventSource: 'outbound-send', severity: 'info', tenantId: '34c62859', conversationId: 'b6bac998', createdAt: minsAgo(15) },
    { id: 'ae-2', eventType: 'duplicate_send_prevented', eventSource: 'outbound-send', severity: 'info', tenantId: '34c62859', conversationId: 'b6bac998', createdAt: hoursAgo(5) },
    { id: 'ae-3', eventType: 'ghl_sync_completed', eventSource: 'inbound-processor', severity: 'info', tenantId: '34c62859', conversationId: 'b6bac998', createdAt: minsAgo(10) },
    { id: 'ae-4', eventType: 'contact_id_phone_fallback_resolved', eventSource: 'outbound-send', severity: 'info', tenantId: '34c62859', conversationId: 'c6d0250f', createdAt: hoursAgo(2) },
    { id: 'ae-5', eventType: 'ghl_message_imported', eventSource: 'ghl-conversation-sync', severity: 'info', tenantId: '34c62859', conversationId: 'b6bac998', createdAt: minsAgo(10) },
    { id: 'ae-6', eventType: 'tenant_cap_acquired', eventSource: 'send-bubble', severity: 'info', tenantId: '34c62859', conversationId: 'b6bac998', createdAt: minsAgo(15) },
    { id: 'ae-7', eventType: 'conv_ordering_blocked', eventSource: 'send-bubble', severity: 'warn', tenantId: '34c62859', conversationId: 'b6bac998', createdAt: minsAgo(16) },
    { id: 'ae-8', eventType: 'tenant_cap_released', eventSource: 'send-bubble', severity: 'info', tenantId: '34c62859', conversationId: 'b6bac998', createdAt: minsAgo(15) },
  ];
}

export function getMockQueueStats(): MockQueueStats[] {
  return [
    { queue: 'inbound-message-processor', waiting: 0, active: 1, failed: 0, delayed: 2, retryCount: 0 },
    { queue: 'send-bubble', waiting: 1, active: 2, failed: 1, delayed: 0, retryCount: 8 },
    { queue: 'media-transcription', waiting: 0, active: 0, failed: 0, delayed: 0, retryCount: 0 },
    { queue: 'kb-ingest', waiting: 0, active: 0, failed: 0, delayed: 1, retryCount: 0 },
    { queue: 'follow-up', waiting: 5, active: 0, failed: 0, delayed: 3, retryCount: 0 },
  ];
}
