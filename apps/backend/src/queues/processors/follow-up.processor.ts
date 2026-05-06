import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { QUEUES } from '../queue.constants';
import { FollowUpEngineService, type FollowUpProcessorJob } from '../../modules/follow-up-engine/follow-up-engine.service';

@Processor(QUEUES.FOLLOW_UP)
@Injectable()
export class FollowUpProcessor extends WorkerHost {
  private readonly logger = new Logger(FollowUpProcessor.name);

  constructor(private readonly engine: FollowUpEngineService) {
    super();
  }

  async process(job: Job<FollowUpProcessorJob>): Promise<void> {
    const data = job.data;
    if (!data || typeof data !== 'object') return;
    if (data.kind !== 'send_step') return;
    await this.engine.processFollowUpJob(data.followUpJobId);
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    this.logger.log(`Follow-up job ${job.id} completed`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    this.logger.error(`Follow-up job ${job.id} failed: ${error.message}`);
  }
}

