// Post-Outbound Recovery Sync Processor
// Activated by GHL_POST_OUTBOUND_RECOVERY_SYNC feature flag (default OFF).
// After each successful outbound send, delayed jobs query GHL for new
// customer replies that may have been missed by the webhook pipeline.

import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger, Optional } from '@nestjs/common';
import { getSupabaseService } from '../../lib/supabase';
import { syncGhlConversationContext } from '../../lib/ghl-conversation-sync';
import { AppCacheService } from '../../lib/app-cache.service';
import { checkProviderOrchestrationGate } from '../../lib/schedule-orchestration-if-new';
import {
  bumpInboundDebounceMeta,
} from '../../lib/inbound-debounce';
import {
  resolveInboundDebounceMs,
} from '../../lib/inbound-burst-batch';
import { readConversationMetadataField, mergeConversationMetadataForPersist } from '../../lib/conversation-metadata-merge';
import { QUEUES } from '../../queues/queue.constants';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type { OrchestrateDebouncedJobData } from '../processors/inbound-message.processor';

const RECOVERY_HORIZON_MS = 5 * 60 * 1000; // 5 minutes

function isRecoveryEnabledForTenant(tenantId: string): boolean {
  const allowlist = (process.env['GHL_POST_OUTBOUND_RECOVERY_SYNC_TENANTS'] ?? '').trim();
  if (!allowlist) {
    return process.env['GHL_POST_OUTBOUND_RECOVERY_SYNC_ALL'] === 'true';
  }
  return allowlist.split(',').map(s => s.trim()).filter(Boolean).includes(tenantId);
}


interface PostOutboundSyncJobData {
  tenantId: string;
  conversationId: string;
  ghlLocationId: string;
  contactId: string;
  replyId: string;
  windowIndex: number;
  outboundCompletedAt: string;
}

