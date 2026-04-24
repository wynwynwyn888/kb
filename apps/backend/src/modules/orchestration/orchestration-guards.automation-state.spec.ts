// Focused tests for conversation-level automation state guard
// Tests decision priority: conversation.status PAUSED/HANDOVER > tenant defaults

import { jest as jestGlobal } from '@jest/globals';
import { OrchestrationGuards } from './orchestration-guards.service';
import { createMockSupabase, mockFrom } from '../../test/mock-supabase';

const mockSupabase = createMockSupabase();
jestGlobal.mock('../../lib/supabase', () => ({
  getSupabaseService: () => mockSupabase,
}));

function makeInput(overrides: {
  conversationId?: string;
  conversationStatus?: string;
  botEnabled?: boolean;
  tenantHandoverPaused?: boolean;
  channel?: string;
  messageType?: string;
  tenantGhlConnected?: boolean;
} = {}): Parameters<typeof OrchestrationGuards.prototype.runGuards>[0] {
  const {
    conversationId = 'conv_1',
    conversationStatus = 'ACTIVE',
    botEnabled = true,
    tenantHandoverPaused = false,
    channel = 'WHATSAPP',
    messageType = 'text',
    tenantGhlConnected = true,
  } = overrides;

  return {
    tenantId: 'tenant_1',
    conversationId,
    incomingMessage: {
      ghlLocationId: 'loc_1',
      ghlConversationId: 'ghl_conv_1',
      ghlContactId: 'contact_1',
      messageContent: 'Hello',
      messageType,
      timestamp: new Date().toISOString(),
      externalEventId: 'evt_1',
      eventType: 'inbound_message',
      dedupeKey: 'key_1',
      channelRaw: null,
    },
    tenant: {
      id: 'tenant_1',
      name: 'Test Tenant',
      botEnabled,
      handoverPaused: tenantHandoverPaused,
      ghlLocationId: 'loc_1',
    },
    conversation: {
      id: conversationId,
      ghlConversationId: 'ghl_conv_1',
      contactId: 'contact_1',
      channel,
      status: conversationStatus,
      metadata: {},
    },
  } as never;
}

describe('OrchestrationGuards — checkConversationAutomationPaused', () => {
  let guards: OrchestrationGuards;

  beforeEach(() => {
    jestGlobal.clearAllMocks();
    guards = new OrchestrationGuards();
    // Default: GHL connected, no handover events, quota OK
    mockFrom(mockSupabase, 'tenant_ghl_connections', { status: 'CONNECTED' });
    mockFrom(mockSupabase, 'handover_events', null, { code: 'PGRST116' });
    mockFrom(mockSupabase, 'quota_wallets', { total_quota: 100, used_quota: 10 });
  });

  describe('ACTIVE conversations — PROCEED', () => {
    it('PROCEEDs for status=ACTIVE', async () => {
      const input = makeInput({ conversationStatus: 'ACTIVE' });
      const result = await guards.runGuards(input);
      expect(result.final).toBe('PROCEED');
    });

    it('PROCEEDs for status=PENDING', async () => {
      const input = makeInput({ conversationStatus: 'PENDING' });
      const result = await guards.runGuards(input);
      expect(result.final).toBe('PROCEED');
    });

    it('PROCEEDs for status=CLOSED', async () => {
      const input = makeInput({ conversationStatus: 'CLOSED' });
      const result = await guards.runGuards(input);
      expect(result.final).toBe('PROCEED');
    });
  });

  describe('PAUSED conversations — SKIP', () => {
    it('SKIP_AUTOMATION_PAUSED for status=PAUSED', async () => {
      const input = makeInput({ conversationStatus: 'PAUSED' });
      const result = await guards.runGuards(input);
      expect(result.final).toBe('SKIP_AUTOMATION_PAUSED');
      const pauseGuard = result.guards.find(g => g.guardName === 'automation_paused');
      expect(pauseGuard).toBeDefined();
      expect(pauseGuard!.reason).toContain('PAUSED');
    });
  });

  describe('decision priority — conversation PAUSED overrides all', () => {
    it('SKIP_AUTOMATION_PAUSED even when bot is enabled at tenant level', async () => {
      // PAUSED at conversation level must override tenant-level botEnabled=true
      // Bot_enabled runs first and PROCEEDs (bot is enabled at tenant), but automation_paused short-circuits next
      const input = makeInput({
        conversationStatus: 'PAUSED',
        botEnabled: true, // tenant says bot is on
      });
      const result = await guards.runGuards(input);
      expect(result.final).toBe('SKIP_AUTOMATION_PAUSED');
      // automation_paused guard should be the blocking decision, not bot_enabled
      const pauseGuard = result.guards.find(g => g.guardName === 'automation_paused');
      expect(pauseGuard).toBeDefined();
      expect(pauseGuard!.decision).toBe('SKIP_AUTOMATION_PAUSED');
    });

    it('SKIP_AUTOMATION_PAUSED even when channel is supported', async () => {
      // PAUSED at conversation level must override channel support
      const input = makeInput({
        conversationStatus: 'PAUSED',
        channel: 'WHATSAPP', // channel is supported
        messageType: 'text',
      });
      const result = await guards.runGuards(input);
      expect(result.final).toBe('SKIP_AUTOMATION_PAUSED');
      // channel guard should not be reached
      const channelGuard = result.guards.find(g => g.guardName === 'channel');
      expect(channelGuard).toBeUndefined();
    });

    it('SKIP_AUTOMATION_PAUSED even when quota is available', async () => {
      // PAUSED at conversation level must override quota check
      const input = makeInput({ conversationStatus: 'PAUSED' });
      const result = await guards.runGuards(input);
      expect(result.final).toBe('SKIP_AUTOMATION_PAUSED');
      const quotaGuard = result.guards.find(g => g.guardName === 'quota_available');
      expect(quotaGuard).toBeUndefined();
    });
  });

  describe('guard order — automation pause runs before handover', () => {
    it('PAUSED short-circuits before handover check is reached', async () => {
      // Guard order: automation_paused (guard 3) runs BEFORE handover_paused (guard 4)
      // If conversation is PAUSED, it's blocked by SKIP_AUTOMATION_PAUSED before handover is checked
      const input = makeInput({ conversationStatus: 'PAUSED' });
      const result = await guards.runGuards(input);
      expect(result.final).toBe('SKIP_AUTOMATION_PAUSED');
      // Handover guard should NOT be in the list — automation pause short-circuits
      const handoverGuard = result.guards.find(g => g.guardName === 'handover_paused');
      expect(handoverGuard).toBeUndefined();
    });
  });

  describe('runGuards full cascade count', () => {
    it('runs 7 guards when all pass (bot, ghl, automation, handover, quota, type, channel)', async () => {
      const input = makeInput({ conversationStatus: 'ACTIVE' });
      mockFrom(mockSupabase, 'tenant_ghl_connections', { status: 'CONNECTED' });
      mockFrom(mockSupabase, 'handover_events', null, { code: 'PGRST116' });
      mockFrom(mockSupabase, 'quota_wallets', { total_quota: 100, used_quota: 10 });
      const result = await guards.runGuards(input);
      expect(result.final).toBe('PROCEED');
      expect(result.guards.length).toBe(7); // 7 guards now (added automation_paused)
    });
  });
});
