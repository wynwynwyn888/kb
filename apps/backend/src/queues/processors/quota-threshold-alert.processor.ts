// Quota Threshold Alert Processor
// Processes quota threshold alert jobs from the queue.
//
// IMPORTANT: This processor does NOT send external notifications (email, SMS, etc.).
// Quota warnings are handled by CreditWarningsService which fires on debit with
// a non-blocking fire-and-forget pattern. That path is already production-tested.
//
// This processor serves as an audit/logging endpoint for quota threshold events
// enqueued through the BullMQ pipeline. It validates the job payload and writes
// metrics entries. If a future notification channel is added, it should be wired
// here with appropriate anti-spam guards.

import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUES } from '../queue.constants';
import { MetricsService } from '../../lib/metrics.service';

export interface QuotaThresholdAlertJobData {
  tenantId: string;
  walletId: string;
  usedQuota: number;
  totalQuota: number;
  thresholdPercent: number;
}

@Processor(QUEUES.QUOTA_THRESHOLD_ALERT)
@Injectable()
export class QuotaThresholdAlertProcessor extends WorkerHost {
  private readonly logger = new Logger(QuotaThresholdAlertProcessor.name);

  constructor(@Optional() private readonly metrics?: MetricsService) {
    super();
  }

  async process(job: Job<QuotaThresholdAlertJobData>): Promise<void> {
    const { tenantId, walletId, usedQuota, totalQuota, thresholdPercent } = job.data;

    if (!tenantId?.trim() || !walletId?.trim()) {
      this.logger.warn(
        `quotaThresholdAlertInvalid ${JSON.stringify({
          reason: 'missing_required_fields',
          jobId: job.id,
          hasTenantId: !!tenantId?.trim(),
          hasWalletId: !!walletId?.trim(),
        })}`,
      );
      this.metrics?.emit({
        tenantId: tenantId ?? undefined,
        eventType: 'quota_threshold_alert_invalid',
        eventSource: 'quota-threshold-alert',
        severity: 'warn',
        metadata: { reason: 'missing_required_fields', jobId: job.id },
      });
      return;
    }

    const usagePercent = totalQuota > 0
      ? Math.round((usedQuota / totalQuota) * 100)
      : 0;

    this.logger.log(
      `quotaThresholdAlertAudit ${JSON.stringify({
        tenantId,
        walletId,
        usedQuota,
        totalQuota,
        thresholdPercent,
        usagePercent,
        jobId: job.id,
        notificationChannel: 'audit_only',
      })}`,
    );

    this.metrics?.emit({
      tenantId,
      eventType: 'quota_threshold_alert_audited',
      eventSource: 'quota-threshold-alert',
      severity: 'info',
      metadata: {
        walletId,
        usedQuota,
        totalQuota,
        thresholdPercent,
        usagePercent,
        jobId: job.id,
        notificationChannel: 'audit_only',
      },
    });
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    this.logger.log(`Quota threshold alert job ${job.id} completed`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    this.logger.error(`Quota threshold alert job ${job.id} failed: ${error.message}`);
  }
}
