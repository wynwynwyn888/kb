import { jest as jestGlobal } from '@jest/globals';

import { ConversationsService } from './conversations.service';
import { createMockSupabase } from '../../test/mock-supabase';

const mockSupabase = createMockSupabase();
jestGlobal.mock('../../lib/supabase', () => ({
  getSupabaseService: () => mockSupabase,
}));

function makeResult(data: unknown, error: unknown = null) {
  return { data, error };
}

describe('ConversationsService — automation events', () => {
  let service: ConversationsService;
  let eventsInsertMock: jest.Mock;

  beforeEach(() => {
    jestGlobal.clearAllMocks();
    eventsInsertMock = jestGlobal.fn(async () => makeResult({ id: 'evt_new' }));

    (mockSupabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'conversations') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => makeResult({ status: 'ACTIVE' }),
            }),
          }),
          update: () => ({
            eq: jestGlobal.fn(async () => makeResult(null)),
          }),
        } as never;
      }
      if (table === 'conversation_automation_events') {
        return {
          insert: eventsInsertMock,
        } as never;
      }
      return {} as never;
    });

    service = new ConversationsService();
  });

  describe('setAutomationState', () => {
    it('records automation event on pause with all fields', async () => {
      // Override conversations mock to return PAUSED status
      (mockSupabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'conversations') {
          return {
            select: () => ({
              eq: () => ({
                single: async () => makeResult({ status: 'ACTIVE' }),
              }),
            }),
            update: () => ({
              eq: jestGlobal.fn(async () => makeResult(null)),
            }),
          } as never;
        }
        if (table === 'conversation_automation_events') {
          return { insert: eventsInsertMock } as never;
        }
        return {} as never;
      });

      const prev = await service.setAutomationState(
        'conv_1',
        'PAUSED',
        'user_1',
        'admin@test.com',
        'customer request',
      );

      expect(prev).toBe('ACTIVE');
      expect(eventsInsertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          conversation_id: 'conv_1',
          previous_state: 'ACTIVE',
          new_state: 'PAUSED',
          actor_id: 'user_1',
          actor_email: 'admin@test.com',
          reason: 'customer request',
        }),
      );
    });

    it('records automation event on resume', async () => {
      (mockSupabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'conversations') {
          return {
            select: () => ({
              eq: () => ({
                single: async () => makeResult({ status: 'PAUSED' }),
              }),
            }),
            update: () => ({
              eq: jestGlobal.fn(async () => makeResult(null)),
            }),
          } as never;
        }
        if (table === 'conversation_automation_events') {
          return { insert: eventsInsertMock } as never;
        }
        return {} as never;
      });

      const prev = await service.setAutomationState('conv_1', 'ACTIVE');

      expect(prev).toBe('PAUSED');
      expect(eventsInsertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          previous_state: 'PAUSED',
          new_state: 'ACTIVE',
          actor_id: null,
          actor_email: null,
          reason: null,
        }),
      );
    });

    it('records event with null previousState when conversation not found', async () => {
      (mockSupabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'conversations') {
          return {
            select: () => ({
              eq: () => ({
                single: async () => makeResult(null, { code: 'PGRST116' }),
              }),
            }),
            update: () => ({
              eq: jestGlobal.fn(async () => makeResult(null)),
            }),
          } as never;
        }
        if (table === 'conversation_automation_events') {
          return { insert: eventsInsertMock } as never;
        }
        return {} as never;
      });

      const prev = await service.setAutomationState('conv_missing', 'PAUSED');

      expect(prev).toBeNull();
      expect(eventsInsertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          previous_state: null,
          new_state: 'PAUSED',
        }),
      );
    });
  });

  describe('getAutomationEvents', () => {
    let eventsSelectMock: jest.Mock;

    beforeEach(() => {
      eventsSelectMock = jestGlobal.fn(() => ({
        eq: jestGlobal.fn(() => ({
          order: jestGlobal.fn(() => ({
            limit: jestGlobal.fn(async () => makeResult(null)),
          })),
        })),
      }));
    });

    it('returns events mapped correctly', async () => {
      const events = [
        { id: 'e2', previous_state: 'ACTIVE', new_state: 'PAUSED', actor_id: 'u1', actor_email: 'a@b.com', reason: 'test', created_at: '2026-04-19T12:00:00Z' },
        { id: 'e1', previous_state: null, new_state: 'ACTIVE', actor_id: null, actor_email: null, reason: null, created_at: '2026-04-19T11:00:00Z' },
      ];

      (mockSupabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'conversation_automation_events') {
          return {
            select: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => Promise.resolve(makeResult(events)),
                }),
              }),
            }),
          } as never;
        }
        return {} as never;
      });

      const result = await service.getAutomationEvents('conv_1');

      expect(result).toHaveLength(2);
      expect(result[0]!).toMatchObject({
        id: 'e2',
        previousState: 'ACTIVE',
        newState: 'PAUSED',
        actorId: 'u1',
        actorEmail: 'a@b.com',
        reason: 'test',
      });
      expect(result[1]!).toMatchObject({
        id: 'e1',
        previousState: null,
        newState: 'ACTIVE',
      });
    });

    it('returns empty array when no events', async () => {
      (mockSupabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'conversation_automation_events') {
          return {
            select: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => Promise.resolve(makeResult([])),
                }),
              }),
            }),
          } as never;
        }
        return {} as never;
      });

      const result = await service.getAutomationEvents('conv_no_events');
      expect(result).toEqual([]);
    });

    it('returns empty array on error', async () => {
      (mockSupabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'conversation_automation_events') {
          return {
            select: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => Promise.resolve(makeResult(null, { message: 'DB error' })),
                }),
              }),
            }),
          } as never;
        }
        return {} as never;
      });

      const result = await service.getAutomationEvents('conv_1');
      expect(result).toEqual([]);
    });
  });
});
