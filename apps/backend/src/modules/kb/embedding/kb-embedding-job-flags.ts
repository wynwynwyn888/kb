// Fail-closed flags for automatic KB embedding maintenance jobs.
//
// These jobs keep pgvector embeddings in sync with Knowledge Vault writes, but
// they are intentionally disabled by default. Production-like envs require a
// separate exact canary acknowledgement.

export const KB_EMBEDDING_JOBS_PROD_CANARY_ACK = 'YES_ENABLE_KB_EMBEDDING_JOBS_PROD_CANARY';

function runtimeEnvValues(): string[] {
  return [
    process.env['NODE_ENV'],
    process.env['APP_ENV'],
    process.env['RAILWAY_ENVIRONMENT'],
    process.env['VERCEL_ENV'],
  ]
    .map((v) => String(v ?? '').trim().toLowerCase())
    .filter(Boolean);
}

function isStagingLikeEnv(): boolean {
  return runtimeEnvValues().some((v) => v === 'staging' || v === 'stage');
}

function isProductionLikeEnv(): boolean {
  return runtimeEnvValues().some((v) => v === 'production' || v === 'prod');
}

function embeddingJobsRuntimeAllowed(): boolean {
  if (isProductionLikeEnv()) {
    return process.env['KB_EMBEDDING_JOBS_PROD_CANARY_ACK'] === KB_EMBEDDING_JOBS_PROD_CANARY_ACK;
  }
  return isStagingLikeEnv();
}

export function kbEmbeddingJobsEnabledForTenant(tenantId: string): boolean {
  if (!embeddingJobsRuntimeAllowed()) return false;
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
