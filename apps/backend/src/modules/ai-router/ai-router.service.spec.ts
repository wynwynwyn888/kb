// AiRouterService spec — slot extraction from KB context

import { jest as jestGlobal } from '@jest/globals';
import { AiRouterService, extractSlotFromKb } from './ai-router.service';

// Unit-under-test needs no external deps for these tests
const service = new AiRouterService();

describe('AiRouterService — slot extraction', () => {
  describe('extractSlotFromKb (internal)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const extract = (kbContext: { content: string; metadata?: Record<string, unknown> }[]) => extractSlotFromKb(kbContext);

    it('returns undefined when KB is empty', () => {
      expect(extract([])).toBeUndefined();
    });

    it('parses full range pattern: 2026-05-01T10:00 - 2026-05-01T10:30', () => {
      const result = extract([{ content: 'Available slot: 2026-05-01T10:00 - 2026-05-01T10:30. Book now.' }]);
      expect(result).toBeDefined();
      expect(result!.startTime).toBe('2026-05-01T10:00');
      expect(result!.endTime).toBe('2026-05-01T10:30');
      expect(result!.source).toBe('KB');
    });

    it('falls back to single date with default time window', () => {
      const result = extract([{ content: 'We are open on 2026-05-01 for appointments.' }]);
      expect(result).toBeDefined();
      expect(result!.startTime).toMatch(/^2026-05-01T09:00:00$/);
      expect(result!.endTime).toMatch(/^2026-05-01T09:30:00$/);
      expect(result!.source).toBe('KB');
    });

    it('returns undefined when no ISO-like pattern found', () => {
      const result = extract([{ content: 'We are open Monday to Friday, 9am to 5pm. Call to book.' }]);
      expect(result).toBeUndefined();
    });

    it('uses first matching chunk, not all chunks', () => {
      const result = extract([
        { content: 'Some text without dates here.' },
        { content: 'Appointment at 2026-06-01T14:00 - 2026-06-01T14:30.' },
      ]);
      expect(result).toBeDefined();
      expect(result!.startTime).toBe('2026-06-01T14:00');
      expect(result!.endTime).toBe('2026-06-01T14:30');
    });

    it('calendarId from KB chunk metadata — empty when not set', () => {
      // Without calendarId in metadata, slot has empty calendarId
      const result = extract([{ content: 'Slot: 2026-05-01T10:00 - 2026-05-01T10:30', metadata: {} }]);
      expect(result).toBeDefined();
      expect(result!.calendarId).toBe('');
    });

    it('calendarId from KB chunk metadata — used when present', () => {
      const result = extract([{ content: 'Slot: 2026-05-01T10:00 - 2026-05-01T10:30', metadata: { calendarId: 'cal_abc123' } }]);
      expect(result).toBeDefined();
      expect(result!.calendarId).toBe('cal_abc123');
    });

    it('timezone is undefined — executor uses GHL location default', () => {
      const result = extract([{ content: 'Slot: 2026-05-01T10:00 - 2026-05-01T10:30' }]);
      expect(result).toBeDefined();
      expect(result!.timezone).toBeUndefined();
    });
  });

  describe('route() includes extractedSlot in response', () => {
    it('extractedSlot is undefined when bookingIntentDetected=false', async () => {
      const result = await service.route({
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
      });
      expect(result.extractedSlot).toBeUndefined();
    });

    it('extractedSlot is undefined when bookingIntentDetected but KB is empty', async () => {
      const result = await service.route({
        tenantId: 't1',
        conversationId: 'c1',
        incomingMessage: 'I want to book an appointment',
        incomingMessageType: 'text',
        systemPrompt: '',
        memory: [],
        kbContext: [],
        channel: 'WHATSAPP',
        handoverRecommended: false,
        bookingIntentDetected: true,
        estimatedInputTokens: 10,
      });
      expect(result.extractedSlot).toBeUndefined();
    });

    it('extractedSlot is populated when bookingIntentDetected and KB has slot pattern', async () => {
      const result = await service.route({
        tenantId: 't1',
        conversationId: 'c1',
        incomingMessage: 'I want to schedule an appointment',
        incomingMessageType: 'text',
        systemPrompt: '',
        memory: [],
        kbContext: [{ chunkId: 'c1', documentId: 'd1', content: 'Available: 2026-07-01T11:00 - 2026-07-01T11:30', title: 'Availability', source: 'kb', relevanceScore: 0.9, metadata: { calendarId: 'cal_live_456' } }],
        channel: 'WHATSAPP',
        handoverRecommended: false,
        bookingIntentDetected: true,
        estimatedInputTokens: 10,
      });
      expect(result.extractedSlot).toBeDefined();
      expect(result.extractedSlot!.startTime).toBe('2026-07-01T11:00');
      expect(result.extractedSlot!.endTime).toBe('2026-07-01T11:30');
      expect(result.extractedSlot!.calendarId).toBe('cal_live_456');
      expect(result.extractedSlot!.source).toBe('KB');
    });

    it('extractedSlot has empty calendarId when KB chunk has no calendarId metadata — planner will not emit BOOK_SLOT', async () => {
      const result = await service.route({
        tenantId: 't1',
        conversationId: 'c1',
        incomingMessage: 'I want to schedule',
        incomingMessageType: 'text',
        systemPrompt: '',
        memory: [],
        kbContext: [{ chunkId: 'c1', documentId: 'd1', content: 'Slot: 2026-08-01T09:00 - 2026-08-01T09:30', title: 'Availability', source: 'kb', relevanceScore: 0.9, metadata: {} }],
        channel: 'WHATSAPP',
        handoverRecommended: false,
        bookingIntentDetected: true,
        estimatedInputTokens: 10,
      });
      expect(result.extractedSlot).toBeDefined();
      expect(result.extractedSlot!.calendarId).toBe(''); // empty → planner skips BOOK_SLOT
    });
  });
});