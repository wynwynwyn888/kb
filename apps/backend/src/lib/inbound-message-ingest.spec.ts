import { jest as jestGlobal } from '@jest/globals';
import { ingestInboundMessage, computeContentFingerprint } from './inbound-message-ingest';

type Response = { data: unknown; error: unknown };

// Chainable mock builder that supports:
//   .eq().filter().maybeSingle()  (Tier 1, Tier 2, upgrade)
//   .eq().eq().gte().order().limit()  (Tier 2.5 cross-path)
function buildChain(responses: Response[], crossPathRes?: Response | null) {
  let i = 0;

  const maybeSingle = jestGlobal.fn(async () => {
    const r = responses[i] ?? { data: null, error: null };
    i++;
    return r;
  });

  let crossPathCalled = false;
  const limitFn = jestGlobal.fn(async () => {
    crossPathCalled = true;
    const r = crossPathRes ?? { data: null, error: null };
    // Supabase .limit() returns { data: rows[], error: null }
    return { data: r.data ? [r.data] : [], error: null };
  });

  // Fluid builder: all methods available on the same object, each returns a fluent chain
  function makeFluent(): Record<string, jestGlobal.Mock> {
    const chain: Record<string, jestGlobal.Mock> = {
      eq: jestGlobal.fn((_k: string, _v: string) => chain),
      filter: jestGlobal.fn((_k: string, _op: string, _v: string) => chain),
      gte: jestGlobal.fn((_k: string, _v: string) => chain),
      order: jestGlobal.fn((_k: string, _opts?: unknown) => chain),
      limit: limitFn,
      maybeSingle,
    };
    return chain;
  }

  return {
    fluent: makeFluent(),
    getCrossPathCalled: () => crossPathCalled,
    getCallCount: () => i,
  };
}

function makeSupabase(
  responses: Response[],
  insertError?: { message: string; code: string } | null,
  crossPathResponse?: Response | null,
) {
  const chain = buildChain(responses, crossPathResponse);

  return {
    crossPathWasCalled: chain.getCrossPathCalled,
    callCount: chain.getCallCount,
    from: jestGlobal.fn((_table: string) => ({
      select: jestGlobal.fn((_cols: string) => chain.fluent),
      insert: jestGlobal.fn((_data: unknown) => ({
        select: jestGlobal.fn(() => ({
          single: jestGlobal.fn(async () => {
            if (insertError) return { data: null, error: insertError };
            return { data: { id: 'new-id-' + Date.now() }, error: null };
          }),
        })),
      })),
      update: jestGlobal.fn(() => ({ eq: jestGlobal.fn(() => ({})) })),
    })),
  };
}

function R(id: string | null, meta?: Record<string, unknown>): Response {
  if (!id) return { data: null, error: null };
  return { data: { id, metadata: meta ?? {} }, error: null };
}

function insertConflict(): Response {
  // Simulate DB error then re-query finding the row
  return { data: null, error: { message: 'duplicate key value violates unique constraint "idx_messages_dedupe_ghl_message"', code: '23505' } };
}

function insertSuccess(id: string): Response {
  return { data: { id }, error: null };
}

function makeParams(overrides: Partial<Parameters<typeof ingestInboundMessage>[0]> = {}) {
  return {
    supabase: undefined as never,
    conversationId: 'conv-1',
    tenantId: 't1',
    direction: 'INBOUND' as const,
    sender: 'CONTACT',
    content: 'Hello, I need help',
    contentType: 'TEXT',
    ingestSource: 'webhook' as const,
    ...overrides,
  };
}

