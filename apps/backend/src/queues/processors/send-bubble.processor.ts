// Send Bubble Processor
// Consumes send-bubble queue jobs and dispatches reply bubbles via GHL.

import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUES } from '../queue.constants';
import { OutboundSendService, SendSummary } from '../../modules/outbound/outbound-send.service';

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

  constructor(private readonly outboundSend: OutboundSendService) {
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
    } catch {
      throw new Error('Failed to parse reply plan JSON');
    }

    const summary = await this.outboundSend.sendReply({
      tenantId,
      conversationId,
      contactId,
      replyPlan,
      ghlLocationId,
    });

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
