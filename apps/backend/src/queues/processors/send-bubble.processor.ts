// Send Bubble Processor
// Consumes send-bubble queue jobs and dispatches reply bubbles via GHL.

import { Processor, WorkerHost, OnWorkerEvent, InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { QUEUES } from '../queue.constants';
import { OutboundSendService, SendSummary } from '../../modules/outbound/outbound-send.service';
import { ConversationsService } from '../../modules/conversations/conversations.service';
import { ActionGatingService } from '../../modules/action-gating/action-gating.service';
import { ActionIntentExecutorService } from '../../modules/action-execution/action-intent-executor.service';
import { OutboundSafetyGovernorService } from '../../modules/outbound/outbound-safety-governor.service';
import { FollowUpEngineService } from '../../modules/follow-up-engine/follow-up-engine.service';
import { HumanEscalationRuntimeService } from '../../modules/human-escalation/human-escalation-runtime.service';
import { HumanEscalationHoldingReplyService } from '../../modules/human-escalation/human-escalation-holding-reply.service';
import { AppCacheService } from '../../lib/app-cache.service';
import { MetricsService } from '../../lib/metrics.service';
import { getSupabaseService } from '../../lib/supabase';
import { bumpInboundDebounceMeta } from '../../lib/inbound-debounce';
import { resolveInboundDebounceMs } from '../../lib/inbound-burst-batch';
import { readConversationMetadataField, mergeConversationMetadataForPersist } from '../../lib/conversation-metadata-merge';
import { markProviderOrchestrationDone } from '../../lib/schedule-orchestration-if-new';
import { recordTerminalDecision, recordInterimDecision } from '../../lib/inbound-decision';
import { PIPELINE_ERROR_CODES, RetryablePipelineError } from '../../lib/pipeline-errors';

export interface SendBubbleJobData {
  conversationId: string;
  tenantId: string;
  contactId: string;
  ghlLocationId: string;
  replyPlanJson: string; // JSON-serialized ReplyDecision
  /** Stable id for this AI reply (per-send idempotency key component). */
  replyId: string;
  /** 0-based bubble index within the reply (parallels ReplyBubbleDraft.index). */
  bubbleSequence: number;
  /** Latest inbound message id at the moment AI generation started (stale check). */
  latestInboundMsgIdAtStart: string;
  /** Wall-clock ms when the AI orchestration job began (stale check). */
  aiJobStartedAt: number;
  /** Worker wall-clock start for downstream latency logs (omit for manual/controller enqueues). */
  replyLatencyTrace?: { pipelineWallStartMs: number };
  /** Inbound provider GHL message ID — used to mark provider done after successful send. */
  providerGhlMessageId?: string;
  /** Latest inbound KB message ID at orchestration start — for decision recording. */
  inboundMessageId?: string;
}

@Processor(QUEUES.SEND_BUBBLE)
@Injectable()
export class SendBubbleProcessor extends WorkerHost {
  private readonly logger = new Logger(SendBubbleProcessor.name);

  constructor(
    private readonly outboundSend: OutboundSendService,
    private readonly conversationsService: ConversationsService,
    private readonly actionGatingService: ActionGatingService,
    private readonly actionExecutor: ActionIntentExecutorService,
    private readonly outboundSafetyGovernor: OutboundSafetyGovernorService,
    private readonly followUpEngine: FollowUpEngineService,
    private readonly humanEscalationRuntime: HumanEscalationRuntimeService,
    private readonly humanEscalationHolding: HumanEscalationHoldingReplyService,
    @InjectQueue(QUEUES.INBOUND_MESSAGE_PROCESSOR) private readonly inboundQueue: Queue,
    @InjectQueue(QUEUES.POST_OUTBOUND_SYNC) private readonly postOutboundSyncQueue: Queue,
    @InjectQueue(QUEUES.ACTIVE_RECOVERY_WATCHDOG) private readonly watchdogQueue: Queue,
    private readonly appCache: AppCacheService,
    @Optional() private readonly metrics?: MetricsService,
  ) {
    super();
  }

  async process(job: Job<SendBubbleJobData>): Promise<SendSummary> {
    const { conversationId, tenantId, contactId, ghlLocationId, replyPlanJson, replyId, replyLatencyTrace, latestInboundMsgIdAtStart, aiJobStartedAt } =
      job.data;

    this.logger.log(
      `Send-bubble job started: conversationId=${conversationId}, tenantId=${tenantId}`,
    );

    let replyPlan: ReturnType<typeof JSON.parse> | null = null;
    try {
      replyPlan = JSON.parse(replyPlanJson);
    } catch (err) {
      const excerpt = replyPlanJson.slice(0, 100);
      const message = err instanceof Error ? err.message : 'unknown parse error';
      this.logger.error(
        `Failed to parse reply plan JSON: jobId=${job.id}, excerpt="${excerpt}", error=${message}`,
      );
      throw new Error(`Failed to parse reply plan JSON: ${message}`);
    }

    const govStarted = Date.now();
    replyPlan = await this.outboundSafetyGovernor.applyOutboundGovernor(replyPlan, {
      conversationId,
      tenantId,
      contactId,
    });
    const safety_governor_ms = Date.now() - govStarted;

    // Tenant active-job cap — send class
    const capsEnabled = process.env['AISBP_TENANT_CAPS_ENABLED'] === 'true' && !!this.appCache;
    let semAcquired = false;
    if (capsEnabled) {
      const sendCap = parseInt(process.env['AISBP_TENANT_CAP_SEND'] ?? '5', 10);
      const semKey = `sem:${tenantId}:send`;
      if (!(await this.appCache!.acquireSemaphore(semKey, String(job.id ?? ''), sendCap))) {
        this.metrics?.emit({ tenantId, conversationId, eventType: 'tenant_cap_blocked', eventSource: 'send-bubble', severity: 'warn', metadata: { cap: sendCap, class: 'send' } });
        this.logger.log(`tenantCapFull: tenantId=${tenantId} class=send — delaying`);
        throw new RetryablePipelineError(
          'Tenant send capacity unavailable',
          PIPELINE_ERROR_CODES.SEND_TENANT_CAPACITY,
        );
      }
      semAcquired = true;
      this.metrics?.emit({ tenantId, conversationId, eventType: 'tenant_cap_acquired', eventSource: 'send-bubble', metadata: { cap: sendCap, class: 'send' } });
    }

    // Per-conversation ordering lock
    const lockKey = `lock:conv:${conversationId}`;
    const ownerToken = randomUUID();
    const orderingEnabled = process.env['AISBP_CONV_ORDERING_ENABLED'] === 'true' && !!this.appCache;
    let lockAcquired = false;
    if (orderingEnabled) {
      const lockResult = await this.appCache!.acquireLock(lockKey, ownerToken, 30);
      if (lockResult !== 'acquired') {
        this.metrics?.emit({ tenantId, conversationId, eventType: 'conv_ordering_blocked', eventSource: 'send-bubble', severity: 'warn', metadata: { replyId } });
        this.logger.log(`conversationLockHeld: conversationId=${conversationId} — requeuing`);
        throw new RetryablePipelineError(
          'Conversation ordering lock unavailable',
          PIPELINE_ERROR_CODES.SEND_CONVERSATION_LOCK,
        );
      }
      lockAcquired = true;
    }

    let summary: SendSummary | undefined;
    let outbound_send_ms = 0;
    try {
      // Pre-send stale check: abort if newer customer inbound arrived after
      // orchestration started. Reschedule with properly bumped debounce version.
      if (latestInboundMsgIdAtStart) {
        const isStale = await this.outboundSend.isReplyStale(conversationId, latestInboundMsgIdAtStart);
        if (isStale) {
          this.metrics?.emit({ tenantId, conversationId, eventType: 'stale_send_cancelled', eventSource: 'send-bubble', severity: 'warn', metadata: { replyId, latestInboundMsgIdAtStart } });
          this.logger.log(
            `staleReplyCancelled: conversationId=${conversationId} replyId=${replyId} — newer inbound detected, rescheduling orchestration`,
          );

          // Bump debounce version and reschedule with correct version
          const supabase = getSupabaseService();
          const { data: convMetaRow } = await supabase
            .from('conversations')
            .select('metadata')
            .eq('id', conversationId)
            .single();
          const currentMeta = readConversationMetadataField(convMetaRow?.metadata);
          const { merged: debounceBump, newVersion } = bumpInboundDebounceMeta(currentMeta);
          const merged = mergeConversationMetadataForPersist(currentMeta, debounceBump);
          await supabase
            .from('conversations')
            .update({ metadata: merged, updated_at: new Date().toISOString() })
            .eq('id', conversationId);

          const { debounceMs } = resolveInboundDebounceMs();
          await this.inboundQueue.add('orchestrate', {
            tenantId, conversationId, locationId: ghlLocationId, ghlContactId: contactId,
            ghlConversationId: '', debounceVersion: newVersion,
            debounceConfiguredMs: debounceMs, orchestrateEnqueuedAtMs: Date.now(),
          } as any, {
            delay: debounceMs,
            jobId: `deb:${conversationId}:${newVersion}`,
            attempts: 2, backoff: { type: 'exponential', delay: 1500 }, removeOnComplete: true,
          });

          return {
            conversationId, tenantId, totalBubbles: 0, succeeded: 0, failed: 0,
            bubbleResults: [], quotaDebited: 0,
          };
        }
      }

      // Hard invariant: AI off check as final pre-send blocker.
      // Blocks every outbound path (AI reply, holding reply, chat reset, etc.)
      // regardless of how it reached this processor. Guard ordering ensures
      // orchestration never reaches PROCEED while AI is off, but this is the
      // safety net for any path that enqueues send-bubble directly.
      const aiOffPreSendCheck = await this.checkAiOffBeforeSend(conversationId, tenantId, job);
      if (!aiOffPreSendCheck.allowed) {
        return {
          conversationId, tenantId, totalBubbles: 0, succeeded: 0, failed: 0,
          bubbleResults: [], quotaDebited: 0,
        };
      }

      // Prior-bubble gate (inside lock)
      if (orderingEnabled) {
        const bubbles = (replyPlan as any)?.bubbles as Array<{ index: number }> | undefined;
        for (const bubble of (bubbles ?? [])) {
          const decision = await this.outboundSend.checkPriorBubble(
            tenantId, conversationId, replyId, bubble.index,
          );
          if (decision === 'wait') {
            this.metrics?.emit({ tenantId, conversationId, eventType: 'conv_ordering_wait', eventSource: 'send-bubble', severity: 'warn', metadata: { replyId, bubbleSequence: bubble.index } });
            this.logger.log(`bubbleSequenceBlocked: conversationId=${conversationId} bubble=${bubble.index} — predecessor pending, requeuing`);
            throw new RetryablePipelineError(
              'Predecessor bubble is not terminal',
              PIPELINE_ERROR_CODES.SEND_PRIOR_BUBBLE_PENDING,
            );
          }
          if (decision === 'cancel') {
            this.metrics?.emit({ tenantId, conversationId, eventType: 'conv_ordering_cancelled', eventSource: 'send-bubble', severity: 'warn', metadata: { replyId, bubbleSequence: bubble.index } });
            this.logger.log(`bubbleSequenceCancelledDueToPrior: conversationId=${conversationId} bubble=${bubble.index}`);
            return {
              conversationId, tenantId, totalBubbles: 0, succeeded: 0, failed: 0,
              bubbleResults: [], quotaDebited: 0,
            };
          }
        }
      }

      const sendStarted = Date.now();
      summary = await this.outboundSend.sendReply({
        tenantId,
        conversationId,
        contactId,
        replyPlan,
        ghlLocationId,
        replyId,
        sendBubbleJobId: String(job.id ?? ''),
      });
      outbound_send_ms = Date.now() - sendStarted;
    } finally {
      if (lockAcquired) {
        await this.appCache!.releaseLock(lockKey, ownerToken);
      }
      if (semAcquired) {
        await this.appCache!.releaseSemaphore(`sem:${tenantId}:send`, String(job.id ?? ''));
        this.metrics?.emit({ tenantId, conversationId, eventType: 'tenant_cap_released', eventSource: 'send-bubble', metadata: { class: 'send' } });
      }
    }

    if (!summary) {
      // All paths should have returned inside the try block if send was skipped.
      // This is a safety guard for unexpected flow.
      return {} as SendSummary;
    }

    // Fix 2: Mark provider done ONLY after successful send is confirmed.
    // Fix 1: Record PROCEED / FAILED_SEND terminal decision on the inbound message.
    const providerGhlMsgId = job.data.providerGhlMessageId;
    const inboundMsgId = job.data.inboundMessageId;
    if (summary.succeeded > 0) {
      // Successful send → record PROCEED terminal decision first
      let decisionOk = true;
      if (inboundMsgId) {
        const outboundMsgId = summary.bubbleResults?.[0]?.ghlMessageId;
        decisionOk = await recordTerminalDecision({
          supabase: getSupabaseService(),
          logger: this.logger,
          messageId: inboundMsgId,
          decision: {
            status: 'PROCEED',
            outboundMessageId: replyId,
            outboundGhlMessageId: typeof outboundMsgId === 'string' ? outboundMsgId : undefined,
            triggerSource: 'webhook',
            decidedAt: new Date().toISOString(),
          },
        });
      }
      // Only mark provider done if decision write succeeded (or no inboundMsgId)
      if (providerGhlMsgId && (decisionOk || !inboundMsgId)) {
        await markProviderOrchestrationDone(this.appCache, tenantId, providerGhlMsgId);
        this.logger.log(
          `providerDoneWritten: tenantId=${tenantId} providerMsgId=${providerGhlMsgId.slice(0, 12)}`,
        );
      } else if (providerGhlMsgId && !decisionOk) {
        this.logger.error(
          `providerDoneWithheld_decisionWriteFailed: tenantId=${tenantId} conversationId=${conversationId} providerMsgId=${providerGhlMsgId} inboundMsgId=${inboundMsgId}`,
        );
      }
    } else if (summary.failed > 0) {
      // Failed send → record FAILED_SEND as interim retryable, do NOT mark provider done
      if (inboundMsgId) {
        await recordInterimDecision({
          supabase: getSupabaseService(),
          messageId: inboundMsgId,
          decision: {
            status: 'FAILED_SEND',
            reason: `failed=${summary.failed} succeeded=${summary.succeeded}`,
            triggerSource: 'webhook',
            decidedAt: new Date().toISOString(),
          },
        });
      }
      // Do NOT mark provider done — let scanner/retry handle it
    }

    const total_backend_reply_ms = replyLatencyTrace?.pipelineWallStartMs
      ? Date.now() - replyLatencyTrace.pipelineWallStartMs
      : null;
    this.logger.log(
      `sendBubbleLatency: conversationId=${conversationId} safety_governor_ms=${safety_governor_ms} ` +
        `outbound_send_ms=${outbound_send_ms} total_backend_reply_ms=${total_backend_reply_ms ?? 'na'}`,
    );

    if (summary.succeeded > 0 && replyPlan.draftProvenance === 'human_escalation') {
      try {
        await this.humanEscalationHolding.persistHoldingReplyAfterSuccessfulSend(conversationId, replyPlan);
      } catch (e) {
        this.logger.warn(
          `humanEscalationHoldingMetaAfterSendFailed ${JSON.stringify({
            conversationId,
            message: e instanceof Error ? e.message : String(e),
          })}`,
        );
      }
    }

    if (summary.succeeded > 0 && replyPlan.draftProvenance === 'human_escalation') {
      const channelUsed = summary.bubbleResults.find(b => b.success && b.ghlChannelUsed)?.ghlChannelUsed;
      try {
        const flushResult = await this.humanEscalationRuntime.flushPendingInternalAlert(
          tenantId,
          conversationId,
          channelUsed ?? null,
        );
        if (flushResult !== 'skipped_no_pending') {
          this.logger.log(
            `humanEscalationFlushPendingAlert ${JSON.stringify({
              conversationId,
              flushResult,
              channelUsed: channelUsed ?? null,
            })}`,
          );
        }
      } catch (e) {
        this.logger.warn(
          `humanEscalationFlushPendingAlertFailed ${JSON.stringify({
            conversationId,
            message: e instanceof Error ? e.message : String(e),
          })}`,
        );
      }
    }

    // Step 2: Persist handover state if reply plan is HANDOVER
    // Guard already blocks future inbound while an active HandoverEvent exists.
    // This is idempotent — skip if already handed over.
    if (replyPlan.planStatus === 'HANDOVER' || replyPlan.handoverRecommended) {
      const existing = await this.conversationsService.getActiveHandover(tenantId, conversationId);
      if (!existing) {
        await this.conversationsService.pauseForHandover(
          tenantId,
          conversationId,
          'REQUEST',
          'AI',
          replyPlan.rationale || 'handover recommended',
        );
        this.logger.log(`Handover state set: conversationId=${conversationId}`);
      }
    }

    // Step 3: Gate and persist suggested actions (internal state only — no external side effects)
    if (replyPlan.suggestedActions.length > 0) {
      const gatingResults = await this.actionGatingService.gateActions(
        replyPlan.suggestedActions,
        tenantId,
        conversationId,
        undefined, // contactId — stored in job data, passed to executor below
      );
      for (const r of gatingResults) {
        this.logger.log(
          `Action gated: type=${r.actionType}, status=${r.status}, note=${r.note}`,
        );
      }
    }

    // Step 4: Execute deferred TAG_CONTACT intents only on successful outbound send
    if (this.actionExecutor.shouldExecute({ succeeded: summary.succeeded, planStatus: replyPlan.planStatus }, contactId)) {
      const tagResults = await this.actionExecutor.executeDeferredTagActions(
        tenantId,
        conversationId,
        contactId,
        ghlLocationId,
      );
      for (const r of tagResults) {
        this.logger.log(`Tag intent executed: id=${r.id}, status=${r.status}`);
      }
    } else {
      this.logger.debug(
        `Tag execution skipped: planStatus=${replyPlan.planStatus}, succeeded=${summary.succeeded}, contactId=${contactId ?? 'missing'}`,
      );
    }

    // Step 4b: Legacy deferred BOOK_SLOT (disabled unless AISBP_EXECUTE_DEFERRED_BOOK_SLOT=true).
    // Live calendar creates are performed by ConversationBookingFlowService.
    if (
      process.env['AISBP_EXECUTE_DEFERRED_BOOK_SLOT'] === 'true' &&
      this.actionExecutor.shouldExecute({ succeeded: summary.succeeded, planStatus: replyPlan.planStatus }, contactId)
    ) {
      const bookResults = await this.actionExecutor.executeDeferredBookSlotActions(
        tenantId,
        conversationId,
        contactId,
        ghlLocationId,
      );
      for (const r of bookResults) {
        this.logger.log(`Book intent ${r.id} ${r.status}: ${r.errorNote ?? 'ok'}`);
      }
    }

    // Step 5: Follow-up scheduling — only after a successful outbound send.
    if (summary.succeeded > 0 && summary.failed === 0 && replyPlan.planStatus === 'PLANNED') {
      try {
        await this.followUpEngine.scheduleAfterOutboundSend({
          tenantId,
          conversationId,
          contactId,
          ghlLocationId,
          sentAtIso: new Date().toISOString(),
        });
      } catch (e) {
        this.logger.warn(
          `followUpScheduleHookFailed ${JSON.stringify({
            tenantId,
            conversationId,
            msg: e instanceof Error ? e.message : String(e),
          })}`,
        );
      }
    }

    // Step 5c: Active recovery watchdog (30-min self-rescheduling poll)
    if (summary.succeeded > 0 && process.env['GHL_ACTIVE_RECOVERY_WATCHDOG_ENABLED'] === 'true') {
      try {
        const now = new Date().toISOString();
        const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
        const jobId = `wdog_${tenantId}_${conversationId}`;
        // Remove any existing watchdog for this conversation (stale/older)
        await this.watchdogQueue.remove(jobId).catch(() => {});
        await this.watchdogQueue.add('check', {
          tenantId, conversationId, ghlLocationId, contactId,
          latestOutboundAt: now, startedAt: now, expiresAt,
        }, {
          delay: 15_000,
          jobId,
          removeOnComplete: true,
          attempts: 1,
          backoff: { type: 'fixed', delay: 0 },
        });
      } catch (e) {
        this.logger.warn(`activeWatchdogScheduleFailed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    // Feature flag + tenant allowlist gating
    if (summary.succeeded > 0) {
      try {
        const allowlist = (process.env['GHL_POST_OUTBOUND_RECOVERY_SYNC_TENANTS'] ?? '').trim();
        const allowed = allowlist
          ? allowlist.split(',').map(s => s.trim()).filter(Boolean).includes(tenantId)
          : process.env['GHL_POST_OUTBOUND_RECOVERY_SYNC_ALL'] === 'true';
        if (allowed) {
          const recoveryWindows = [15_000, 45_000, 120_000, 300_000];
          const outboundCompletedAt = new Date().toISOString();
          for (let i = 0; i < recoveryWindows.length; i++) {
            await this.postOutboundSyncQueue.add('check', {
              tenantId, conversationId, ghlLocationId, contactId,
              replyId, windowIndex: i, outboundCompletedAt,
            }, {
              delay: recoveryWindows[i],
              jobId: `posync_${tenantId}_${conversationId}_${replyId}_${i}`,
              removeOnComplete: true,
              attempts: 1,
              backoff: { type: 'fixed', delay: 0 },
            });
          }
        }
      } catch (e) {
        this.logger.warn(
          `postOutboundSyncScheduleFailed ${JSON.stringify({
            tenantId, conversationId,
            msg: e instanceof Error ? e.message : String(e),
          })}`,
        );
      }
    }

    this.logger.log(
      `Send-bubble job completed: conversationId=${conversationId}, ` +
      `total=${summary.totalBubbles}, succeeded=${summary.succeeded}, failed=${summary.failed}`,
    );

    return summary;
  }

  /**
   * Hard invariant: never send any outbound when AI is off.
   * Checks conversation metadata ai_status. If 'off', writes SKIP_AI_OFF_TAG
   * terminal decision and marks provider done so recovery paths don't retry.
   */
  private async checkAiOffBeforeSend(
    conversationId: string,
    tenantId: string,
    job: Job<SendBubbleJobData>,
  ): Promise<{ allowed: boolean }> {
    try {
      const supabase = getSupabaseService();
      const { data } = await supabase
        .from('conversations')
        .select('metadata')
        .eq('id', conversationId)
        .maybeSingle();

      const meta = (data?.metadata ?? {}) as Record<string, unknown>;
      const aiStatus = typeof meta['ai_status'] === 'string' ? meta['ai_status'].trim().toLowerCase() : null;

      if (aiStatus !== 'off') {
        return { allowed: true };
      }

      this.logger.warn(
        `AI_OFF_FINAL_SEND_BLOCK: conversationId=${conversationId} tenantId=${tenantId} — AI is off, aborting send`,
      );

      const inboundMsgId = job.data.inboundMessageId;
      const providerGhlMsgId = job.data.providerGhlMessageId;

      if (inboundMsgId) {
        await recordTerminalDecision({
          supabase,
          logger: this.logger,
          messageId: inboundMsgId,
          decision: {
            status: 'SKIP_AI_OFF_TAG',
            reason: 'ai_status=off (pre-send check)',
            triggerSource: 'webhook',
            decidedAt: new Date().toISOString(),
          },
        });
      }

      if (providerGhlMsgId) {
        await markProviderOrchestrationDone(this.appCache, tenantId, providerGhlMsgId);
      }

      return { allowed: false };
    } catch (err) {
      // Fail closed: if we cannot verify AI status, do NOT send.
      // A blocked no-send is safer than texting a customer while AI off is on.
      this.logger.error(
        `AI_OFF_STATUS_CHECK_FAILED_SEND_BLOCKED: conversationId=${conversationId} error=${err instanceof Error ? err.message : String(err)}`,
      );
      return { allowed: false };
    }
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    this.logger.log(`Send bubble job ${job.id} completed`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    this.logger.error(`Send bubble job ${job.id} failed: ${error.message}`);
  }
}
