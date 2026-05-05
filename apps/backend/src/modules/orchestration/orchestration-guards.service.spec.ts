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
  });

  describe('checkQuotaAvailable', () => {
    it('returns PROCEED when no wallet', async () => {
      const input = makeInput();
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

    it('returns SKIP_UNSUPPORTED_MESSAGE_TYPE for image', async () => {
      const input = makeInput({ incomingMessage: { messageType: 'image', messageContent: '' } });
      const result = await (guards as never)['checkMessageType'](input);
      expect(result.decision).toBe('SKIP_UNSUPPORTED_MESSAGE_TYPE');
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

    it('returns SKIP_UNSUPPORTED_CHANNEL for SMS', async () => {
      const input = makeInput({ conversation: { channel: 'SMS' } });
      const result = await (guards as never)['checkChannel'](input);
      expect(result.decision).toBe('SKIP_UNSUPPORTED_CHANNEL');
    });
  });

  describe('runGuards (cascade)', () => {
    it('short-circuits on first non-PROCEED guard', async () => {
      const input = makeInput({ tenant: { id: 't1', botEnabled: false, handoverPaused: false, ghlLocationId: 'loc_1' } });
      const result = await guards.runGuards(input);
      expect(result.final).toBe('SKIP_BOT_DISABLED');
      expect(result.guards.length).toBe(1);
    });

    it('runs all guards when all pass', async () => {
      const input = makeInput();
      mockFrom(mockSupabase, 'tenant_ghl_connections', { status: 'CONNECTED' });
      mockFrom(mockSupabase, 'handover_events', null, { code: 'PGRST116' });
      mockFrom(mockSupabase, 'quota_wallets', { total_quota: 100, used_quota: 10 });
      const result = await guards.runGuards(input);
      expect(result.final).toBe('PROCEED');
      expect(result.guards.length).toBe(7);
    });
  });
});
