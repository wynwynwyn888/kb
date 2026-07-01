import { jest as jestGlobal } from '@jest/globals';
import { ingestInboundMessage, computeContentFingerprint } from './inbound-message-ingest';

type Response = { data: unknown; error: unknown };

function makeSupabase(responses: Response[]) {
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
      insert: jestGlobal.fn(() => ({})),
      update: jestGlobal.fn(() => ({ eq: jestGlobal.fn(() => ({})) })),
    })),
  };
}

function R(id: string | null, meta?: Record<string, unknown>): Response {
  if (!id) return { data: null, error: null };
  return { data: { id, metadata: meta ?? {} }, error: null };
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

  describe('same body, different ghlMessageIds', () => {
    it('inserts as new when fingerprint does not match either', async () => {
      const supabase = makeSupabase([R(null), R(null)]);
      const result = await ingestInboundMessage(makeParams({
        supabase, ghlMessageId: 'new-msg',
        content: 'Yes', ghlTimestamp: '2026-07-01T12:52:00Z',
      }));
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
