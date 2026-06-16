// Quota Threshold Alert Processor
// Alerts when quota usage reaches threshold
// TODO: Implement full alert logic

import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUES } from '../queue.constants';

export interface QuotaThresholdAlertJobData {
  tenantId: string;
  walletId: string;
  usedQuota: number;
  totalQuota: number;
  thresholdPercent: number;
}

@Processor(QUEUES.QUOTA_THRESHOLD_ALERT)
export class QuotaThresholdAlertProcessor extends WorkerHost {
  private readonly logger = new Logger(QuotaThresholdAlertProcessor.name);

  async process(job: Job<QuotaThresholdAlertJobData>): Promise<void> {
    this.logger.warn(
      `quotaThresholdAlertSkipped ${JSON.stringify({
        reason: 'processor_not_implemented',
        tenantId: job.data.tenantId,
        thresholdPercent: job.data.thresholdPercent,
      })}`,
    );
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    console.log(`Quota threshold alert job ${job.id} completed`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    console.error(`Quota threshold alert job ${job.id} failed:`, error.message);
  }
}