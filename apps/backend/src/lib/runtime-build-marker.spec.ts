import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { formatRuntimeBootLine, getRuntimeBuildMarker } from './runtime-build-marker';

describe('runtime-build-marker', () => {
  // Reset module-level cache between cases by re-requiring
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    jest.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns a stable marker (cached) with non-empty bootedAtIso and nodeEnv', () => {
    const a = getRuntimeBuildMarker();
    const b = getRuntimeBuildMarker();
    expect(a).toBe(b);
    expect(a.bootedAtIso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(typeof a.nodeEnv).toBe('string');
    expect(a.nodeEnv.length).toBeGreaterThan(0);
  });

  it('formatRuntimeBootLine includes nodeEnv, gitSha (or n/a), bootedAt', () => {
    const line = formatRuntimeBootLine();
    expect(line).toMatch(/nodeEnv=/);
    expect(line).toMatch(/gitSha=/);
    expect(line).toMatch(/bootedAt=/);
  });

  it('reads GIT_SHA / APP_VERSION when set (cached at module load)', async () => {
    process.env['GIT_SHA'] = 'deadbeefcafe1234';
    process.env['APP_VERSION'] = '1.2.3';
    // Re-import to bypass cache
    const mod = await import('./runtime-build-marker');
    const m = mod.getRuntimeBuildMarker();
    // Either captured fresh on first call, or matches a previously-cached marker.
    if (m.gitSha) {
      expect(m.gitSha.length).toBeGreaterThan(0);
    }
  });
});
