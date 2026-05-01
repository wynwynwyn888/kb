// ActionIntentExecutorService spec — TAG_CONTACT execution from deferred ActionIntents

import { jest as jestGlobal } from '@jest/globals';
import { Logger } from '@nestjs/common';
import { ActionIntentExecutorService } from './action-intent-executor.service';
import { createMockSupabase } from '../../test/mock-supabase';

const mockSupabase = createMockSupabase();
jestGlobal.mock('../../lib/supabase', () => ({
  getSupabaseService: () => mockSupabase,
}));

const mockGhlClient = {
  tagContact: jestGlobal.fn(),
  bookSlot: jestGlobal.fn(),
};
jestGlobal.mock('@aisbp/ghl-client', () => ({
  createGhlClient: jestGlobal.fn(() => mockGhlClient),
}));

describe('ActionIntentExecutorService', () => {
  let service: ActionIntentExecutorService;

  beforeEach(() => {
    jestGlobal.clearAllMocks();
    service = new ActionIntentExecutorService();
  });

  describe('shouldExecute', () => {
    it('returns true when planStatus=PLANNED, succeeded>=1, contactId present', () => {
      const result = service.shouldExecute({ succeeded: 1, planStatus: 'PLANNED' }, 'contact_1');
      expect(result).toBe(true);
    });

    it('returns false when planStatus=HANDOVER even if bubbles succeeded', () => {
      const result = service.shouldExecute({ succeeded: 3, planStatus: 'HANDOVER' }, 'contact_1');
      expect(result).toBe(false);
    });

    it('returns false when all bubbles failed (succeeded=0)', () => {
      const result = service.shouldExecute({ succeeded: 0, planStatus: 'PLANNED' }, 'contact_1');
      expect(result).toBe(false);
    });

    it('returns false when contactId is null', () => {
      const result = service.shouldExecute({ succeeded: 1, planStatus: 'PLANNED' }, null);
      expect(result).toBe(false);
    });

    it('returns false when contactId is empty string', () => {
      const result = service.shouldExecute({ succeeded: 1, planStatus: 'PLANNED' }, '');
      expect(result).toBe(false);
    });
  });

  describe('executeDeferredTagActions', () => {
    const tenantId = 'tenant_1';
    const conversationId = 'conv_1';
    const contactId = 'contact_1';
    const ghlLocationId = 'loc_1';

    function mockLoadDeferredTagIntents(intents: Array<{ id: string; params: Record<string, unknown> }>) {
      return jestGlobal.spyOn(service as never, 'loadDeferredTagIntents').mockResolvedValue(intents);
    }

    function mockGetIntentStatus(intentId: string, status: string | null) {
      return jestGlobal.spyOn(service as never, 'getIntentStatus').mockResolvedValue(status);
    }

    function mockLoadGhlCredentials(credentials: { token: string } | null) {
      return jestGlobal.spyOn(service as never, 'loadGhlCredentials').mockResolvedValue(credentials);
    }

    function mockUpdateIntentStatusAtomic(intentId: string, result: boolean) {
      return jestGlobal.spyOn(service as never, 'updateIntentStatusAtomic').mockResolvedValue(result);
    }

    it('no DEFERRED intents → returns empty array, no GHL call', async () => {
      mockLoadDeferredTagIntents([]);

      const results = await service.executeDeferredTagActions(
        tenantId,
        conversationId,
        contactId,
        ghlLocationId,
      );

      expect(results).toHaveLength(0);
      expect(mockGhlClient.tagContact).not.toHaveBeenCalled();
    });

    it('DEFERRED intent → GHL called, status updated to EXECUTED', async () => {
      const intent = { id: 'intent_1', params: { tags: ['vip', 'warm'] } };
      mockLoadDeferredTagIntents([intent]);
      mockGetIntentStatus('intent_1', 'DEFERRED');
      mockLoadGhlCredentials({ token: 'tok_xxx' });
      mockUpdateIntentStatusAtomic('intent_1', true);
      (mockGhlClient.tagContact as jest.Mock).mockResolvedValue({ success: true });

      const results = await service.executeDeferredTagActions(
        tenantId,
        conversationId,
        contactId,
        ghlLocationId,
      );

      expect(results).toHaveLength(1);
      expect(results[0]!.status).toBe('EXECUTED');
      expect(mockGhlClient.tagContact).toHaveBeenCalledWith({
        contactId,
        tags: ['vip', 'warm'],
      });
    });

    it('GHL API failure → status updated to FAILED, errorNote stored', async () => {
      const intent = { id: 'intent_1', params: { tags: ['vip'] } };
      mockLoadDeferredTagIntents([intent]);
      mockGetIntentStatus('intent_1', 'DEFERRED');
      mockLoadGhlCredentials({ token: 'tok_xxx' });
      mockUpdateIntentStatusAtomic('intent_1', true);
      jestGlobal.spyOn(service as never, 'updateIntentStatus').mockResolvedValue(undefined);
      (mockGhlClient.tagContact as jest.Mock).mockResolvedValue({
        success: false,
        error: 'Contact not found',
      });

      const results = await service.executeDeferredTagActions(
        tenantId,
        conversationId,
        contactId,
        ghlLocationId,
      );

      expect(results).toHaveLength(1);
      expect(results[0]!.status).toBe('FAILED');
      expect(results[0]!.errorNote).toBe('Contact not found');
    });

    it('intent already EXECUTED → skipped silently, no GHL call', async () => {
      mockLoadDeferredTagIntents([{ id: 'intent_1', params: { tags: ['vip'] } }]);
      mockGetIntentStatus('intent_1', 'EXECUTED');

      const results = await service.executeDeferredTagActions(
        tenantId,
        conversationId,
        contactId,
        ghlLocationId,
      );

      expect(results).toHaveLength(0);
      expect(mockGhlClient.tagContact).not.toHaveBeenCalled();
    });

    it('missing GHL credentials → status updated to FAILED', async () => {
      const intent = { id: 'intent_1', params: { tags: ['vip'] } };
      mockLoadDeferredTagIntents([intent]);
      mockGetIntentStatus('intent_1', 'DEFERRED');
      mockLoadGhlCredentials(null);

      const updateSpy = jestGlobal.spyOn(service as never, 'updateIntentStatus');
      updateSpy.mockResolvedValue(undefined);

      const results = await service.executeDeferredTagActions(
        tenantId,
        conversationId,
        contactId,
        ghlLocationId,
      );

      expect(results).toHaveLength(1);
      expect(results[0]!.status).toBe('FAILED');
      expect(results[0]!.errorNote).toContain('GHL credentials not found');
      expect(mockGhlClient.tagContact).not.toHaveBeenCalled();
    });
  });

  describe('shouldExecute + executeDeferredTagActions integration (send skipped)', () => {
    it('send skipped (succeeded=0) → shouldExecute false → no tag execution', async () => {
      const conditions = { succeeded: 0, planStatus: 'PLANNED' };
      const contactId = 'contact_1';

      const shouldRun = service.shouldExecute(conditions, contactId);
      expect(shouldRun).toBe(false);

      // Even if somehow called, no intents would be found
      const loadSpy = jestGlobal.spyOn(service as never, 'loadDeferredTagIntents').mockResolvedValue([]);
      const results = await service.executeDeferredTagActions(
        'tenant_1',
        'conv_1',
        contactId,
        'loc_1',
      );
      expect(results).toHaveLength(0);
      expect(mockGhlClient.tagContact).not.toHaveBeenCalled();
      loadSpy.mockRestore();
    });
  });

  // ---------------------------------------------------------------------------
  // BOOK_SLOT execution tests
  // ---------------------------------------------------------------------------

  describe('executeDeferredBookSlotActions', () => {
    const tenantId = 'tenant_1';
    const conversationId = 'conv_1';
    const contactId = 'contact_1';
    const ghlLocationId = 'loc_1';

    function mockLoadDeferredBookSlotIntents(intents: Array<{ id: string; params: Record<string, unknown> }>) {
      return jestGlobal.spyOn(service as never, 'loadDeferredBookSlotIntents').mockResolvedValue(intents);
    }

    function mockGetIntentStatus(intentId: string, status: string | null) {
      return jestGlobal.spyOn(service as never, 'getIntentStatus').mockResolvedValue(status);
    }

    function mockLoadGhlCredentials(credentials: { token: string } | null) {
      return jestGlobal.spyOn(service as never, 'loadGhlCredentials').mockResolvedValue(credentials);
    }

    function mockUpdateIntentStatusAtomic(intentId: string, result: boolean) {
      return jestGlobal.spyOn(service as never, 'updateIntentStatusAtomic').mockResolvedValue(result);
    }

    it('no DEFERRED intents → returns empty array, no API call', async () => {
      mockLoadDeferredBookSlotIntents([]);

      const warnSpy = jestGlobal.spyOn(Logger.prototype, 'warn');
      const results = await service.executeDeferredBookSlotActions(
        tenantId,
        conversationId,
        contactId,
        ghlLocationId,
      );

      expect(results).toHaveLength(0);
      expect(mockGhlClient.bookSlot).not.toHaveBeenCalled();
      const joinedWarns = warnSpy.mock.calls.map(c => String(c[0] ?? '')).join(' ');
      expect(joinedWarns).not.toMatch(/Deferred BOOK_SLOT.*disabled/i);
      warnSpy.mockRestore();
    });

    it('valid DEFERRED intent → GHL bookSlot called, status updated to EXECUTED', async () => {
      const intent = {
        id: 'intent_1',
        params: { calendarId: 'cal_1', startTime: '2026-05-01T10:00:00', endTime: '2026-05-01T10:30:00' },
      };
      mockLoadDeferredBookSlotIntents([intent]);
      mockGetIntentStatus('intent_1', 'DEFERRED');
      mockLoadGhlCredentials({ token: 'tok_xxx' });
      mockUpdateIntentStatusAtomic('intent_1', true);
      (mockGhlClient.bookSlot as jest.Mock).mockResolvedValue({ success: true, appointmentId: 'appt_1' });

      const results = await service.executeDeferredBookSlotActions(
        tenantId,
        conversationId,
        contactId,
        ghlLocationId,
      );

      expect(results).toHaveLength(1);
      expect(results[0]!.status).toBe('EXECUTED');
      expect(mockGhlClient.bookSlot).toHaveBeenCalledWith({
        locationId: ghlLocationId,
        calendarId: 'cal_1',
        contactId,
        startTime: '2026-05-01T10:00:00',
        endTime: '2026-05-01T10:30:00',
        title: undefined,
        timezone: undefined,
        appointmentStatus: undefined,
      });
    });

    it('GHL API failure → status updated to FAILED, errorNote stored', async () => {
      const intent = {
        id: 'intent_1',
        params: { calendarId: 'cal_1', startTime: '2026-05-01T10:00:00', endTime: '2026-05-01T10:30:00' },
      };
      mockLoadDeferredBookSlotIntents([intent]);
      mockGetIntentStatus('intent_1', 'DEFERRED');
      mockLoadGhlCredentials({ token: 'tok_xxx' });
      mockUpdateIntentStatusAtomic('intent_1', true);
      jestGlobal.spyOn(service as never, 'updateIntentStatus').mockResolvedValue(undefined);
      (mockGhlClient.bookSlot as jest.Mock).mockResolvedValue({
        success: false,
        error: 'Contact not found',
      });

      const results = await service.executeDeferredBookSlotActions(
        tenantId,
        conversationId,
        contactId,
        ghlLocationId,
      );

      expect(results).toHaveLength(1);
      expect(results[0]!.status).toBe('FAILED');
      expect(results[0]!.errorNote).toBe('Contact not found');
    });

    it('incomplete params only { detected: true } → FAILED without API call', async () => {
      const intent = { id: 'intent_1', params: { detected: true } };
      mockLoadDeferredBookSlotIntents([intent]);
      mockGetIntentStatus('intent_1', 'DEFERRED');
      jestGlobal.spyOn(service as never, 'updateIntentStatus').mockResolvedValue(undefined);

      const results = await service.executeDeferredBookSlotActions(
        tenantId,
        conversationId,
        contactId,
        ghlLocationId,
      );

      expect(results).toHaveLength(1);
      expect(results[0]!.status).toBe('FAILED');
      expect(results[0]!.errorNote).toContain('MISSING_BOOKING_PARAMS');
      expect(results[0]!.errorNote).toContain('placeholder');
      expect(mockGhlClient.bookSlot).not.toHaveBeenCalled();
    });

    it('missing required param (no startTime) → FAILED without API call', async () => {
      const intent = { id: 'intent_1', params: { calendarId: 'cal_1', endTime: '2026-05-01T10:30:00' } };
      mockLoadDeferredBookSlotIntents([intent]);
      mockGetIntentStatus('intent_1', 'DEFERRED');
      jestGlobal.spyOn(service as never, 'updateIntentStatus').mockResolvedValue(undefined);

      const results = await service.executeDeferredBookSlotActions(
        tenantId,
        conversationId,
        contactId,
        ghlLocationId,
      );

      expect(results).toHaveLength(1);
      expect(results[0]!.status).toBe('FAILED');
      expect(results[0]!.errorNote).toContain('MISSING_BOOKING_PARAMS');
      expect(results[0]!.errorNote).toContain('startTime');
      expect(mockGhlClient.bookSlot).not.toHaveBeenCalled();
    });

    it('intent already EXECUTED → skipped silently, no API call', async () => {
      mockLoadDeferredBookSlotIntents([{ id: 'intent_1', params: { calendarId: 'cal_1', startTime: '2026-05-01T10:00:00', endTime: '2026-05-01T10:30:00' } }]);
      mockGetIntentStatus('intent_1', 'EXECUTED');

      const results = await service.executeDeferredBookSlotActions(
        tenantId,
        conversationId,
        contactId,
        ghlLocationId,
      );

      expect(results).toHaveLength(0);
      expect(mockGhlClient.bookSlot).not.toHaveBeenCalled();
    });

    it('missing GHL credentials → status updated to FAILED', async () => {
      const intent = {
        id: 'intent_1',
        params: { calendarId: 'cal_1', startTime: '2026-05-01T10:00:00', endTime: '2026-05-01T10:30:00' },
      };
      mockLoadDeferredBookSlotIntents([intent]);
      mockGetIntentStatus('intent_1', 'DEFERRED');
      mockLoadGhlCredentials(null);
      jestGlobal.spyOn(service as never, 'updateIntentStatus').mockResolvedValue(undefined);

      const results = await service.executeDeferredBookSlotActions(
        tenantId,
        conversationId,
        contactId,
        ghlLocationId,
      );

      expect(results).toHaveLength(1);
      expect(results[0]!.status).toBe('FAILED');
      expect(results[0]!.errorNote).toContain('GHL credentials not found');
      expect(mockGhlClient.bookSlot).not.toHaveBeenCalled();
    });
  });

  describe('shouldExecute + executeDeferredBookSlotActions integration (send skipped)', () => {
    it('send skipped (succeeded=0) → shouldExecute false → no book execution', async () => {
      const conditions = { succeeded: 0, planStatus: 'PLANNED' };
      const shouldRun = service.shouldExecute(conditions, 'contact_1');
      expect(shouldRun).toBe(false);

      const loadSpy = jestGlobal.spyOn(service as never, 'loadDeferredBookSlotIntents').mockResolvedValue([]);
      const results = await service.executeDeferredBookSlotActions(
        'tenant_1',
        'conv_1',
        'contact_1',
        'loc_1',
      );
      expect(results).toHaveLength(0);
      expect(mockGhlClient.bookSlot).not.toHaveBeenCalled();
      loadSpy.mockRestore();
    });
  });
});
