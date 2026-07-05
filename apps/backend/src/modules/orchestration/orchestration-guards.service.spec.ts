import { jest as jestGlobal } from '@jest/globals';

import { OrchestrationGuards } from './orchestration-guards.service';
import { createMockSupabase, mockFrom } from '../../test/mock-supabase';

const mockSupabase = createMockSupabase();
jestGlobal.mock('../../lib/supabase', () => ({
  getSupabaseService: () => mockSupabase,
}));

function makeInput(overrides: {
  tenantId?: string;
  conversationId?: string;
  tenant?: {
    id: string;
    botEnabled: boolean;
    botMode?: 'off' | 'suggestive' | 'autopilot';
    handoverPaused: boolean;
    ghlLocationId: string;
  };
  incomingMessage?: { messageType: string; messageContent: string };
  conversation?: { channel: string };
} = {}) {
  return {
    tenantId: overrides.tenantId ?? 'tenant_1',
    conversationId: overrides.conversationId ?? 'conv_1',
    incomingMessage: overrides.incomingMessage ?? { messageType: 'text', messageContent: 'Hello' },
    conversation: overrides.conversation ?? { channel: 'WHATSAPP' },
    tenant: Object.prototype.hasOwnProperty.call(overrides, 'tenant')
      ? overrides.tenant === undefined
        ? undefined
        : { botMode: 'autopilot' as const, ...overrides.tenant! }
      : { id: 'tenant_1', botEnabled: true, botMode: 'autopilot' as const, handoverPaused: false, ghlLocationId: 'loc_1' },
  } as never;
}

