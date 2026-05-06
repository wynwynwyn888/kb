// Send Bubble Processor
// Consumes send-bubble queue jobs and dispatches reply bubbles via GHL.

import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUES } from '../queue.constants';
import { OutboundSendService, SendSummary } from '../../modules/outbound/outbound-send.service';
import { ConversationsService } from '../../modules/conversations/conversations.service';
import { ActionGatingService } from '../../modules/action-gating/action-gating.service';
import { ActionIntentExecutorService } from '../../modules/action-execution/action-intent-executor.service';
import { OutboundSafetyGovernorService } from '../../modules/outbound/outbound-safety-governor.service';
import { FollowUpEngineService } from '../../modules/follow-up-engine/follow-up-engine.service';

export interface SendBubbleJobData {
  conversationId: string;
  tenantId: string;
  contactId: string;
  ghlLocationId: string;
  replyPlanJson: string; // JSON-serialized ReplyDecision
  /** Worker wall-clock start for downstream latency logs (omit for manual/controller enqueues). */
  replyLatencyTrace?: { pipelineWallStartMs: number };
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
  ) {
    super();
  }

  async process(job: Job<SendBubbleJobData>): Promise<SendSummary> {
    const { conversationId, tenantId, contactId, ghlLocationId, replyPlanJson, replyLatencyTrace } =
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

    const sendStarted = Date.now();
    const summary = await this.outboundSend.sendReply({
      tenantId,
      conversationId,
      contactId,
      replyPlan,
      ghlLocationId,
    });
    const outbound_send_ms = Date.now() - sendStarted;

    const total_backend_reply_ms = replyLatencyTrace?.pipelineWallStartMs
      ? Date.now() - replyLatencyTrace.pipelineWallStartMs
      : null;
    this.logger.log(
      `sendBubbleLatency: conversationId=${conversationId} safety_governor_ms=${safety_governor_ms} ` +
        `outbound_send_ms=${outbound_send_ms} total_backend_reply_ms=${total_backend_reply_ms ?? 'na'}`,
    );

    // Step 2: Persist handover state if reply plan is HANDOVER
    // Guard already blocks future inbound while an active HandoverEvent exists.
    // This is idempotent — skip if already handed over.
    if (replyPlan.planStatus === 'HANDOVER' || replyPlan.handoverRecommended) {
      const existing = await this.conversationsService.getActiveHandover(conversationId);
      if (!existing) {
        await this.conversationsService.pauseForHandover(
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

    this.logger.log(
      `Send-bubble job completed: conversationId=${conversationId}, ` +
      `total=${summary.totalBubbles}, succeeded=${summary.succeeded}, failed=${summary.failed}`,
    );

    return summary;
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
