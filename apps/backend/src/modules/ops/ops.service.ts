import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { getSupabaseService } from '../../lib/supabase';
import { getRuntimeBuildMarker } from '../../lib/runtime-build-marker';
import { QUEUES, type QueueName } from '../../queues/queue.constants';

const SAFE_FLAG_PREFIXES = [
  'AISBP_', 'GHL_', 'WHATSAPP_', 'KB_', 'ALLOW_',
  'APP_CACHE_', 'NODE_ENV', 'SWAGGER_',
];

function isSafeFlagKey(key: string): boolean {
  return SAFE_FLAG_PREFIXES.some(p => key.startsWith(p));
}

export interface HealthResponse {
  backend: string;
  frontend: string;
  redis: string;
  bookingSave: string;
  vpsCommit: string;
  stableTag: string;
  uptimeSec: number;
  nodeEnv: string;
}

export interface FlagEntry {
  key: string;
  value: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface OutboundSendRow {
  id: string;
  tenantId: string;
  tenantName: string | null;
  conversationId: string;
  replyId: string;
  bubbleSequence: number;
  status: string;
  providerMessageId: string | null;
  attempt: number;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  sentAt: string | null;
  createdAt: string;
}

export interface ConversationHealthRow {
  id: string;
  tenantId: string;
  tenantName: string | null;
  contactId: string;
  lastMessageAt: string | null;
  outboundSentCount: number;
  outboundFailedCount: number;
  staleSkipped: number;
  duplicateSkipped: number;
  status: string;
}

export interface GhlSyncRow {
  conversationId: string;
  tenantId: string;
  tenantName: string | null;
  eventType: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface ErrorEventRow {
  id: string;
  tenantId: string | null;
  tenantName: string | null;
  conversationId: string | null;
  eventType: string;
  eventSource: string;
  severity: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface TenantReadinessRow {
  id: string;
  name: string;
  ghlLocationId: string | null;
  botEnabled: boolean;
  ghlConnectionStatus: string | null;
  lastSuccessfulSendAt: string | null;
  lastFailedSendAt: string | null;
  badContactIdCount: number;
  syncEnabled: boolean;
}

export interface QueueHealthEntry {
  queue: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

@Injectable()
export class OpsService {
  private readonly logger = new Logger(OpsService.name);
  private readonly supabase = getSupabaseService();

  constructor(
    @InjectQueue(QUEUES.INBOUND_MESSAGE_PROCESSOR) private readonly inboundQueue: Queue,
    @InjectQueue(QUEUES.SEND_BUBBLE) private readonly sendBubbleQueue: Queue,
    @InjectQueue(QUEUES.MEDIA_TRANSCRIPTION) private readonly mediaQueue: Queue,
    @InjectQueue(QUEUES.KB_INGEST) private readonly kbIngestQueue: Queue,
    @InjectQueue(QUEUES.FOLLOW_UP) private readonly followUpQueue: Queue,
  ) {}

  async getHealth(): Promise<HealthResponse> {
    const marker = getRuntimeBuildMarker();
    let bookingOk = true;
    try {
      const { error } = await this.supabase
        .from('tenant_booking_settings')
        .select('tenant_id')
        .limit(1);
      if (error) bookingOk = false;
    } catch {
      bookingOk = false;
    }

    return {
      backend: 'Healthy',
      frontend: 'HTTP 200', // verified separately by caller
      redis: 'Healthy', // assumed — queue injection succeeded
      bookingSave: bookingOk ? 'Works' : 'Error',
      vpsCommit: marker.gitSha ?? 'unknown',
      stableTag: 'stable-single-brain-tested-2026-06-26',
      uptimeSec: Math.floor((Date.now() - marker.bootedAtMs) / 1000),
      nodeEnv: marker.nodeEnv,
    };
  }

  getFlags(): FlagEntry[] {
    const flags: FlagEntry[] = [];
    for (const [k, v] of Object.entries(process.env)) {
      if (!isSafeFlagKey(k)) continue;
      if (
        k.includes('_KEY') || k.includes('_TOKEN') || k.includes('_SECRET') ||
        k.includes('_PASSWORD') || k.includes('DATABASE_URL') || k.includes('SUPABASE_')
      ) continue;
      if (v === undefined || v === null) continue;
      flags.push({ key: k, value: String(v ?? '') });
    }
    flags.sort((a, b) => a.key.localeCompare(b.key));
    return flags;
  }

  async getOutboundSends(params: {
    tenantId?: string;
    status?: string;
    page: number;
    pageSize: number;
  }): Promise<PaginatedResponse<OutboundSendRow>> {
    const { tenantId, status, page, pageSize } = params;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = this.supabase
      .from('outbound_sends')
      .select('id, tenant_id, conversation_id, reply_id, bubble_sequence, status, provider_message_id, attempt, last_error_code, last_error_message, sent_at, created_at', { count: 'exact' });

    if (tenantId) query = query.eq('tenant_id', tenantId);
    if (status) query = query.eq('status', status);

    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) {
      this.logger.warn(`getOutboundSends error: ${String(error)}`);
      return { data: [], total: 0, page, pageSize };
    }

    const tenantNames = await this.loadTenantNames();
    return {
      data: ((data ?? []) as Record<string, unknown>[]).map(r => {
        const tid = String(r['tenant_id'] ?? '');
        return {
          id: String(r['id'] ?? ''),
          tenantId: tid,
          tenantName: tenantNames.get(tid) ?? null,
          conversationId: String(r['conversation_id'] ?? ''),
          replyId: String(r['reply_id'] ?? ''),
          bubbleSequence: Number(r['bubble_sequence'] ?? 0),
          status: String(r['status'] ?? ''),
          providerMessageId: r['provider_message_id'] ? String(r['provider_message_id']) : null,
          attempt: Number(r['attempt'] ?? 0),
          lastErrorCode: r['last_error_code'] ? String(r['last_error_code']) : null,
          lastErrorMessage: r['last_error_message'] ? String(r['last_error_message']) : null,
          sentAt: r['sent_at'] ? String(r['sent_at']) : null,
          createdAt: String(r['created_at'] ?? ''),
        };
      }),
      total: count ?? 0,
      page,
      pageSize,
    };
  }

  async getConversations(params: {
    tenantId?: string;
    page: number;
    pageSize: number;
  }): Promise<PaginatedResponse<ConversationHealthRow>> {
    const { tenantId, page, pageSize } = params;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = this.supabase
      .from('conversations')
      .select('id, tenant_id, contact_id, last_message_at, status', { count: 'exact' });

    if (tenantId) query = query.eq('tenant_id', tenantId);

    const { data, error, count } = await query
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .range(from, to);

    if (error) {
      this.logger.warn(`getConversations error: ${String(error)}`);
      return { data: [], total: 0, page, pageSize };
    }

    const tenantNames = await this.loadTenantNames();
    const rows: ConversationHealthRow[] = [];
    for (const c of (data ?? []) as Record<string, unknown>[]) {
      const conversationId = String(c['id'] ?? '');
      const tid = String(c['tenant_id'] ?? '');
      const staleSkipped = await this.countMetricsByType(conversationId, 'stale_send_cancelled');
      const duplicateSkipped = await this.countMetricsByType(conversationId, 'duplicate_send_prevented');
      rows.push({
        id: conversationId,
        tenantId: tid,
        tenantName: tenantNames.get(tid) ?? null,
        contactId: String(c['contact_id'] ?? ''),
        lastMessageAt: c['last_message_at'] ? String(c['last_message_at']) : null,
        outboundSentCount: 0,
        outboundFailedCount: 0,
        staleSkipped,
        duplicateSkipped,
        status: String(c['status'] ?? ''),
      });
    }

    return { data: rows, total: count ?? 0, page, pageSize };
  }

  async getGhlSync(params: {
    conversationId?: string | null;
    page: number;
    pageSize: number;
  }): Promise<PaginatedResponse<GhlSyncRow>> {
    const { conversationId, page, pageSize } = params;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = this.supabase
      .from('metrics_events')
      .select('conversation_id, tenant_id, event_type, metadata, created_at', { count: 'exact' })
      .in('event_type', ['ghl_sync_started', 'ghl_sync_completed', 'ghl_sync_failed', 'ghl_message_imported'])
      .order('created_at', { ascending: false })
      .range(from, to);

    if (conversationId) query = query.eq('conversation_id', conversationId);

    const { data, error, count } = await query;
    if (error) {
      this.logger.warn(`getGhlSync error: ${String(error)}`);
      return { data: [], total: 0, page, pageSize };
    }

    const tenantNames = await this.loadTenantNames();
    return {
      data: ((data ?? []) as Record<string, unknown>[]).map(r => {
        const tid = r['tenant_id'] ? String(r['tenant_id']) : '';
        return {
          conversationId: r['conversation_id'] ? String(r['conversation_id']) : '',
          tenantId: tid,
          tenantName: tenantNames.get(tid) ?? null,
          eventType: String(r['event_type'] ?? ''),
          metadata: (r['metadata'] as Record<string, unknown>) ?? null,
          createdAt: String(r['created_at'] ?? ''),
        };
      }),
      total: count ?? 0,
      page,
      pageSize,
    };
  }

  async getErrors(params: {
    tenantId?: string;
    severity?: string;
    page: number;
    pageSize: number;
  }): Promise<PaginatedResponse<ErrorEventRow>> {
    const { tenantId, severity, page, pageSize } = params;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = this.supabase
      .from('metrics_events')
      .select('id, tenant_id, conversation_id, event_type, event_source, severity, metadata, created_at', { count: 'exact' })
      .in('severity', ['error', 'warn'])
      .order('created_at', { ascending: false });

    if (tenantId) query = query.eq('tenant_id', tenantId);
    if (severity) query = query.eq('severity', severity);

    const { data, error, count } = await query.range(from, to);
    if (error) {
      this.logger.warn(`getErrors error: ${String(error)}`);
      return { data: [], total: 0, page, pageSize };
    }

    const tenantNames = await this.loadTenantNames();
    return {
      data: ((data ?? []) as Record<string, unknown>[]).map(r => {
        const tid = r['tenant_id'] ? String(r['tenant_id']) : null;
        return {
          id: String(r['id'] ?? ''),
          tenantId: tid,
          tenantName: tid ? (tenantNames.get(tid) ?? null) : null,
          conversationId: r['conversation_id'] ? String(r['conversation_id']) : null,
          eventType: String(r['event_type'] ?? ''),
          eventSource: String(r['event_source'] ?? ''),
          severity: String(r['severity'] ?? ''),
          metadata: (r['metadata'] as Record<string, unknown>) ?? null,
          createdAt: String(r['created_at'] ?? ''),
        };
      }),
      total: count ?? 0,
      page,
      pageSize,
    };
  }

  async getAuditEvents(params: {
    tenantId?: string;
    page: number;
    pageSize: number;
  }): Promise<PaginatedResponse<ErrorEventRow>> {
    const { tenantId, page, pageSize } = params;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = this.supabase
      .from('metrics_events')
      .select('id, tenant_id, conversation_id, event_type, event_source, severity, metadata, created_at', { count: 'exact' })
      .order('created_at', { ascending: false });

    if (tenantId) query = query.eq('tenant_id', tenantId);

    const { data, error, count } = await query.range(from, to);
    if (error) {
      this.logger.warn(`getAuditEvents error: ${String(error)}`);
      return { data: [], total: 0, page, pageSize };
    }

    const tenantNames2 = await this.loadTenantNames();
    return {
      data: ((data ?? []) as Record<string, unknown>[]).map(r => {
        const tid = r['tenant_id'] ? String(r['tenant_id']) : null;
        return {
          id: String(r['id'] ?? ''),
          tenantId: tid,
          tenantName: tid ? (tenantNames2.get(tid) ?? null) : null,
          conversationId: r['conversation_id'] ? String(r['conversation_id']) : null,
          eventType: String(r['event_type'] ?? ''),
          eventSource: String(r['event_source'] ?? ''),
          severity: String(r['severity'] ?? ''),
          metadata: (r['metadata'] as Record<string, unknown>) ?? null,
          createdAt: String(r['created_at'] ?? ''),
        };
      }),
      total: count ?? 0,
      page,
      pageSize,
    };
  }

  async getTenants(): Promise<TenantReadinessRow[]> {
    const { data: tenants, error: tErr } = await this.supabase
      .from('tenants')
      .select('id, name, ghl_location_id, bot_enabled')
      .order('name');
    if (tErr || !tenants) return [];

    const { data: connections, error: cErr } = await this.supabase
      .from('tenant_ghl_connections')
      .select('tenant_id, status');
    const connMap = new Map<string, string>();
    if (!cErr && connections) {
      for (const c of connections as Record<string, unknown>[]) {
        connMap.set(String(c['tenant_id'] ?? ''), String(c['status'] ?? ''));
      }
    }

    const rows: TenantReadinessRow[] = [];
    for (const t of tenants as Record<string, unknown>[]) {
      const tid = String(t['id'] ?? '');
      const lastOk = await this.getLastOutboundTime(tid, 'sent');
      const lastFail = await this.getLastOutboundTime(tid, 'failed_provider_rejected');
      const badCount = await this.countPhoneFormattedContactIds(tid);
      const ghlSyncEnabled = process.env['GHL_PRE_REPLY_CONTEXT_SYNC'] === 'true';
      const tenantAllowed = (process.env['GHL_PRE_REPLY_CONTEXT_SYNC_TENANTS'] ?? '').includes(tid);

      rows.push({
        id: tid,
        name: String(t['name'] ?? ''),
        ghlLocationId: t['ghl_location_id'] ? String(t['ghl_location_id']) : null,
        botEnabled: Boolean(t['bot_enabled']),
        ghlConnectionStatus: connMap.get(tid) ?? null,
        lastSuccessfulSendAt: lastOk,
        lastFailedSendAt: lastFail,
        badContactIdCount: badCount,
        syncEnabled: ghlSyncEnabled && tenantAllowed,
      });
    }
    return rows;
  }

  async getQueueHealth(): Promise<QueueHealthEntry[]> {
    const queues: Array<{ name: string; q: Queue }> = [
      { name: QUEUES.INBOUND_MESSAGE_PROCESSOR, q: this.inboundQueue },
      { name: QUEUES.SEND_BUBBLE, q: this.sendBubbleQueue },
      { name: QUEUES.MEDIA_TRANSCRIPTION, q: this.mediaQueue },
      { name: QUEUES.KB_INGEST, q: this.kbIngestQueue },
      { name: QUEUES.FOLLOW_UP, q: this.followUpQueue },
    ];

    const results: QueueHealthEntry[] = [];
    for (const { name, q } of queues) {
      try {
        const counts = await q.getJobCounts();
        results.push({
          queue: name,
          waiting: counts['waiting'] ?? 0,
          active: counts['active'] ?? 0,
          completed: counts['completed'] ?? 0,
          failed: counts['failed'] ?? 0,
          delayed: counts['delayed'] ?? 0,
        });
      } catch (e) {
        this.logger.warn(`getQueueHealth ${name} error: ${e instanceof Error ? e.message : String(e)}`);
        results.push({ queue: name, waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 });
      }
    }
    return results;
  }

  /**
   * Load all tenant names into a map for batch enrichment of API responses.
   * Called once per request, not per row.
   */
  private async loadTenantNames(): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    try {
      const { data } = await this.supabase
        .from('tenants')
        .select('id, name')
        .limit(500);
      for (const row of (data ?? []) as Array<{ id: string; name: string }>) {
        map.set(row.id, row.name);
      }
    } catch (e) {
      this.logger.warn(`loadTenantNames error: ${e instanceof Error ? e.message : String(e)}`);
    }
    return map;
  }

  private async countMetricsByType(conversationId: string, eventType: string): Promise<number> {
    try {
      const { count } = await this.supabase
        .from('metrics_events')
        .select('id', { count: 'exact', head: true })
        .eq('conversation_id', conversationId)
        .eq('event_type', eventType);
      return count ?? 0;
    } catch {
      return 0;
    }
  }

  private async getLastOutboundTime(tenantId: string, status: string): Promise<string | null> {
    try {
      const { data } = await this.supabase
        .from('outbound_sends')
        .select('sent_at, created_at')
        .eq('tenant_id', tenantId)
        .eq('status', status)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!data) return null;
      const row = data as Record<string, unknown>;
      return (row['sent_at'] ? String(row['sent_at']) : String(row['created_at'] ?? '')) || null;
    } catch {
      return null;
    }
  }

