// AiRouterService spec — routing heuristic branches, slot extraction, and edge cases

import { jest as jestGlobal } from '@jest/globals';
import { AiRouterService } from './ai-router.service';
import type { RoutingRequest } from '../orchestration/dto';

const service = new AiRouterService();

function makeRequest(overrides: Partial<RoutingRequest> = {}): RoutingRequest {
  return {
    tenantId: 't1',
    conversationId: 'c1',
    incomingMessage: 'Hello',
    incomingMessageType: 'text',
    systemPrompt: '',
    memory: [],
    kbContext: [],
    channel: 'WHATSAPP',
    handoverRecommended: false,
    bookingIntentDetected: false,
    estimatedInputTokens: 10,
    ...overrides,
  };
}

describe('AiRouterService — routing heuristics', () => {
  // ===========================================================================
  // Branch: Short simple message → fast route, simple model (gpt-4o-mini)
  // ===========================================================================

  describe('fast route for short simple messages', () => {
    it('routes short message (<50 chars) with no complex intent to fast/gpt-4o-mini', async () => {
      const result = await service.route(makeRequest({ incomingMessage: 'Hi' }));
      expect(result.responseMode).toBe('fast');
      expect(result.recommendedModel).toBe('gpt-4o-mini');
      expect(result.confidence).toBe(0.9);
    });

    it('fast route applies for very short greetings', async () => {
      const result = await service.route(makeRequest({ incomingMessage: 'Hey' }));
      expect(result.responseMode).toBe('fast');
      expect(result.recommendedModel).toBe('gpt-4o-mini');
    });
  });

  // ===========================================================================
  // Branch: Handover → complex route, handover mode
  // ===========================================================================

  describe('handover route', () => {
    it('routes to handover mode with complex model when handoverRecommended=true', async () => {
      const result = await service.route(
        makeRequest({ incomingMessage: 'I want to speak to a human', handoverRecommended: true }),
      );
      expect(result.responseMode).toBe('handover');
      expect(result.recommendedModel).toBe('gpt-4o');
      expect(result.confidence).toBe(0.9);
      expect(result.reasoning).toContain('handover recommended');
    });

    it('handover takes priority over booking intent when both are true', async () => {
      const result = await service.route(
        makeRequest({
          incomingMessage: 'I need to book and talk to someone',
          handoverRecommended: true,
          bookingIntentDetected: true,
        }),
      );
      expect(result.responseMode).toBe('handover');
      expect(result.recommendedModel).toBe('gpt-4o');
    });
  });

  // ===========================================================================
  // Branch: Booking intent → standard route, complex model
  // ===========================================================================

  describe('booking intent route', () => {
    it('routes booking intent to standard/gpt-4o', async () => {
      const result = await service.route(
        makeRequest({
          incomingMessage: 'I would like to book an appointment for next Tuesday',
          bookingIntentDetected: true,
        }),
      );
      expect(result.responseMode).toBe('standard');
      expect(result.recommendedModel).toBe('gpt-4o');
      expect(result.confidence).toBe(0.85);
      expect(result.reasoning).toContain('booking intent detected');
    });

    it('booking intent with short message still uses complex model', async () => {
      const result = await service.route(
        makeRequest({ incomingMessage: 'Book', bookingIntentDetected: true }),
      );
      expect(result.recommendedModel).toBe('gpt-4o');
    });
  });

  // ===========================================================================
  // Branch: Long message (>300 chars) → standard route, complex model
  // ===========================================================================

  describe('long message route', () => {
    it('routes message >300 chars to standard/gpt-4o', async () => {
      const longMsg = 'A'.repeat(301);
      const result = await service.route(
        makeRequest({ incomingMessage: longMsg }),
      );
      expect(result.responseMode).toBe('standard');
      expect(result.recommendedModel).toBe('gpt-4o');
      expect(result.confidence).toBe(0.75);
      expect(result.reasoning).toContain('exceeds threshold');
    });

    it('routes message exactly 300 chars falls through to default heuristic', async () => {
      const exactMsg = 'A'.repeat(300);
      const result = await service.route(
        makeRequest({ incomingMessage: exactMsg }),
      );
      expect(result.recommendedModel).toBe('gpt-4o-mini');
      expect(result.responseMode).toBe('standard');
      expect(result.reasoning).toBe('simple heuristic route');
    });
  });

  // ===========================================================================
  // Branch: Many turns (>3 user turns) → standard route, complex model
  // ===========================================================================

  describe('many turns route', () => {
    it('routes >3 user turns to standard/gpt-4o', async () => {
      const result = await service.route(
        makeRequest({
          incomingMessage: 'Hello',
          memory: [
            { role: 'user', content: 'Msg1' },
            { role: 'assistant', content: 'Reply1' },
            { role: 'user', content: 'Msg2' },
            { role: 'assistant', content: 'Reply2' },
            { role: 'user', content: 'Msg3' },
            { role: 'assistant', content: 'Reply3' },
            { role: 'user', content: 'Msg4' },
          ],
        }),
      );
      expect(result.recommendedModel).toBe('gpt-4o');
      expect(result.confidence).toBe(0.75);
    });

    it('routes 3 or fewer user turns to default simple/fast route', async () => {
      const result = await service.route(
        makeRequest({
          incomingMessage: 'Hello',
          memory: [
            { role: 'user', content: 'Msg1' },
            { role: 'assistant', content: 'Reply1' },
            { role: 'user', content: 'Msg2' },
          ],
        }),
      );
      expect(result.recommendedModel).toBe('gpt-4o-mini');
    });
  });

  // ===========================================================================
  // Branch: Complex keywords → standard route, complex model
  // ===========================================================================

  describe('complex keyword route', () => {
    it.each([
      'I need to book an appointment',
      'Can you schedule a meeting?',
      'What is the pricing?',
      'Do you have any discounts?',
      'Is there a deal available?',
      'I need to cancel my order',
      'Can you modify my reservation?',
      'What is the availability?',
      'How long does it take?',
    ])('routes "%s" containing complex keyword to gpt-4o', async (msg) => {
      const result = await service.route(
        makeRequest({ incomingMessage: msg }),
      );
      expect(result.recommendedModel).toBe('gpt-4o');
      expect(result.responseMode).toBe('standard');
      expect(result.confidence).toBe(0.8);
    });

    it('keyword matching is case-insensitive', async () => {
      const result = await service.route(
        makeRequest({ incomingMessage: 'I want a DISCOUNT please' }),
      );
      expect(result.recommendedModel).toBe('gpt-4o');
    });
  });

  // ===========================================================================
  // Branch: Tenant model override
  // ===========================================================================

  describe('tenant model override', () => {
    it('uses tenantModelOverride when provided regardless of heuristic', async () => {
      const result = await service.route(
        makeRequest({
          incomingMessage: 'Hi',
          tenantModelOverride: 'gpt-4.1',
        }),
      );
      expect(result.recommendedModel).toBe('gpt-4.1');
      expect(result.reasoning).toContain('tenant model override');
    });

    it('tenant override supersedes handover complex routing', async () => {
      const result = await service.route(
        makeRequest({
          incomingMessage: 'I want to speak to someone',
          handoverRecommended: true,
          tenantModelOverride: 'gpt-4o-mini',
        }),
      );
      expect(result.recommendedModel).toBe('gpt-4o-mini');
      expect(result.responseMode).toBe('handover');
    });
  });

  // ===========================================================================
  // Default route (simple heuristic) — message >= 50 chars but no complex trigger
  // ===========================================================================

  describe('default simple heuristic route', () => {
    it('falls through to default (simple model) when no heuristic matches', async () => {
      const result = await service.route(
        makeRequest({ incomingMessage: 'Just a normal message that is not too long or short' }),
      );
      expect(result.recommendedModel).toBe('gpt-4o-mini');
      expect(result.responseMode).toBe('standard');
      expect(result.confidence).toBe(0.7);
      expect(result.reasoning).toBe('simple heuristic route');
    });
  });

  // ===========================================================================
  // Multiple conditions — correct priority
  // ===========================================================================

  describe('condition priority', () => {
    it('handover > booking > long message > complex keyword > short fast', async () => {
      const result = await service.route(
        makeRequest({
          incomingMessage: 'book appointment',
          handoverRecommended: true,
          bookingIntentDetected: true,
        }),
      );
      expect(result.responseMode).toBe('handover');
      expect(result.recommendedModel).toBe('gpt-4o');
    });

    it('booking > long message (both trigger but booking wins via earlier if-branch)', async () => {
      const longMsg = 'I want to book ' + 'A'.repeat(300);
      const result = await service.route(
        makeRequest({
          incomingMessage: longMsg,
          bookingIntentDetected: true,
        }),
      );
      expect(result.recommendedModel).toBe('gpt-4o');
      expect(result.reasoning).toContain('booking intent detected');
    });
  });

  // ===========================================================================
  // Slot extraction in route() context
  // ===========================================================================

  describe('slot extraction in route()', () => {
    it('extractedSlot is undefined when bookingIntentDetected=false', async () => {
      const result = await service.route(
        makeRequest({
          incomingMessage: 'Hello',
          bookingIntentDetected: false,
          kbContext: [{ chunkId: 'c1', documentId: 'd1', content: 'Slot: 2026-05-01T10:00 - 2026-05-01T10:30', title: 'Slots', source: 'kb', relevanceScore: 0.9 }],
        }),
      );
      expect(result.extractedSlot).toBeUndefined();
    });

    it('extractedSlot is undefined when bookingIntentDetected but KB is empty', async () => {
      const result = await service.route(
        makeRequest({
          incomingMessage: 'I want to book',
          bookingIntentDetected: true,
          kbContext: [],
        }),
      );
      expect(result.extractedSlot).toBeUndefined();
    });

    it('extractedSlot is populated with full range pattern', async () => {
      const result = await service.route(
        makeRequest({
          incomingMessage: 'Book a slot',
          bookingIntentDetected: true,
          kbContext: [{ chunkId: 'c1', documentId: 'd1', content: 'Available: 2026-07-01T11:00 - 2026-07-01T11:30', title: 'Availability', source: 'kb', relevanceScore: 0.9, metadata: { calendarId: 'cal_456' } }],
        }),
      );
      expect(result.extractedSlot).toBeDefined();
      expect(result.extractedSlot!.startTime).toBe('2026-07-01T11:00');
      expect(result.extractedSlot!.endTime).toBe('2026-07-01T11:30');
      expect(result.extractedSlot!.calendarId).toBe('cal_456');
      expect(result.extractedSlot!.source).toBe('KB');
    });
  });
});
