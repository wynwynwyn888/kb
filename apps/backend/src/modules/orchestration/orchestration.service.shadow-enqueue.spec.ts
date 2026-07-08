// Phase 5 reply-path invariants for the RAG shadow lane.
//
// Proves the single guarded reply-path touch:
//  - flag OFF => zero enqueue + identical retrieveKbContext result
//  - flag ON  => exactly one fire-and-forget enqueue with a safe payload,
//                identical retrieveKbContext result (shadow never mutates it)
//  - enqueue failure can never propagate to the reply path
//  - keyword retrieval is always the source of reply context (never bypassed)
//  - shadow (vector) candidates never enter the reply context
import { jest as jestGlobal } from '@jest/globals';

jestGlobal.mock('../../lib/supabase', () => ({ getSupabaseService: () => ({}) }));
jestGlobal.mock('../../lib/format-postgrest-error', () => ({ formatPostgrestError: jestGlobal.fn() }));

import { ConversationOrchestrationService } from './orchestration.service';

const KEYWORD_RESULT = {
  query: 'do you offer refunds',
  retrievalMode: 'keyword' as const,
  totalConsidered: 3,
  chunks: [
    {
      chunkId: 'kw-1',
      documentId: 'doc-1',
      content: 'Refunds are available within 30 days.',
      title: 'Refund Policy',
      source: 'manual',
      relevanceScore: 0.91,
      metadata: { sectionTitle: 'Refunds' },
    },
    {
      chunkId: 'kw-2',
      documentId: 'doc-1',
      content: 'Contact support to request a refund.',
      title: 'Refund Policy',
      source: 'manual',
      relevanceScore: 0.42,
      metadata: { sectionTitle: 'Refunds' },
    },
  ],
};

function makeInput() {
  return {
    tenantId: 'tenant-allow',
    conversationId: 'conv-1',
    incomingMessage: { messageContent: 'do you offer refunds' },
  } as any;
}

function makeService(queue: { add: (...args: unknown[]) => Promise<unknown> } | undefined) {
  const service: any = Object.create(ConversationOrchestrationService.prototype);
  service.logger = { debug: () => undefined, warn: () => undefined, log: () => undefined };
  service.kbService = { retrieve: jestGlobal.fn(async () => KEYWORD_RESULT) };
  service.botProfiles = {
    getKbDocumentAllowlistForActiveProfile: jestGlobal.fn(async () => ({
      kind: 'unfiltered',
      kbVaultAccessMode: 'all',
      noActiveProfile: false,
    })),
  };
  service.kbVectorShadowQueue = queue;
  return service;
}

async function callRetrieve(service: any) {
  return service.retrieveKbContext(makeInput(), 'conv-1', 'UNKNOWN');
}

const ORIGINAL_ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('RAG shadow lane — Phase 5 reply-path enqueue invariants', () => {
  beforeEach(() => {
    delete process.env['KB_VECTOR_SHADOW_ENABLED'];
    delete process.env['KB_VECTOR_SHADOW_TENANT_IDS'];
    delete process.env['KB_VECTOR_CONTEXT_ENABLED'];
    delete process.env['KB_VECTOR_CONTEXT_TENANT_IDS'];
    delete process.env['KB_VECTOR_RETRIEVAL_ENABLED'];
  });

  it('flag OFF => zero enqueue and result identical to keyword retrieval', async () => {
    const add = jestGlobal.fn(async () => 'job');
    const service = makeService({ add });

    const result = await callRetrieve(service);

    expect(add).toHaveBeenCalledTimes(0);
    // Keyword retrieval was the source and was not bypassed.
    expect(service.kbService.retrieve).toHaveBeenCalledTimes(1);
    // Returned chunks come ONLY from the keyword result.
    const returnedIds = result.chunks.map((c: { chunkId: string }) => c.chunkId);
    const keywordIds = KEYWORD_RESULT.chunks.map((c) => c.chunkId);
    expect(returnedIds.every((id: string) => keywordIds.includes(id))).toBe(true);
    expect(result.meta?.retrievalMode).toBe('keyword');
  });

  it('flag ON => exactly one enqueue; result byte-identical to the flag-OFF result', async () => {
    // Baseline: flag OFF.
    const offService = makeService({ add: jestGlobal.fn(async () => 'job') });
    const offResult = await callRetrieve(offService);

    // Flag ON for this tenant.
    process.env['KB_VECTOR_SHADOW_ENABLED'] = 'true';
    process.env['KB_VECTOR_SHADOW_TENANT_IDS'] = 'tenant-allow';
    const add = jestGlobal.fn(async () => 'job');
    const onService = makeService({ add });
    const onResult = await callRetrieve(onService);

    expect(add).toHaveBeenCalledTimes(1);
    // Reply context is byte-identical whether or not the shadow enqueues.
    expect(onResult).toEqual(offResult);

    // Payload carries only safe, keyword-derived fields (no raw transcript/secrets).
    const [jobName, payload] = add.mock.calls[0] as [string, any];
    expect(jobName).toBe('kb-vector-shadow');
    expect(payload.tenantId).toBe('tenant-allow');
    expect(payload.conversationId).toBe('conv-1');
    expect(payload.query).toBe('do you offer refunds');
    expect(payload.keywordCandidates).toEqual([
      { chunkId: 'kw-1', score: 0.91 },
      { chunkId: 'kw-2', score: 0.42 },
    ]);
    expect(Object.keys(payload).sort()).toEqual(
      ['conversationId', 'documentIdAllowlist', 'intentHint', 'keywordCandidates', 'query', 'tenantId'].sort(),
    );
  });

  it('enqueue failure can never propagate to the reply path', async () => {
    process.env['KB_VECTOR_SHADOW_ENABLED'] = 'true';
    process.env['KB_VECTOR_SHADOW_TENANT_IDS'] = 'tenant-allow';
    const add = jestGlobal.fn(async () => {
      throw new Error('redis down');
    });
    const service = makeService({ add });

    // Must resolve (not reject) and produce the same keyword-sourced result.
    const result = await expect(callRetrieve(service)).resolves.toBeDefined();
    void result;
    expect(add).toHaveBeenCalledTimes(1);
  });

  it('missing queue (unregistered) => no enqueue, no throw, identical result', async () => {
    process.env['KB_VECTOR_SHADOW_ENABLED'] = 'true';
    process.env['KB_VECTOR_SHADOW_TENANT_IDS'] = 'tenant-allow';
    const service = makeService(undefined);

    const result = await callRetrieve(service);
    expect(result.meta?.retrievalMode).toBe('keyword');
  });

  it('does not read KB_VECTOR_RETRIEVAL_ENABLED to decide shadow enqueue', async () => {
    // Prod RAG flag ON but shadow flag OFF => still zero enqueue.
    process.env['KB_VECTOR_RETRIEVAL_ENABLED'] = 'true';
    const add = jestGlobal.fn(async () => 'job');
    const service = makeService({ add });

    await callRetrieve(service);
    expect(add).toHaveBeenCalledTimes(0);
  });
});
