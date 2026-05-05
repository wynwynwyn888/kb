/** Ignore impossible deltas (clock skew, stale/missing enqueue timestamps). */
export const MAX_ORCHESTRATE_QUEUE_WAIT_MS = 120_000;

/**
 * Milliseconds from inbound worker enqueue of the debounced orchestrate Bull job until the
 * orchestrate worker begins processing (approximately includes debounce delay + queue jitter).
 */
export function computeOrchestrateQueueWaitMs(
  orchestrateWorkerStartWallMs: number,
  orchestrateEnqueuedWallMs?: number | null,
): number | null {
  if (orchestrateEnqueuedWallMs == null || !Number.isFinite(orchestrateEnqueuedWallMs)) {
    return null;
  }
  const delta = orchestrateWorkerStartWallMs - orchestrateEnqueuedWallMs;
  if (!Number.isFinite(delta) || delta < 0 || delta > MAX_ORCHESTRATE_QUEUE_WAIT_MS) {
    return null;
  }
  return Math.round(delta);
}
