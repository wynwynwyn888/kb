import { jest as jestGlobal } from '@jest/globals';
import { ingestInboundMessage, computeContentFingerprint } from './inbound-message-ingest';

type Response = { data: unknown; error: unknown };

function makeSupabase(responses: Response[], insertError?: { message: string; code: string } | null) {
  let i = 0;
  const maybeSingle = jestGlobal.fn(async () => {
    const r = responses[i] ?? { data: null, error: null };
    i++;
    return r;
  });
  return {
    from: jestGlobal.fn((_table: string) => ({
      select: jestGlobal.fn((_cols: string) => ({
        eq: jestGlobal.fn((_k: string, _v: string) => ({
          filter: jestGlobal.fn((_k: string, _op: string, _v: string) => ({
            maybeSingle,
          })),
        })),
      })),
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
});
