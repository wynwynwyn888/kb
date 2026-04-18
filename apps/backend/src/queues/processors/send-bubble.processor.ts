// Send Bubble Processor
// Consumes send-bubble queue jobs and dispatches reply bubbles via GHL.

import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUES } from '../queue.constants';
import { OutboundSendService, SendSummary } from '../../modules/outbound/outbound-send.service';
import { ConversationsService } from '../../modules/conversations/conversations.service';
import { ActionGatingService } from '../../modules/action-gating/action-gating.service';

export interface SendBubbleJobData {
  conversationId: string;
  tenantId: string;
  contactId: string;
  ghlLocationId: string;
  replyPlanJson: string; // JSON-serialized ReplyDecision
}

@Processor(QUEUES.SEND_BUBBLE)
@Injectable()
export class SendBubbleProcessor extends WorkerHost {
  private readonly logger = new Logger(SendBubbleProcessor.name);

  constructor(
    private readonly outboundSend: OutboundSendService,
    private readonly conversationsService: ConversationsService,
    private readonly actionGatingService: ActionGatingService,
  ) {
    super();
  }

  async process(job: Job<SendBubbleJobData>): Promise<SendSummary> {
    const { conversationId, tenantId, contactId, ghlLocationId, replyPlanJson } = job.data;

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

    const summary = await this.outboundSend.sendReply({
      tenantId,
      conversationId,
      contactId,
      replyPlan,
      ghlLocationId,
    });

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
      );
      for (const r of gatingResults) {
        this.logger.log(
          `Action gated: type=${r.actionType}, status=${r.status}, note=${r.note}`,
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
