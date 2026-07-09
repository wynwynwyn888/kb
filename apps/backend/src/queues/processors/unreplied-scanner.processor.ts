// Unreplied Inbound Scanner — final safety net for messages that were stored
// but never received a terminal decision or outbound reply.
// Runs in background, self-rescheduling. Feature-flagged (default OFF).
//
// Scanner behavior:
// - Runs every SCAN_INTERVAL_MS (default 90s)
// - Looks back SCAN_LOOKBACK_MS (default 30 min)
// - Finds CONTACT/INBOUND messages without terminal decisions + without later outbound
// - Schedules orchestration through the existing debounce/provider-gate path
// - Rate-limited per tenant
// - Respects AI off metadata
// - Skips conversations with active handover

import { Processor, WorkerHost, OnWorkerEvent, InjectQueue } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { Logger, Optional } from '@nestjs/common';
import { getSupabaseService } from '../../lib/supabase';
import { AppCacheService } from '../../lib/app-cache.service';
import {
  findUnrepliedInboundMessages,
  recordTerminalDecision,
  recordInterimDecision,
} from '../../lib/inbound-decision';
import { checkProviderOrchestrationGate, markProviderOrchestrationDone } from '../../lib/schedule-orchestration-if-new';
import { bumpInboundDebounceMeta } from '../../lib/inbound-debounce';
import { resolveInboundDebounceMs } from '../../lib/inbound-burst-batch';
import { readConversationMetadataField, mergeConversationMetadataForPersist } from '../../lib/conversation-metadata-merge';
import { QUEUES } from '../../queues/queue.constants';
import type { OrchestrateDebouncedJobData } from '../processors/inbound-message.processor';

const SCAN_INTERVAL_MS = 90_000; // 90 seconds
const SCAN_LOOKBACK_MINUTES = 30;
const SCAN_LIMIT = 50;
const SCANNER_JOB_ID = 'unreplied-scanner';

interface ScannerJobData {
  startedAt: string;
}

@Processor(QUEUES.UNREPLIED_SCANNER)
export class UnrepliedScannerProcessor extends WorkerHost {
  private readonly logger = new Logger(UnrepliedScannerProcessor.name);
  private readonly supabase = getSupabaseService();

  constructor(
    @InjectQueue(QUEUES.INBOUND_MESSAGE_PROCESSOR)
    private readonly inboundQueue: Queue,
    @InjectQueue(QUEUES.UNREPLIED_SCANNER)
    private readonly scannerQueue: Queue,
    @Optional() private readonly appCache?: AppCacheService,
  ) {
    super();
  }

  @OnWorkerEvent('ready')
  async onReady() {
    if (!this.isEnabled()) return;
    this.logger.log('unreplied_scanner_ready: scheduling repeatable scan');
    await this.scannerQueue.add('scan', {
      startedAt: new Date().toISOString(),
    } satisfies ScannerJobData, {
      delay: 10_000,
      jobId: SCANNER_JOB_ID,
      repeat: { every: SCAN_INTERVAL_MS },
      removeOnComplete: true,
      attempts: 1,
    });
  }