describe('ingestInboundMessage', () => {
  describe('tier 1 — ghlMessageId dedupe', () => {
    it('inserts new message when ghlMessageId is not found', async () => {
      const supabase = makeSupabase([R(null)]);
      const result = await ingestInboundMessage(makeParams({ supabase, ghlMessageId: 'ghl-msg-123' }));
      expect(result.inserted).toBe(true);
    });

    it('dedupes when ghlMessageId already exists', async () => {
      const supabase = makeSupabase([R('exist-1', { ghlMessageId: 'ghl-msg-123' })]);
      const result = await ingestInboundMessage(makeParams({ supabase, ghlMessageId: 'ghl-msg-123' }));
      expect(result.inserted).toBe(false);
      expect(result.duplicate).toBe(true);
      expect(result.messageId).toBe('exist-1');
    });
  });

  describe('tier 2 — contentFingerprint fallback', () => {
    it('dedupes by fingerprint when no ghlMessageId', async () => {
      // null ghlMessageId → skip tier 1 → one call to fingerprint lookup
      const supabase = makeSupabase([R('fp-1')]);
      const result = await ingestInboundMessage(makeParams({ supabase, ghlMessageId: null }));
      expect(result.inserted).toBe(false);
      expect(result.duplicate).toBe(true);
    });

    it('inserts when fingerprint does not match', async () => {
      const supabase = makeSupabase([R(null)]);
      const result = await ingestInboundMessage(makeParams({ supabase, ghlMessageId: null }));
      expect(result.inserted).toBe(true);
    });
  });

  describe('tier 3 — fallback upgrade', () => {
    it('upgrades fallback row when sync discovers real ghlMessageId', async () => {
      // ghlMessageId not found → then fingerprint match with no ghlMessageId
      const supabase = makeSupabase([R(null), R('fallback-1', {})]);
      const result = await ingestInboundMessage(makeParams({ supabase, ghlMessageId: 'real-ghl-id' }));
      expect(result.inserted).toBe(false);
      expect(result.upgraded).toBe(true);
      expect(result.messageId).toBe('fallback-1');
    });

    it('does not upgrade when already has same ghlMessageId', async () => {
      const supabase = makeSupabase([R('exist-1', { ghlMessageId: 'real-ghl-id' })]);
      const result = await ingestInboundMessage(makeParams({ supabase, ghlMessageId: 'real-ghl-id' }));
      expect(result.inserted).toBe(false);
      expect(result.duplicate).toBe(true);
      expect(result.upgraded).toBe(false);
    });
  });

  describe('fingerprint conflict', () => {
    it('returns fingerprintConflict when different real ghlMessageIds', async () => {
      const supabase = makeSupabase([R(null), R('fp-1', { ghlMessageId: 'different-id' })]);
      const result = await ingestInboundMessage(makeParams({ supabase, ghlMessageId: 'new-id' }));
      expect(result.inserted).toBe(false);
      expect(result.fingerprintConflict).toBe(true);
    });
  });

  describe('DB-level unique constraint conflict', () => {
    it('handles insert conflict by re-querying existing row by ghlMessageId', async () => {
      // ghlMessageId not found in pre-check → then insert → conflict → re-query finds existing
      const supabase = makeSupabase(
        [R(null)],                                    // tier 1: ghlMessageId not found
        { message: 'duplicate key value', code: '23505' }, // insert error
      );
      // After insert conflict, re-query by ghlMessageId should find the row
      // We add another response to the response array for the re-query
      // But the mock only has 1 response... adjust makeSupabase
      // For now, test that the insert error path works with the last response
      // The re-query will get the same maybeSingle (first response = R(null) which is wrong)
      // Actually the code queries ghlMessageId first, then fingerprint.
      // After conflict, both re-queries happen. We need more responses.
      const supabase2 = makeSupabase(
        [R(null), R(null), R('conflict-row', { ghlMessageId: 'ghl-msg-123' })], // pre-check (not found), pre-check fp (not found), re-query after conflict (found)
        { message: 'duplicate key value violates unique constraint', code: '23505' },
      );
      const result = await ingestInboundMessage(makeParams({ supabase: supabase2, ghlMessageId: 'ghl-msg-123' }));
      expect(result.inserted).toBe(false);
      expect(result.duplicate).toBe(true);
      expect(result.messageId).toBe('conflict-row');
    });

    it('handles insert conflict with fingerprint fallback re-query', async () => {
      const supabase = makeSupabase(
        [R(null), R(null), R(null), R('fp-conflict-row')], // pre-checks, ghl re-query null, fp re-query found
        { message: 'duplicate key', code: '23505' },
      );
      const result = await ingestInboundMessage(makeParams({ supabase, ghlMessageId: 'ghl-msg-123' }));
      expect(result.inserted).toBe(false);
      expect(result.duplicate).toBe(true);
      expect(result.messageId).toBe('fp-conflict-row');
    });

    it('throws on non-unique-constraint insert error', async () => {
      const supabase = makeSupabase(
        [R(null)],
        { message: 'could not connect to database', code: 'PGRST000' },
      );
      await expect(
        ingestInboundMessage(makeParams({ supabase, ghlMessageId: 'ghl-msg-123' })),
      ).rejects.toThrow('ingestInboundMessage insert failed');
    });
  });

  describe('null ghlMessageId — not blocked by unique index', () => {
    it('inserts successfully when ghlMessageId is null (fallback path)', async () => {
      const supabase = makeSupabase([R(null)]);
      const result = await ingestInboundMessage(makeParams({ supabase, ghlMessageId: null }));
      expect(result.inserted).toBe(true);
    });
  });

  describe('ghlTimestamp validation', () => {
    it('accepts valid ISO timestamp as created_at', async () => {
      let insertedRow: Record<string, unknown> | null = null;
      const supabase = makeSupabase([R(null)]);
      // Override the insert mock to capture the row
      const origFrom = supabase.from;
      supabase.from = jestGlobal.fn((table: string) => {
        const result = origFrom(table);
        if (table === 'messages') {
          const origInsert = (result as any).insert;
          (result as any).insert = jestGlobal.fn((row: Record<string, unknown>) => {
            insertedRow = row;
            return { select: () => ({ single: async () => ({ data: { id: 'test-id' }, error: null }) }) };
          });
        }
        return result;
      });
      const result = await ingestInboundMessage(makeParams({
        supabase, ghlTimestamp: '2026-07-02T03:55:00.000Z',
      }));
      expect(result.inserted).toBe(true);
      expect(insertedRow?.['created_at']).toBe('2026-07-02T03:55:00.000Z');
    });

    it('omits created_at when ghlTimestamp is HH:MM only (DB default now())', async () => {
      let insertedRow: Record<string, unknown> | null = null;
      const supabase = makeSupabase([R(null)]);
      const origFrom = supabase.from;
      supabase.from = jestGlobal.fn((table: string) => {
        const result = origFrom(table);
        if (table === 'messages') {
          const origInsert = (result as any).insert;
          (result as any).insert = jestGlobal.fn((row: Record<string, unknown>) => {
            insertedRow = row;
            return { select: () => ({ single: async () => ({ data: { id: 'test-id' }, error: null }) }) };
          });
        }
        return result;
      });
      const result = await ingestInboundMessage(makeParams({
        supabase, ghlTimestamp: '11:54',
      }));
      expect(result.inserted).toBe(true);
      expect(insertedRow?.['created_at']).toBeUndefined();
      expect(insertedRow?.['metadata']?.ghlTimestamp).toBeUndefined();
      expect(insertedRow?.['metadata']?.ghlTimestampRaw).toBe('11:54');
    });

    it('metadata.ghlTimestamp is present for valid ISO', async () => {
      let insertedRow: Record<string, unknown> | null = null;
      const supabase = makeSupabase([R(null)]);
      const origFrom = supabase.from;
      supabase.from = jestGlobal.fn((table: string) => {
        const result = origFrom(table);
        if (table === 'messages') {
          (result as any).insert = jestGlobal.fn((row: Record<string, unknown>) => {
            insertedRow = row;
            return { select: () => ({ single: async () => ({ data: { id: 'test-id' }, error: null }) }) };
          });
        }
        return result;
      });
      await ingestInboundMessage(makeParams({ supabase, ghlTimestamp: '2026-07-02T03:55:00Z' }));
      expect(insertedRow?.['metadata']?.ghlTimestamp).toBe('2026-07-02T03:55:00Z');
      expect(insertedRow?.['metadata']?.ghlTimestampRaw).toBe('2026-07-02T03:55:00Z');
    });

    it('falls back when ghlTimestamp is empty string', async () => {
      const supabase = makeSupabase([R(null)]);
      const result = await ingestInboundMessage(makeParams({ supabase, ghlTimestamp: '' }));
      expect(result.inserted).toBe(true);
    });

    it('falls back when ghlTimestamp is null', async () => {
      const supabase = makeSupabase([R(null)]);
      const result = await ingestInboundMessage(makeParams({ supabase, ghlTimestamp: null }));
      expect(result.inserted).toBe(true);
    });

    it('falls back when ghlTimestamp is invalid string', async () => {
      const supabase = makeSupabase([R(null)]);
      const result = await ingestInboundMessage(makeParams({ supabase, ghlTimestamp: 'not-a-date' }));
      expect(result.inserted).toBe(true);
    });
  });

  describe('contentFingerprint stability', () => {
    it('same content same minute → same fingerprint', () => {
      const p1 = makeParams({ ghlTimestamp: '2026-07-01T12:51:05Z', content: 'Hello' });
      const p2 = makeParams({ ghlTimestamp: '2026-07-01T12:51:55Z', content: 'Hello' });
      expect(computeContentFingerprint(p1)).toBe(computeContentFingerprint(p2));
    });

    it('same content different minute → different fingerprint', () => {
      const p1 = makeParams({ ghlTimestamp: '2026-07-01T12:51:00Z', content: 'Hello' });
      const p2 = makeParams({ ghlTimestamp: '2026-07-01T12:52:00Z', content: 'Hello' });
      expect(computeContentFingerprint(p1)).not.toBe(computeContentFingerprint(p2));
    });

    it('different content → different fingerprint', () => {
      const p1 = makeParams({ content: 'Hello' });
      const p2 = makeParams({ content: 'World' });
      expect(computeContentFingerprint(p1)).not.toBe(computeContentFingerprint(p2));
    });
  });

  describe('tier 2.5 — cross-path dedupe (same content, different timestamp/fingerprint)', () => {
    const STAFF_MSG = 'I already have staff replying to WhatsApp, why do I need this?';
    const CHATGPT_MSG = 'Can I just use ChatGPT?';
    const SAME_TS = '2026-07-02T16:25:31.000Z';

    it('skips when same content + same GHL timestamp (within 5s)', async () => {
      // Both paths have same ghlTimestamp → same original GHL message → dedupe
      const supabase = makeSupabase(
        [R(null), R(null)],  // Tier 1 miss, Tier 2 miss
        null,
        R('existing-msg-id', { ghlTimestamp: SAME_TS }), // cross-path: found with same ts
      );
      const result = await ingestInboundMessage(makeParams({
        supabase,
        ghlMessageId: null,
        ingestSource: 'ghl-sync',
        ghlTimestamp: SAME_TS,
        content: STAFF_MSG,
      }));
      expect(result.inserted).toBe(false);
      expect(result.skippedCrossPathDuplicate).toBe(true);
      expect(result.messageId).toBe('existing-msg-id');
      expect(supabase.crossPathWasCalled()).toBe(true);
    });

    it('allows when same content + different GHL timestamp (2 min later)', async () => {
      // Different timestamp → genuinely new user message → allowed
      const supabase = makeSupabase(
        [R(null), R(null)],
        null,
        R('existing-msg-id', { ghlTimestamp: '2026-07-02T16:23:48.000Z' }), // 103s earlier
      );
      const result = await ingestInboundMessage(makeParams({
        supabase,
        ghlMessageId: null,
        ingestSource: 'webhook',
        ghlTimestamp: '2026-07-02T16:25:31.000Z',
        content: STAFF_MSG,
      }));
      expect(result.inserted).toBe(true);
      expect(result.skippedCrossPathDuplicate).toBeUndefined();
    });

    it('allows when same content + different GHL timestamp (30s later)', async () => {
      const supabase = makeSupabase(
        [R(null), R(null)],
        null,
        R('existing-msg-id', { ghlTimestamp: '2026-07-02T16:25:00.000Z' }),
      );
      const result = await ingestInboundMessage(makeParams({
        supabase,
        ghlMessageId: null,
        ingestSource: 'webhook',
        ghlTimestamp: '2026-07-02T16:25:30.000Z', // 30s later
        content: CHATGPT_MSG,
      }));
      expect(result.inserted).toBe(true);
      expect(result.skippedCrossPathDuplicate).toBeUndefined();
    });

    it('allows when existing has no ghlTimestamp (cannot confirm identity)', async () => {
      // Existing row has no ghlTimestamp → can't confirm it's the same message → allow
      const supabase = makeSupabase(
        [R(null), R(null)],
        null,
        R('existing-msg-id', {}), // no ghlTimestamp in metadata
      );
      const result = await ingestInboundMessage(makeParams({
        supabase,
        ghlMessageId: null,
        ingestSource: 'webhook',
        ghlTimestamp: SAME_TS,
        content: STAFF_MSG,
      }));
      expect(result.inserted).toBe(true);
      expect(result.skippedCrossPathDuplicate).toBeUndefined();
    });

    it('allows when incoming has no ghlTimestamp (cannot confirm identity)', async () => {
      const supabase = makeSupabase(
        [R(null), R(null)],
        null,
        R('existing-msg-id', { ghlTimestamp: SAME_TS }),
      );
      const result = await ingestInboundMessage(makeParams({
        supabase,
        ghlMessageId: null,
        ingestSource: 'webhook',
        ghlTimestamp: null, // no timestamp on incoming
        content: STAFF_MSG,
      }));
      expect(result.inserted).toBe(true);
      expect(result.skippedCrossPathDuplicate).toBeUndefined();
    });

    it('allows insertion when no recent same-content message found', async () => {
      const supabase = makeSupabase(
        [R(null), R(null)],
        null,
        { data: null, error: null }, // cross-path: NOT FOUND
      );
      const result = await ingestInboundMessage(makeParams({
        supabase,
        ghlMessageId: null,
        content: STAFF_MSG,
      }));
      expect(result.inserted).toBe(true);
    });

    it('allows insertion when same content but different conversation', async () => {
      const supabase = makeSupabase(
        [R(null), R(null)],
        null,
        { data: null, error: null },
      );
      const result = await ingestInboundMessage(makeParams({
        supabase,
        ghlMessageId: null,
        conversationId: 'conv-different',
        content: STAFF_MSG,
      }));
      expect(result.inserted).toBe(true);
    });

    it('does not trigger cross-path check for OUTBOUND direction', async () => {
      const supabase = makeSupabase(
        [R(null), R(null)],
        null,
        R('should-not-match', { ghlTimestamp: SAME_TS }),
      );
      const result = await ingestInboundMessage(makeParams({
        supabase,
        ghlMessageId: null,
        direction: 'OUTBOUND',
        sender: 'BOT',
        ghlTimestamp: SAME_TS,
        content: STAFF_MSG,
      }));
      expect(result.inserted).toBe(true);
      expect(result.skippedCrossPathDuplicate).toBeUndefined();
    });

    it('still inserts when fingerprint matches normally (Tier 2 wins, Tier 2.5 not reached)', async () => {
      const supabase = makeSupabase([R('fp-match-id')]); // fingerprint HIT
      const result = await ingestInboundMessage(makeParams({
        supabase,
        ghlMessageId: null,
        content: STAFF_MSG,
      }));
      expect(result.inserted).toBe(false);
      expect(result.duplicate).toBe(true);
      expect(result.skippedCrossPathDuplicate).toBeUndefined();
    });
  });
});
