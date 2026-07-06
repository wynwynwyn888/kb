// Fail-closed flags for automatic KB embedding maintenance jobs.
//
// These jobs keep pgvector embeddings in sync with Knowledge Vault writes, but
// they are intentionally disabled by default and staging-only in this slice.

function isStagingLikeEnv(): boolean {
  const values = [
    process.env['NODE_ENV'],
    process.env['APP_ENV'],
    process.env['RAILWAY_ENVIRONMENT'],
    process.env['VERCEL_ENV'],
  ]
    .map((v) => String(v ?? '').trim().toLowerCase())
    .filter(Boolean);
  return values.some((v) => v === 'staging' || v === 'stage');
}

export function kbEmbeddingJobsEnabledForTenant(tenantId: string): boolean {
  if (!isStagingLikeEnv()) return false;
  if (String(process.env['KB_EMBEDDING_JOBS_ENABLED'] ?? '').trim().toLowerCase() !== 'true') {
    return false;
  }
  const ids = String(process.env['KB_EMBEDDING_JOB_TENANT_IDS'] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.length === 0) return false;
  return ids.includes(tenantId);
}
