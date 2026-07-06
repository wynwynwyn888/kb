import { kbEmbeddingJobsEnabledForTenant } from './kb-embedding-job-flags';

const TENANT = 'stg-rag-tenant';

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) {
    prev[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  try {
    fn();
  } finally {
    for (const k of Object.keys(vars)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

describe('kbEmbeddingJobsEnabledForTenant', () => {
  it('is off by default', () => {
    withEnv(
      { NODE_ENV: 'staging', KB_EMBEDDING_JOBS_ENABLED: undefined, KB_EMBEDDING_JOB_TENANT_IDS: undefined },
      () => expect(kbEmbeddingJobsEnabledForTenant(TENANT)).toBe(false),
    );
  });

  it('is off outside staging even when flags match', () => {
    withEnv(
      {
        NODE_ENV: 'production',
        KB_EMBEDDING_JOBS_ENABLED: 'true',
        KB_EMBEDDING_JOB_TENANT_IDS: TENANT,
        KB_EMBEDDING_JOBS_PROD_CANARY_ACK: undefined,
      },
      () => expect(kbEmbeddingJobsEnabledForTenant(TENANT)).toBe(false),
    );
  });

  it('is off in production when canary acknowledgement is wrong', () => {
    withEnv(
      {
        NODE_ENV: 'production',
        KB_EMBEDDING_JOBS_ENABLED: 'true',
        KB_EMBEDDING_JOB_TENANT_IDS: TENANT,
        KB_EMBEDDING_JOBS_PROD_CANARY_ACK: 'yes',
      },
      () => expect(kbEmbeddingJobsEnabledForTenant(TENANT)).toBe(false),
    );
  });

  it('can be enabled for a production canary only with exact acknowledgement and allowlist', () => {
    withEnv(
      {
        NODE_ENV: 'production',
        KB_EMBEDDING_JOBS_ENABLED: 'true',
        KB_EMBEDDING_JOB_TENANT_IDS: TENANT,
        KB_EMBEDDING_JOBS_PROD_CANARY_ACK: 'YES_ENABLE_KB_EMBEDDING_JOBS_PROD_CANARY',
      },
      () => {
        expect(kbEmbeddingJobsEnabledForTenant(TENANT)).toBe(true);
        expect(kbEmbeddingJobsEnabledForTenant('other-tenant')).toBe(false);
      },
    );
  });

  it('fails closed when allowlist is empty', () => {
    withEnv(
      { NODE_ENV: 'staging', KB_EMBEDDING_JOBS_ENABLED: 'true', KB_EMBEDDING_JOB_TENANT_IDS: '' },
      () => expect(kbEmbeddingJobsEnabledForTenant(TENANT)).toBe(false),
    );
  });

  it('is on only for an explicitly allowlisted staging tenant', () => {
    withEnv(
      { NODE_ENV: 'staging', KB_EMBEDDING_JOBS_ENABLED: 'true', KB_EMBEDDING_JOB_TENANT_IDS: `other,${TENANT}` },
      () => {
        expect(kbEmbeddingJobsEnabledForTenant(TENANT)).toBe(true);
        expect(kbEmbeddingJobsEnabledForTenant('other-tenant')).toBe(false);
      },
    );
  });
});