@Processor(QUEUES.POST_OUTBOUND_SYNC)
export class PostOutboundSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(PostOutboundSyncProcessor.name);
  private readonly supabase = getSupabaseService();

  constructor(
    @InjectQueue(QUEUES.INBOUND_MESSAGE_PROCESSOR)
    private readonly inboundQueue: Queue,
    @Optional() private readonly appCache?: AppCacheService,
  ) {
    super();
  }

  async process(job: Job<PostOutboundSyncJobData>): Promise<void> {
    const { tenantId, conversationId, ghlLocationId, contactId, replyId, windowIndex, outboundCompletedAt } = job.data;

    if (!isRecoveryEnabledForTenant(tenantId)) {
      return;
    }

    this.logger.debug(
      `Post-outbound sync window ${windowIndex}: conversationId=${conversationId} replyId=${(replyId ?? '').slice(0,8)}`,
    );

    try {
      const syncResult = await syncGhlConversationContext({
        supabase: this.supabase,
        tenantId,
        ghlLocationId,
        conversationId,
        contactId,
      });

      this.logger.log(
        `postOutboundSyncCompleted ${JSON.stringify({
          conversationId,
          windowIndex,
          synced: syncResult.synced,
          deduped: syncResult.deduped,
          contactInboundRecovered: syncResult.insertedContactInboundIds.length,
          upgraded: syncResult.upgradedMetadataIds.length,
        })}`,
      );

      if (syncResult.insertedContactInboundIds.length === 0) {
        return;
      }

      // Guard 1: Check if recovered inbound is within the active recovery horizon
      const outboundTs = new Date(outboundCompletedAt).getTime();
      const horizonEnd = outboundTs + RECOVERY_HORIZON_MS;
      const latestRecoveredTs = syncResult.latestRecoveredContactInboundAt
        ? new Date(syncResult.latestRecoveredContactInboundAt).getTime()
        : 0;

      if (latestRecoveredTs > horizonEnd) {
        this.logger.log(
          `sync_recovered_inbound_context_only ${JSON.stringify({
            conversationId,
            reason: 'outside_recovery_horizon',
            latestRecoveredAt: syncResult.latestRecoveredContactInboundAt,
            outboundCompletedAt,
          })}`,
        );
        return;
      }

      // Guard 2: Check if recovered inbound is AFTER the KB outbound that triggered recovery
      if (latestRecoveredTs <= outboundTs) {
        this.logger.log(
          `sync_recovered_inbound_context_only ${JSON.stringify({
            conversationId,
            reason: 'before_triggering_outbound',
            latestRecoveredAt: syncResult.latestRecoveredContactInboundAt,
            outboundCompletedAt,
          })}`,
        );
        return;
      }

      // Guard 3: Check if a KB-owned outbound already exists AFTER the recovered inbound
      const { data: laterOutbound } = await this.supabase
        .from('messages')
        .select('id')
        .eq('conversation_id', conversationId)
        .eq('direction', 'OUTBOUND')
        .eq('sender', 'AI')
        .gte('created_at', syncResult.latestRecoveredContactInboundAt!)
        .limit(1)
        .maybeSingle();

      if (laterOutbound) {
        this.logger.log(
          `sync_recovered_inbound_already_handled ${JSON.stringify({
            conversationId,
            latestRecoveredAt: syncResult.latestRecoveredContactInboundAt,
            existingOutboundId: laterOutbound.id,
          })}`,
        );
        return;
      }

      // Schedule orchestration
      const { data: convMetaRow } = await this.supabase
        .from('conversations')
        .select('metadata')
        .eq('id', conversationId)
        .single();

      const currentMeta = readConversationMetadataField(convMetaRow?.metadata);
      const { merged: debounceBump, newVersion } = bumpInboundDebounceMeta(currentMeta);
      const merged = mergeConversationMetadataForPersist(currentMeta, debounceBump);

      await this.supabase
        .from('conversations')
        .update({ metadata: merged, updated_at: new Date().toISOString() })
        .eq('id', conversationId);

      const { debounceMs } = resolveInboundDebounceMs();

      // Provider-level idempotency gate
      const providerGate = await checkProviderOrchestrationGate({
        appCache: this.appCache,
        logger: this.logger,
        tenantId,
        conversationId,
        ghlMessageId: syncResult.latestRecoveredGhlMessageId,
        ghlTimestamp: syncResult.latestRecoveredContactInboundAt,
        source: 'fallback',
      });
      if (!providerGate.allowed) {
        this.logger.log(
          `post_sync_orch_skip_provider_gate: conversationId=${conversationId} reason=${providerGate.reason}`,
        );
        return;
      }

      await this.inboundQueue.add(
        'orchestrate',
        {
          tenantId,
          conversationId,
          locationId: ghlLocationId,
          ghlContactId: contactId,
          ghlConversationId: '',
          debounceVersion: newVersion,
          debounceConfiguredMs: debounceMs,
          orchestrateEnqueuedAtMs: Date.now(),
          ghlInboundMessageId: syncResult.latestRecoveredGhlMessageId || undefined,
        } satisfies OrchestrateDebouncedJobData,
        {
          delay: debounceMs,
          jobId: `deb:${conversationId}:${newVersion}`,
          attempts: 2,
          backoff: { type: 'exponential', delay: 1500 },
          removeOnComplete: true,
        },
      );

      this.logger.log(
        `orchestration_scheduled_from_sync_recovery ${JSON.stringify({
          conversationId,
          version: newVersion,
          recoveredCount: syncResult.insertedContactInboundIds.length,
        })}`,
      );
    } catch (e) {
      this.logger.error(
        `post_outbound_sync_error ${JSON.stringify({
          conversationId,
          windowIndex,
          message: e instanceof Error ? e.message : String(e),
        })}`,
      );
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error) {
    this.logger.error(
      `PostOutboundSync job ${job.id} failed: ${err.message}`,
    );
  }
}