  async process(job: Job<ScannerJobData>): Promise<void> {
    if (!this.isEnabled()) return;

    this.logger.log('unreplied_scanner_run_started');

    try {
      const candidates = await findUnrepliedInboundMessages({
        supabase: this.supabase,
        lookbackMinutes: SCAN_LOOKBACK_MINUTES,
        limit: SCAN_LIMIT,
      });

      this.logger.log(
        `unreplied_scanner_candidates: total=${candidates.length}`,
      );

      let scheduled = 0;
      let skippedAiOff = 0;
      let skippedGate = 0;
      let skippedNoProviderId = 0;

      for (const msg of candidates) {
        const meta = (msg.metadata ?? {}) as Record<string, unknown>;

        // Resolve tenant_id, contact_id, location from conversation
        const { data: convRow } = await this.supabase
          .from('conversations')
          .select('tenant_id, contact_id, metadata')
          .eq('id', msg.conversation_id)
          .single();
        if (!convRow) continue;
        const tenantId = (convRow as Record<string, unknown>)['tenant_id'] as string;
        const contactId = (convRow as Record<string, unknown>)['contact_id'] as string;
        const convMeta = (convRow as Record<string, unknown>)['metadata'] as Record<string, unknown> | undefined;

        // Respect AI off metadata
        if ((convMeta?.['ai_status'] ?? meta['ai_status']) === 'off') {
          skippedAiOff++;
          await this.recordTerminalSkipAndProviderDone({
            tenantId,
            messageId: msg.id,
            conversationId: msg.conversation_id,
            metadata: meta,
            status: 'SKIP_AI_OFF_TAG',
            reason: 'ai_status=off (scanner terminal skip)',
          });
          continue;
        }

        // Check for active handover
        const { data: handover } = await this.supabase
          .from('handover_events')
          .select('id')
          .eq('conversation_id', msg.conversation_id)
          .eq('status', 'ACTIVE')
          .maybeSingle();
        if (handover) {
          skippedGate++;
          await this.recordTerminalSkipAndProviderDone({
            tenantId,
            messageId: msg.id,
            conversationId: msg.conversation_id,
            metadata: meta,
            status: 'SKIP_HANDOVER_ACTIVE',
            reason: 'HANDOVER_ACTIVE_SCANNER_TERMINAL_SKIP',
          });
          continue;
        }

        // Get GHL message ID for provider gate
        const ghlMsgId = typeof meta['ghlMessageId'] === 'string' ? meta['ghlMessageId'] : null;
        const ghlTs = typeof meta['ghlTimestamp'] === 'string' ? meta['ghlTimestamp'] : null;

        // Cannot recover without a provider message ID
        if (!ghlMsgId) {
          skippedNoProviderId++;
          void recordInterimDecision({
            supabase: this.supabase,
            messageId: msg.id,
            decision: {
              status: 'PENDING_RECOVERY',
              reason: 'scanner found but no ghlMessageId',
              triggerSource: 'scanner',
              decidedAt: new Date().toISOString(),
            },
          });
          continue;
        }

        // Provider gate check (fallback = strict, requires Redis)
        const gate = await checkProviderOrchestrationGate({
          appCache: this.appCache,
          logger: this.logger,
          tenantId,
          conversationId: msg.conversation_id,
          ghlMessageId: ghlMsgId,
          ghlTimestamp: ghlTs,
          source: 'fallback',
        });

        if (!gate.allowed) {
          skippedGate++;
          void recordInterimDecision({
            supabase: this.supabase,
            messageId: msg.id,
            decision: {
              status: 'PENDING_RECOVERY',
              reason: `gate blocked: ${gate.reason}`,
              triggerSource: 'scanner',
              decidedAt: new Date().toISOString(),
            },
          });
          continue;
        }

        // Record recovery-scheduled marker BEFORE scheduling orchestration.
        // RECOVERY_SCHEDULED is interim (not terminal) — findUnrepliedInboundMessages
        // skips it for 5 minutes, then allows re-pick if orchestration never completed.
        await recordInterimDecision({
          supabase: this.supabase,
          messageId: msg.id,
          decision: {
            status: 'RECOVERY_SCHEDULED',
            reason: 'scanner scheduled orchestration',
            triggerSource: 'scanner',
            decidedAt: new Date().toISOString(),
          },
        });

        // Resolve GHL locationId for send context
        let locationId = (convMeta?.['locationId'] ?? convMeta?.['ghlLocationId']) as string | undefined;
        if (!locationId) {
          // Fallback: resolve from tenant_ghl_connections
          const { data: ghlConn } = await this.supabase
            .from('tenant_ghl_connections')
            .select('ghl_location_id')
            .eq('tenant_id', tenantId)
            .eq('status', 'CONNECTED')
            .maybeSingle();
          locationId = (ghlConn as Record<string, unknown> | null)?.['ghl_location_id'] as string | undefined;
        }

        // Cannot send without location context
        if (!locationId || !contactId) {
          skippedGate++;
          void recordInterimDecision({
            supabase: this.supabase,
            messageId: msg.id,
            decision: {
              status: 'PENDING_RECOVERY',
              reason: `scanner missing send context: locationId=${!!locationId} contactId=${!!contactId}`,
              triggerSource: 'scanner',
              decidedAt: new Date().toISOString(),
            },
          });
          this.logger.warn(
            `scanner_missing_send_context: conversationId=${msg.conversation_id} tenantId=${tenantId} locationId=${!!locationId} contactId=${!!contactId}`,
          );
          continue;
        }

        // Bump debounce + schedule orchestration
        const { data: convMetaRow } = await this.supabase
          .from('conversations')
          .select('metadata')
          .eq('id', msg.conversation_id)
          .single();

        const currentMeta = readConversationMetadataField(convMetaRow?.metadata);
        const { merged: debounceBump, newVersion } = bumpInboundDebounceMeta(currentMeta);
        const merged = mergeConversationMetadataForPersist(currentMeta, debounceBump);

        await this.supabase
          .from('conversations')
          .update({ metadata: merged, updated_at: new Date().toISOString() })
          .eq('id', msg.conversation_id);

        const { debounceMs } = resolveInboundDebounceMs();

        await this.inboundQueue.add('orchestrate', {
          tenantId,
          conversationId: msg.conversation_id,
          locationId,
          ghlContactId: contactId,
          ghlConversationId: '',
          debounceVersion: newVersion,
          debounceConfiguredMs: debounceMs,
          orchestrateEnqueuedAtMs: Date.now(),
          ghlInboundMessageId: ghlMsgId || undefined,
        } satisfies OrchestrateDebouncedJobData, {
          delay: debounceMs,
          jobId: `deb:${msg.conversation_id}:${newVersion}`,
          attempts: 2,
          backoff: { type: 'exponential', delay: 1500 },
          removeOnComplete: true,
        });

        scheduled++;
      }

      this.logger.log(
        `unreplied_scanner_run_completed: candidates=${candidates.length} scheduled=${scheduled} skippedAiOff=${skippedAiOff} skippedGate=${skippedGate} skippedNoProviderId=${skippedNoProviderId}`,
      );
    } catch (err) {
      this.logger.warn(
        `unreplied_scanner_error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Repeat cadence is owned by BullMQ. Do not self-reschedule here; if more
    // than one delayed scanner job already exists from an older deploy, those
    // jobs will drain without multiplying.
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error) {
    this.logger.error(`UnrepliedScanner job ${job.id} failed: ${err.message}`);
  }

  private isEnabled(): boolean {
    return process.env['UNREPLIED_SCANNER_ENABLED'] === 'true';
  }

  private async recordTerminalSkipAndProviderDone(input: {
    tenantId: string;
    messageId: string;
    conversationId: string;
    metadata: Record<string, unknown>;
    status: 'SKIP_AI_OFF_TAG' | 'SKIP_HANDOVER_ACTIVE';
    reason: string;
  }): Promise<void> {
    const decisionOk = await recordTerminalDecision({
      supabase: this.supabase,
      logger: this.logger,
      messageId: input.messageId,
      decision: {
        status: input.status,
        reason: input.reason,
        triggerSource: 'scanner',
        decidedAt: new Date().toISOString(),
      },
    });

    const ghlMsgId = typeof input.metadata['ghlMessageId'] === 'string'
      ? input.metadata['ghlMessageId']
      : null;
    if (decisionOk && ghlMsgId && input.tenantId) {
      await markProviderOrchestrationDone(this.appCache, input.tenantId, ghlMsgId);
    }

    this.logger.log(
      `SCANNER_TERMINAL_SKIP: status=${input.status} conversationId=${input.conversationId} messageId=${input.messageId.slice(0, 8)} providerDone=${Boolean(decisionOk && ghlMsgId)}`,
    );
  }
}
