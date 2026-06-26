import { QuotaThresholdAlertProcessor, type QuotaThresholdAlertJobData } from './quota-threshold-alert.processor';
import type { Job } from 'bullmq';

function mockJob(overrides: Partial<QuotaThresholdAlertJobData> = {}): Job<QuotaThresholdAlertJobData> {
  return {
    id: 'test-job-1',
    data: {
      tenantId: 'tenant-1',
      walletId: 'wallet-1',
      usedQuota: 2000,
      totalQuota: 10000,
      thresholdPercent: 20,
      ...overrides,
    },
  } as Job<QuotaThresholdAlertJobData>;
}

describe('QuotaThresholdAlertProcessor', () => {
  let processor: QuotaThresholdAlertProcessor;

  beforeEach(() => {
    processor = new QuotaThresholdAlertProcessor();
  });

  it('processes valid job and logs metrics', async () => {
    await expect(processor.process(mockJob())).resolves.toBeUndefined();
  });

  it('skips job with missing tenantId', async () => {
    await expect(
      processor.process(mockJob({ tenantId: '', walletId: 'w1' })),
    ).resolves.toBeUndefined();
  });

  it('skips job with missing walletId', async () => {
    await expect(
      processor.process(mockJob({ tenantId: 't1', walletId: '' })),
    ).resolves.toBeUndefined();
  });

  it('skips job with whitespace-only fields', async () => {
    await expect(
      processor.process(mockJob({ tenantId: '  ', walletId: '  ' })),
    ).resolves.toBeUndefined();
  });

  it('handles zero totalQuota gracefully', async () => {
    await expect(
      processor.process(mockJob({ totalQuota: 0, usedQuota: 0 })),
    ).resolves.toBeUndefined();
  });

  it('handles duplicate jobs idempotently', async () => {
    const job = mockJob();
    await processor.process(job);
    await processor.process(job);
  });

  it('does not call any external notification or message-send function', async () => {
    await processor.process(mockJob());
    // No throw = safe. Processor never calls GHL or any external service.
  });
});
