// Active Recovery Watchdog Processor
// Self-rescheduling per-conversation watchdog that polls GHL for missed
// CONTACT inbound messages during the 30-minute active sales window.
// Designed to meet <30s recovery SLA for missed-webhook messages.

import { Processor, WorkerHost, OnWorkerEvent, InjectQueue } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { Logger } from '@nestjs/common';
import { getSupabaseService } from '../../lib/supabase';
import { syncGhlConversationContext } from '../../lib/ghl-conversation-sync';
import { bumpInboundDebounceMeta } from '../../lib/inbound-debounce';
import { resolveInboundDebounceMs } from '../../lib/inbound-burst-batch';
import { readConversationMetadataField, mergeConversationMetadataForPersist } from '../../lib/conversation-metadata-merge';
import { QUEUES } from '../../queues/queue.constants';
import type { OrchestrateDebouncedJobData } from '../processors/inbound-message.processor';

const ACTIVE_WINDOW_MS = 30 * 60 * 1000; // 30 minutes
const RECOVERY_HORIZON_MS = 5 * 60 * 1000; // 5 minutes

interface WatchdogJobData {
  tenantId: string;
  conversationId: string;
  ghlLocationId: string;
  contactId: string;
  latestOutboundAt: string;
  startedAt: string;
  expiresAt: string;
}

function nextDelayMs(elapsedMs: number): number | null {
  if (elapsedMs < 2 * 60 * 1000) return 15_000;      // 0–2 min: every 15s
  if (elapsedMs < 10 * 60 * 1000) return 30_000;     // 2–10 min: every 30s
  if (elapsedMs < ACTIVE_WINDOW_MS) return 60_000;   // 10–30 min: every 60s
  return null; // expired
}

@Processor(QUEUES.ACTIVE_RECOVERY_WATCHDOG)
export class ActiveRecoveryWatchdogProcessor extends WorkerHost {
  private readonly logger = new Logger(ActiveRecoveryWatchdogProcessor.name);
  private readonly supabase = getSupabaseService();

  constructor(
    @InjectQueue(QUEUES.INBOUND_MESSAGE_PROCESSOR)
    private readonly inboundQueue: Queue,
    @InjectQueue(QUEUES.ACTIVE_RECOVERY_WATCHDOG)
    private readonly watchdogQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<WatchdogJobData>): Promise<void> {
    const { tenantId, conversationId, ghlLocationId, contactId, latestOutboundAt, startedAt, expiresAt } = job.data;

    if (process.env['GHL_ACTIVE_RECOVERY_WATCHDOG_ENABLED'] !== 'true') {
      return;
    }

    // Guard: stale job — a newer outbound started a fresh watchdog
    const outboundTs = new Date(job.data.latestOutboundAt).getTime();
    const startedTs = new Date(job.data.startedAt).getTime();
    const latest = await this.getLatestKbOutboundTimestamp(conversationId);
    if (latest && latest > outboundTs) {
      this.logger.log(`active_recovery_stale_job_skipped: conversationId=${conversationId}`);
      return;
    }

    const elapsedMs = Date.now() - new Date(startedAt).getTime();
    const delay = nextDelayMs(elapsedMs);

    if (!delay) {
      this.logger.log(`active_recovery_expired: conversationId=${conversationId}`);
      return;
    }

    try {
      const syncResult = await syncGhlConversationContext({
        supabase: this.supabase,
        tenantId,
        ghlLocationId,
        conversationId,
        contactId,
      });

      this.logger.log(
        `active_recovery_watchdog_completed ${JSON.stringify({
          conversationId,
          synced: syncResult.synced,
          deduped: syncResult.deduped,
          contactInboundRecovered: syncResult.insertedContactInboundIds.length,
          elapsedMs,
        })}`,
      );

      if (syncResult.insertedContactInboundIds.length > 0) {
        const latestRecoveredTs = syncResult.latestRecoveredContactInboundAt
          ? new Date(syncResult.latestRecoveredContactInboundAt).getTime()
          : 0;
        const outboundTs = new Date(latestOutboundAt).getTime();

        // Guards
        if (latestRecoveredTs <= outboundTs) return; // before outbound
        if (latestRecoveredTs > outboundTs + RECOVERY_HORIZON_MS) return; // outside horizon

        // Check if already handled
        const { data: laterOutbound } = await this.supabase
          .from('messages')
          .select('id')
          .eq('conversation_id', conversationId)
          .eq('direction', 'OUTBOUND')
          .eq('sender', 'AI')
          .gte('created_at', syncResult.latestRecoveredContactInboundAt!)
          .limit(1)
          .maybeSingle();

        if (laterOutbound) return;

        // Bump debounce + schedule orchestration
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

        await this.inboundQueue.add('orchestrate', {
          tenantId, conversationId, locationId: ghlLocationId, ghlContactId: contactId,
          ghlConversationId: '', debounceVersion: newVersion,
          debounceConfiguredMs: debounceMs, orchestrateEnqueuedAtMs: Date.now(),
        } satisfies OrchestrateDebouncedJobData, {
          delay: debounceMs,
          jobId: `deb:${conversationId}:${newVersion}`,
          attempts: 2, backoff: { type: 'exponential', delay: 1500 }, removeOnComplete: true,
        });

        this.logger.log(
          `orchestration_scheduled_from_sync_recovery ${JSON.stringify({
            conversationId, version: newVersion, recoveredAgeMs: Date.now() - latestRecoveredTs,
          })}`,
        );
      }

      // Schedule next check
      const nextAt = Date.now() + delay;
      if (nextAt < new Date(expiresAt).getTime()) {
        await this.watchdogQueue.add('check', job.data, {
          delay,
          jobId: job.opts.jobId,
          removeOnComplete: true,
          attempts: 1,
          backoff: { type: 'fixed', delay: 0 },
        });
        this.logger.log(`active_recovery_next_delay_ms: conversationId=${conversationId} delay=${delay}`);
      }
    } catch (e) {
      this.logger.error(
        `active_recovery_watchdog_error ${JSON.stringify({
          conversationId, message: e instanceof Error ? e.message : String(e),
        })}`,
      );
      // Still reschedule if within window
      const nextAt = Date.now() + delay;
      if (nextAt < new Date(expiresAt).getTime()) {
        await this.watchdogQueue.add('check', job.data, {
          delay, jobId: job.opts.jobId, removeOnComplete: true, attempts: 1,
        });
      }
    }
  }

  private async getLatestKbOutboundTimestamp(conversationId: string): Promise<number | null> {
    const { data } = await this.supabase
      .from('messages')
      .select('created_at')
      .eq('conversation_id', conversationId)
      .eq('direction', 'OUTBOUND')
      .eq('sender', 'AI')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) return null;
    try { return new Date(String((data as Record<string,unknown>)['created_at'])).getTime(); }
    catch { return null; }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error) {
    this.logger.error(`ActiveRecoveryWatchdog job ${job.id} failed: ${err.message}`);
  }
}
