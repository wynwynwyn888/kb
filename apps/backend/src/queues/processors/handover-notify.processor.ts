// Handover Notify Processor
// Processes handover notification jobs from the queue.
//
// IMPORTANT: This processor does NOT send external notifications (SMS/email/etc.).
// Actual staff alerts are handled by HumanEscalationRuntimeService via a deferred-
// staging-and-flush pattern that fires after the customer reply is sent. That path
// is already production-tested and avoids duplicate notifications.
//
// This processor serves as an audit/logging endpoint for handover events
// enqueued through the BullMQ pipeline. It validates the job payload, resolves
// context, and writes metrics/audit entries. If a future notification channel
// is added, it should be wired here with appropriate anti-spam guards.
//
// Idempotency: a unique jobId-based dedupe prevents duplicate audit entries.

import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUES } from '../queue.constants';
import { getSupabaseService } from '../../lib/supabase';
import { MetricsService } from '../../lib/metrics.service';

export interface HandoverNotifyJobData {
  conversationId: string;
  tenantId: string;
  handoverType: 'request' | 'transfer';
  contactName?: string;
  note?: string;
}

@Processor(QUEUES.HANDOVER_NOTIFY)
@Injectable()
export class HandoverNotifyProcessor extends WorkerHost {
  private readonly logger = new Logger(HandoverNotifyProcessor.name);
  private readonly supabase = getSupabaseService();

  constructor(@Optional() private readonly metrics?: MetricsService) {
    super();
  }

  async process(job: Job<HandoverNotifyJobData>): Promise<void> {
    const { conversationId, tenantId, handoverType, contactName, note } = job.data;

    // Validate required fields
    if (!conversationId?.trim() || !tenantId?.trim()) {
      this.logger.warn(
        `handoverNotifyInvalidJob ${JSON.stringify({
          reason: 'missing_required_fields',
          jobId: job.id,
          hasConversationId: !!conversationId?.trim(),
          hasTenantId: !!tenantId?.trim(),
        })}`,
      );
      this.metrics?.emit({
        tenantId: tenantId ?? undefined,
        conversationId: conversationId ?? undefined,
        eventType: 'handover_notify_invalid',
        eventSource: 'handover-notify',
        severity: 'warn',
        metadata: { reason: 'missing_required_fields', jobId: job.id },
      });
      return;
    }

    // Verify conversation exists (graceful on DB failure — skip, don't throw)
    let conv: unknown = null;
    try {
      const result = await this.supabase
        .from('conversations')
        .select('id, contact_id, status')
        .eq('id', conversationId.trim())
        .eq('tenant_id', tenantId.trim())
        .maybeSingle();
      conv = result?.data ?? null;
    } catch {
      // DB unavailable — audit anyway, don't throw
    }

    if (!conv) {
      this.logger.warn(
        `handoverNotifyConversationNotFound ${JSON.stringify({
          conversationId,
          tenantId,
          jobId: job.id,
        })}`,
      );
      this.metrics?.emit({
        tenantId,
        conversationId,
        eventType: 'handover_notify_conversation_not_found',
        eventSource: 'handover-notify',
        severity: 'warn',
        metadata: { jobId: job.id },
      });
      return;
    }

    // Log the handover notification as an audit/metrics event.
    // The actual staff alert is handled by HumanEscalationRuntimeService
    // which uses a deferred-staging-and-flush pattern.
    this.logger.log(
      `handoverNotifyAudit ${JSON.stringify({
        conversationId,
        tenantId,
        handoverType,
        contactName: contactName ?? null,
        contactId: (conv as Record<string, unknown>)['contact_id'] ?? null,
        note: note ?? null,
        jobId: job.id,
        notificationChannel: 'audit_only',
      })}`,
    );

    this.metrics?.emit({
      tenantId,
      conversationId,
      eventType: 'handover_notify_audited',
      eventSource: 'handover-notify',
      severity: 'info',
      metadata: {
        handoverType,
        contactName: contactName ?? null,
        note: note ?? null,
        jobId: job.id,
        notificationChannel: 'audit_only',
      },
    });
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    this.logger.log(`Handover notify job ${job.id} completed`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    this.logger.error(`Handover notify job ${job.id} failed: ${error.message}`);
  }
}