describe('OrchestrationGuards', () => {
  let guards: OrchestrationGuards;

  beforeEach(() => {
    jestGlobal.clearAllMocks();
    guards = new OrchestrationGuards();
  });

  describe('checkBotEnabled', () => {
    it('returns PROCEED when bot is enabled', async () => {
      const input = makeInput({ tenant: { id: 't1', botEnabled: true, handoverPaused: false, ghlLocationId: 'loc_1' } });
      const result = await (guards as never)['checkBotEnabled'](input);
      expect(result.decision).toBe('PROCEED');
    });

    it('returns SKIP_BOT_DISABLED when bot is disabled', async () => {
      const input = makeInput({ tenant: { id: 't1', botEnabled: false, handoverPaused: false, ghlLocationId: 'loc_1' } });
      const result = await (guards as never)['checkBotEnabled'](input);
      expect(result.decision).toBe('SKIP_BOT_DISABLED');
    });

    it('returns ERROR when tenant missing', async () => {
      const input = makeInput({ tenant: undefined as never });
      const result = await (guards as never)['checkBotEnabled'](input);
      expect(result.decision).toBe('ERROR');
    });
  });

  describe('checkGhlConnected', () => {
    it('returns PROCEED when connected', async () => {
      const input = makeInput();
      mockFrom(mockSupabase, 'tenant_ghl_connections', { status: 'CONNECTED' });
      const result = await (guards as never)['checkGhlConnected'](input);
      expect(result.decision).toBe('PROCEED');
    });

    it('returns SKIP_GHL_DISCONNECTED when not found', async () => {
      const input = makeInput();
      mockFrom(mockSupabase, 'tenant_ghl_connections', null, { code: 'PGRST116' });
      const result = await (guards as never)['checkGhlConnected'](input);
      expect(result.decision).toBe('SKIP_GHL_DISCONNECTED');
    });

    it('returns SKIP_GHL_DISCONNECTED when status not CONNECTED', async () => {
      const input = makeInput();
      mockFrom(mockSupabase, 'tenant_ghl_connections', { status: 'DISCONNECTED' });
      const result = await (guards as never)['checkGhlConnected'](input);
      expect(result.decision).toBe('SKIP_GHL_DISCONNECTED');
    });
  });

  describe('checkHandoverPaused', () => {
    it('returns PROCEED when neither flag nor event set', async () => {
      const input = makeInput({ tenant: { id: 't1', botEnabled: true, handoverPaused: false, ghlLocationId: 'loc_1' } });
      mockFrom(mockSupabase, 'handover_events', null, { code: 'PGRST116' });
      const result = await (guards as never)['checkHandoverPaused'](input);
      expect(result.decision).toBe('PROCEED');
    });

    it('returns SKIP_HANDOVER_ACTIVE when tenant flag true', async () => {
      const input = makeInput({ tenant: { id: 't1', botEnabled: true, handoverPaused: true, ghlLocationId: 'loc_1' } });
      const result = await (guards as never)['checkHandoverPaused'](input);
      expect(result.decision).toBe('SKIP_HANDOVER_ACTIVE');
    });

    it('returns SKIP_HANDOVER_ACTIVE when active event exists', async () => {
      const input = makeInput({ conversationId: 'conv_active' });
      mockFrom(mockSupabase, 'handover_events', { id: 'he_1', status: 'ACTIVE' });
      const result = await (guards as never)['checkHandoverPaused'](input);
      expect(result.decision).toBe('SKIP_HANDOVER_ACTIVE');
    });

    it('returns SKIP_HANDOVER_ACTIVE when conversation status is HANDOVER', async () => {
      const input = makeInput({
        conversationId: 'conv_handover_status',
        conversation: {
          id: 'conv_handover_status',
          ghlConversationId: 'gc',
          contactId: 'ct',
          channel: 'WHATSAPP',
          status: 'HANDOVER',
          metadata: {},
        },
      });
      const result = await (guards as never)['checkHandoverPaused'](input);
      expect(result.decision).toBe('SKIP_HANDOVER_ACTIVE');
    });
  });

  describe('checkQuotaAvailable', () => {
    it('returns PROCEED when no wallet (credits not tracked yet)', async () => {
      const input = makeInput();
      mockFrom(mockSupabase, 'tenants', { credits_unlimited: false });
      mockFrom(mockSupabase, 'quota_wallets', null, { code: 'PGRST116' });
      const result = await (guards as never)['checkQuotaAvailable'](input);
      expect(result.decision).toBe('PROCEED');
    });

    it('returns PROCEED when remaining > 0', async () => {
      const input = makeInput();
      mockFrom(mockSupabase, 'quota_wallets', { total_quota: 100, used_quota: 50 });
      const result = await (guards as never)['checkQuotaAvailable'](input);
      expect(result.decision).toBe('PROCEED');
    });

    it('returns SKIP_QUOTA_EXHAUSTED when exhausted', async () => {
      const input = makeInput();
      mockFrom(mockSupabase, 'quota_wallets', { total_quota: 100, used_quota: 100 });
      const result = await (guards as never)['checkQuotaAvailable'](input);
      expect(result.decision).toBe('SKIP_QUOTA_EXHAUSTED');
    });
  });

  describe('checkMessageType', () => {
    it('returns PROCEED for text', async () => {
      const input = makeInput({ incomingMessage: { messageType: 'text', messageContent: 'Hi' } });
      const result = await (guards as never)['checkMessageType'](input);
      expect(result.decision).toBe('PROCEED');
    });

    it('allows image inbound when vision pipeline is enabled', async () => {
      const input = makeInput({ incomingMessage: { messageType: 'image', messageContent: '[Photo]' } });
      const result = await (guards as never)['checkMessageType'](input);
      expect(result.decision).toBe('PROCEED');
    });
  });

  describe('checkChannel', () => {
    it('returns PROCEED for WHATSAPP', async () => {
      const input = makeInput({ conversation: { channel: 'WHATSAPP' } });
      const result = await (guards as never)['checkChannel'](input);
      expect(result.decision).toBe('PROCEED');
    });

    it('returns PROCEED for lowercase whatsapp', async () => {
      const input = makeInput({ conversation: { channel: 'whatsapp' } });
      const result = await (guards as never)['checkChannel'](input);
      expect(result.decision).toBe('PROCEED');
    });

    it('returns PROCEED for SMS (outbound routing selects GHL send type)', async () => {
      const input = makeInput({ conversation: { channel: 'SMS' } });
      const result = await (guards as never)['checkChannel'](input);
      expect(result.decision).toBe('PROCEED');
    });

    it('returns PROCEED for CHAT (Facebook / Instagram stored as CHAT)', async () => {
      const input = makeInput({ conversation: { channel: 'CHAT' } });
      const result = await (guards as never)['checkChannel'](input);
      expect(result.decision).toBe('PROCEED');
    });
  });

  describe('checkAiOffTag', () => {
    function makeContactInput(metadata: Record<string, unknown> = {}) {
      return makeInput({
        conversationId: 'conv_ai',
        conversation: {
          id: 'conv_ai',
          ghlConversationId: 'gc',
          contactId: 'contact_ai',
          channel: 'WHATSAPP',
          status: 'ACTIVE',
          metadata,
        },
      });
    }

    // ── Test 1: metadata ai_status=off → SKIP_AI_OFF_TAG ──
    it('returns SKIP_AI_OFF_TAG when metadata ai_status=off', async () => {
      const input = makeContactInput({ ai_status: 'off' });
      const result = await (guards as never)['checkAiOffTag'](input);
      expect(result.decision).toBe('SKIP_AI_OFF_TAG');
      expect(result.reason).toContain('metadata');
    });

    // ── Test 2: metadata ai_status=active (fresh) → PROCEED ──
    it('returns PROCEED when metadata ai_status=active is fresh', async () => {
      const input = makeContactInput({
        ai_status: 'active',
        ai_status_updated_at: new Date().toISOString(),
      });
      const result = await (guards as never)['checkAiOffTag'](input);
      expect(result.decision).toBe('PROCEED');
    });

    // ── Test 2b: metadata ai_status=active (stale >5min) → falls through to GHL ──
    it('falls through to GHL lookup when metadata ai_status=active is stale', async () => {
      const input = makeContactInput({
        ai_status: 'active',
        ai_status_updated_at: new Date(Date.now() - 10 * 60_000).toISOString(),
      });
      // No ghlService → PROCEED (no_ghl_service)
      const result = await (guards as never)['checkAiOffTag'](input);
      // Falls through because stale: returns no_ghl_service → PROCEED
      expect(result.decision).toBe('PROCEED');
      expect(result.reason).toBe('no_ghl_service');
    });

    // ── Test 2c: metadata ai_status=active without timestamp → stale (treat as unknown) ──
    it('treats active without timestamp as stale (falls through to GHL)', async () => {
      const input = makeContactInput({ ai_status: 'active' });
      // No ghlService → PROCEED
      const result = await (guards as never)['checkAiOffTag'](input);
      expect(result.decision).toBe('PROCEED');
      expect(result.reason).toBe('no_ghl_service');
    });

    // ── Test 3: metadata unknown + GHL returns AI off → SKIP and metadata set off ──
    it('returns SKIP_AI_OFF_TAG when metadata missing and GHL returns AI off tag', async () => {
      const mockGhlService = {
        createGhlClientForConnectedTenantWorkerOrThrow: jestGlobal.fn(async () => ({
          client: {
            getContact: jestGlobal.fn(async () => ({
              success: true,
              contact: { tags: [{ name: 'ai off' }, { name: 'other' }] },
            })),
          },
        })),
      };
      const g = new OrchestrationGuards(mockGhlService as never);
      const input = makeContactInput({});
      mockFrom(mockSupabase, 'conversations', { metadata: {} }); // for updateConversationAiStatus
      const result = await (g as never)['checkAiOffTag'](input);
      expect(result.decision).toBe('SKIP_AI_OFF_TAG');
    });

    // ── Test 4: metadata unknown + GHL returns no AI off → PROCEED and metadata set active ──
    it('returns PROCEED when metadata missing and GHL returns no AI off', async () => {
      const mockGhlService = {
        createGhlClientForConnectedTenantWorkerOrThrow: jestGlobal.fn(async () => ({
          client: {
            getContact: jestGlobal.fn(async () => ({
              success: true,
              contact: { tags: [{ name: 'other' }] },
            })),
          },
        })),
      };
      const g = new OrchestrationGuards(mockGhlService as never);
      const input = makeContactInput({});
      mockFrom(mockSupabase, 'conversations', { metadata: {} });
      const result = await (g as never)['checkAiOffTag'](input);
      expect(result.decision).toBe('PROCEED');
    });

    // ── Test 5: GHL lookup fails + metadata unknown → SKIP_AI_OFF_TAG ──
    it('returns SKIP_AI_OFF_TAG when metadata missing and GHL lookup fails', async () => {
      const mockGhlService = {
        createGhlClientForConnectedTenantWorkerOrThrow: jestGlobal.fn(async () => ({
          client: {
            getContact: jestGlobal.fn(async () => ({
              success: false,
              error: 'API error',
            })),
          },
        })),
      };
      const g = new OrchestrationGuards(mockGhlService as never);
      const input = makeContactInput({});
      const result = await (g as never)['checkAiOffTag'](input);
      expect(result.decision).toBe('SKIP_AI_OFF_TAG');
    });

    // ── Tag array of strings (not objects) ──
    it('handles tags as array of strings', async () => {
      const mockGhlService = {
        createGhlClientForConnectedTenantWorkerOrThrow: jestGlobal.fn(async () => ({
          client: {
            getContact: jestGlobal.fn(async () => ({
              success: true,
              contact: { tags: ['AI Off', 'other tag'] },
            })),
          },
        })),
      };
      const g = new OrchestrationGuards(mockGhlService as never);
      const input = makeContactInput({});
      mockFrom(mockSupabase, 'conversations', { metadata: {} });
      const result = await (g as never)['checkAiOffTag'](input);
      expect(result.decision).toBe('SKIP_AI_OFF_TAG');
    });

    // ── No contact ID → PROCEED ──
    it('returns PROCEED when no contactId', async () => {
      const input = makeInput({
        conversation: {
          id: 'conv_no_contact',
          ghlConversationId: 'gc',
          contactId: '',
          channel: 'WHATSAPP',
          status: 'ACTIVE',
          metadata: {},
        },
      });
      const result = await (guards as never)['checkAiOffTag'](input);
      expect(result.decision).toBe('PROCEED');
      expect(result.reason).toContain('no_contact_id');
    });
  });

  describe('runGuards (cascade)', () => {
    it('short-circuits on first non-PROCEED guard', async () => {
      // AI off is Guard #1 — it runs first and returns PROCEED (no contactId).
      // Bot disabled is Guard #2 — returns SKIP_BOT_DISABLED, short-circuit at 2 guards.
      const input = makeInput({ tenant: { id: 't1', botEnabled: false, handoverPaused: false, ghlLocationId: 'loc_1' } });
      mockFrom(mockSupabase, 'tenant_ghl_connections', null, { code: 'PGRST116' });
      const result = await guards.runGuards(input);
      expect(result.final).toBe('SKIP_BOT_DISABLED');
      expect(result.guards.length).toBe(2);
    });

    it('runs all guards when all pass', async () => {
      const input = makeInput();
      mockFrom(mockSupabase, 'tenant_ghl_connections', { status: 'CONNECTED' });
      mockFrom(mockSupabase, 'handover_events', null, { code: 'PGRST116' });
      mockFrom(mockSupabase, 'quota_wallets', { total_quota: 100, used_quota: 10 });
      const result = await guards.runGuards(input);
      expect(result.final).toBe('PROCEED');
      expect(result.guards.length).toBe(8);
    });
  });
});
