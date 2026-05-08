/**
 * Detect stale build / hashed chunk mismatches seen after deployments or interrupted builds.
 */
export function isProbablyChunkLoadError(err: unknown): boolean {
  const msg =
    typeof err === 'string'
      ? err
      : err instanceof Error
        ? `${err.name} ${err.message}`
        : err != null
          ? String(err)
          : '';
  const m = msg.toLowerCase();
  return (
    m.includes('chunkloaderror') ||
    m.includes('chunk load') ||
    m.includes('loading chunk') ||
    m.includes('loading css chunk') ||
    m.includes('failed to fetch dynamically imported module') ||
    m.includes('importing a module script failed')
  );
}

export const CHUNK_RELOAD_STORAGE_PREFIX = 'aisbp.chunk_reload';
