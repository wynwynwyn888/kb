import { describe, expect, it } from 'vitest';
import { isProbablyChunkLoadError } from './chunk-load-recovery';

describe('isProbablyChunkLoadError', () => {
  it('detects ChunkLoadError by name/message', () => {
    expect(isProbablyChunkLoadError(new Error('Loading chunk 123 failed'))).toBe(true);
    expect(isProbablyChunkLoadError(new Error('ChunkLoadError'))).toBe(true);
    expect(isProbablyChunkLoadError('Failed to fetch dynamically imported module: ...')).toBe(true);
  });

  it('does not treat generic errors as chunk errors', () => {
    expect(isProbablyChunkLoadError(new Error('Unauthorized'))).toBe(false);
    expect(isProbablyChunkLoadError(null)).toBe(false);
  });
});
