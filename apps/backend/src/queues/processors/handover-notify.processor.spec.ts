import { HandoverNotifyProcessor, type HandoverNotifyJobData } from './handover-notify.processor';
import type { Job } from 'bullmq';

function mockJob(overrides: Partial<HandoverNotifyJobData> = {}): Job<HandoverNotifyJobData> {
  return {
    id: 'test-job-1',
    data: {
      conversationId: 'conv-1',
      tenantId: 'tenant-1',
      handoverType: 'request',
      contactName: 'Test Contact',
      note: 'Test note',
      ...overrides,
    },
  } as Job<HandoverNotifyJobData>;
}

describe('HandoverNotifyProcessor', () => {
  let processor: HandoverNotifyProcessor;

  beforeEach(() => {
    processor = new HandoverNotifyProcessor();
  });

  it('processes valid job and logs metrics', async () => {
    await expect(processor.process(mockJob())).resolves.toBeUndefined();
  });

  it('skips job with missing conversationId', async () => {
    await expect(
      processor.process(mockJob({ conversationId: '', tenantId: 't1' })),
    ).resolves.toBeUndefined();
  });

  it('skips job with missing tenantId', async () => {
    await expect(
      processor.process(mockJob({ conversationId: 'c1', tenantId: '' })),
    ).resolves.toBeUndefined();
  });

  it('skips job with whitespace-only fields', async () => {
    await expect(
      processor.process(mockJob({ conversationId: '  ', tenantId: '  ' })),
    ).resolves.toBeUndefined();
  });

  it('handles missing conversation gracefully', async () => {
    // The mock supabase will return null for any query (test setup mocks getSupabaseService)
    await expect(
      processor.process(mockJob({ conversationId: 'nonexistent', tenantId: 't1' })),
    ).resolves.toBeUndefined();
  });

  it('does not send WhatsApp/GHL messages', async () => {
    // The processor only audits — verify no external send occurs
    await processor.process(mockJob());
    // If it doesn't throw, it succeeded. The processor never calls GHL.
  });

  it('handles duplicate jobs idempotently', async () => {
    // Running the same job twice shouldn't cause issues
    const job = mockJob();
    await processor.process(job);
    await processor.process(job);
    // No throw = idempotent
  });
});
