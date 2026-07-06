import { jest as jestGlobal } from '@jest/globals';

jestGlobal.mock('@aisbp/types', () =>
  jestGlobal.requireActual('../../../../../../packages/types/src/ai-provider-registry.ts'),
);

import {
  resolveOpenAiEmbeddingCredentials,
  type SupabaseLikeClient,
} from './openai-key.resolver';

/**
 * Minimal stub matching the structural SupabaseLikeClient. Returns canned rows
 * per (table, filter) without any network/DB access.
 */
function makeStub(rows: {
  tenant?: { agency_id: string | null } | null;
  provider?: { api_key: string | null; endpoint?: string | null } | null;
}): SupabaseLikeClient {
  return {
    from(table: string) {
      return {
        select() {
          const builder = {
            eq() {
              return builder;
            },
            async maybeSingle() {
              if (table === 'tenants') return { data: rows.tenant ?? null, error: null };
              if (table === 'agency_model_providers')
                return { data: rows.provider ?? null, error: null };
              return { data: null, error: null };
            },
          };
          return builder;
        },
      };
    },
  };
}

describe('openai-key.resolver', () => {
  it('resolves usable credentials with endpoint', async () => {
    const stub = makeStub({
      tenant: { agency_id: 'agency-1' },
      provider: { api_key: 'sk-live-realkey', endpoint: 'https://proxy.example/v1' },
    });
    const res = await resolveOpenAiEmbeddingCredentials(stub, 'tenant-1');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.credentials.apiKey).toBe('sk-live-realkey');
      expect(res.credentials.endpoint).toBe('https://proxy.example/v1');
    }
  });

  it('returns null endpoint when none configured', async () => {
    const stub = makeStub({
      tenant: { agency_id: 'agency-1' },
      provider: { api_key: 'sk-live-realkey', endpoint: null },
    });
    const res = await resolveOpenAiEmbeddingCredentials(stub, 'tenant-1');
    expect(res.ok && res.credentials.endpoint).toBeNull();
  });

  it('fails closed when tenant has no agency', async () => {
    const stub = makeStub({ tenant: { agency_id: null } });
    const res = await resolveOpenAiEmbeddingCredentials(stub, 'tenant-1');
    expect(res).toEqual({ ok: false, reason: 'no_agency' });
  });

  it('fails when no OPENAI provider row exists', async () => {
    const stub = makeStub({ tenant: { agency_id: 'agency-1' }, provider: null });
    const res = await resolveOpenAiEmbeddingCredentials(stub, 'tenant-1');
    expect(res).toEqual({ ok: false, reason: 'no_openai_row' });
  });

  it('rejects unusable/placeholder keys', async () => {
    const stub = makeStub({
      tenant: { agency_id: 'agency-1' },
      provider: { api_key: 'sk-test-placeholder' },
    });
    const res = await resolveOpenAiEmbeddingCredentials(stub, 'tenant-1');
    expect(res).toEqual({ ok: false, reason: 'unusable_key' });
  });
});