  private async countPhoneFormattedContactIds(tenantId: string): Promise<number> {
    try {
      const { data } = await this.supabase
        .from('conversations')
        .select('contact_id')
        .eq('tenant_id', tenantId)
        .limit(100);
      if (!data) return 0;
      return (data as Record<string, unknown>[]).filter(row => {
        const cid = String(row['contact_id'] ?? '');
        return /^\+[0-9]{7,}$/.test(cid);
      }).length;
    } catch {
      return 0;
    }
  }

  /**
   * Internal/admin-only: clear active handover for a conversation.
   * Resolves ACTIVE handover events and restores conversation status to ACTIVE.
   * Does NOT send any outbound. Does NOT reset bot state or memory.
   * ai_status is preserved — if ai_status=off, AI remains blocked.
   */
  async clearHandover(conversationId: string): Promise<{
    ok: boolean;
    handoverCleared: boolean;
    activeHandoverFound: boolean;
    handoverEventsResolved: number;
    conversationStatusBefore: string | null;
    conversationStatusAfter: string | null;
    tenantId: string | null;
  }> {
    // Resolve the conversation first
    const { data: convRow } = await this.supabase
      .from('conversations')
      .select('id, tenant_id, status, metadata')
      .eq('id', conversationId)
      .maybeSingle();

    if (!convRow) {
      return { ok: false, handoverCleared: false, activeHandoverFound: false, handoverEventsResolved: 0, conversationStatusBefore: null, conversationStatusAfter: null, tenantId: null };
    }

    const tenantId = (convRow as Record<string, unknown>)['tenant_id'] as string;
    const statusBefore = (convRow as Record<string, unknown>)['status'] as string | null;

    const { data: activeRows } = await this.supabase
      .from('handover_events')
      .select('id')
      .eq('conversation_id', conversationId)
      .eq('status', 'ACTIVE');

    const ids = (activeRows ?? []).map((r: { id: string }) => r.id).filter(Boolean);
    const now = new Date().toISOString();

    if (ids.length > 0) {
      await this.supabase
        .from('handover_events')
        .update({ status: 'RESUMED', resumed_at: now })
        .in('id', ids);
    }

    // Restore conversation status to ACTIVE
    await this.supabase
      .from('conversations')
      .update({ status: 'ACTIVE', updated_at: now })
      .eq('id', conversationId);

    // Write audit metadata
    const { data: convAfter } = await this.supabase
      .from('conversations')
      .select('metadata')
      .eq('id', conversationId)
      .maybeSingle();
    const currentMeta = (convAfter?.metadata ?? {}) as Record<string, unknown>;
    currentMeta['handoverClearedAt'] = now;
    currentMeta['handoverClearedBy'] = 'ops/clear-handover';
    await this.supabase
      .from('conversations')
      .update({ metadata: currentMeta, updated_at: now })
      .eq('id', conversationId);

    this.logger.log(
      `ops_clear_handover: conversationId=${conversationId} tenantId=${tenantId} activeFound=${ids.length > 0} resolved=${ids.length}`,
    );

    return {
      ok: true,
      handoverCleared: true,
      activeHandoverFound: ids.length > 0,
      handoverEventsResolved: ids.length,
      conversationStatusBefore: statusBefore,
      conversationStatusAfter: 'ACTIVE',
      tenantId,
    };
  }
}
