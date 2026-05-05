import { computeOrchestrateQueueWaitMs, MAX_ORCHESTRATE_QUEUE_WAIT_MS } from './orchestrate-queue-timing';

describe('computeOrchestrateQueueWaitMs', () => {
  it('returns rounded positive delta when sane', () => {
    expect(computeOrchestrateQueueWaitMs(10_050, 10_000)).toBe(50);
  });

  it('returns null when enqueue time missing', () => {
    expect(computeOrchestrateQueueWaitMs(10_000, null)).toBeNull();
    expect(computeOrchestrateQueueWaitMs(10_000, undefined)).toBeNull();
  });

  it('returns null on negative or implausibly large delta (clock skew / stale ts)', () => {
    expect(computeOrchestrateQueueWaitMs(10_000, 10_050)).toBeNull();
    expect(computeOrchestrateQueueWaitMs(10_000 + MAX_ORCHESTRATE_QUEUE_WAIT_MS + 1, 10_000)).toBeNull();
  });
});
