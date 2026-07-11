import { jest as jestGlobal } from '@jest/globals';

import { HandoverService } from './handover.service';
import { createMockSupabase } from '../../test/mock-supabase';

const mockGhlService = {
  createGhlClientForConnectedTenantWorkerOrThrow: jestGlobal.fn(),
};

const mockSupabase = createMockSupabase();
jestGlobal.mock('../../lib/supabase', () => ({
  getSupabaseService: () => mockSupabase,
}));

jestGlobal.mock('@nestjs/bullmq', () => ({
  InjectQueue: () => jestGlobal.fn(),
  Queue: jestGlobal.fn(() => ({ add: jestGlobal.fn() })) as never,
}));

describe('HandoverService', () => {
  let service: HandoverService;

  beforeEach(() => {
    jestGlobal.clearAllMocks();
    service = new HandoverService(mockGhlService as never);
  });

  describe('initiate', () => {
    it('creates handover event and updates conversation status to HANDOVER', async () => {
      const insert = jestGlobal.fn(() => ({
        select: () => ({
          single: jestGlobal.fn(async () => ({ data: { id: 'he_new' }, error: null })),
        }),
      }));
      (mockSupabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'handover_events') {
          return {
            insert,
          } as never;
        }
        if (table === 'conversations') {
          return {
            update: jestGlobal.fn(() => ({
              eq: jestGlobal.fn(async () => ({ data: null, error: null })),
            })),
          } as never;
        }
        return {} as never;
      });

      const id = await service.initiate('tenant_1', 'conv_1', 'REQUEST', 'AI', 'Test note');

      expect(id).toBe('he_new');
      expect(insert).toHaveBeenCalledWith(expect.objectContaining({
        tenant_id: 'tenant_1',
        conversation_id: 'conv_1',
      }));
    });
  });

  describe('resume', () => {
    it('updates event to RESUMED and conversation to ACTIVE', async () => {
      let updateEventCalled = false;
      let updateConvCalled = false;

      (mockSupabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'handover_events') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  eq: () => ({ single: async () => ({ data: { id: 'he_1' }, error: null }) }),
                }),
              }),
            }),
            update: jestGlobal.fn(() => {
              return {
                eq: jestGlobal.fn(() => ({
                  eq: jestGlobal.fn(async () => {
                    updateEventCalled = true;
                    return { data: null, error: null };
                  }),
                })),
              };
            }),
          } as never;
        }
        if (table === 'conversations') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    metadata: {
                      humanEscalationInternalAlertSentAt: '2026-05-17T11:00:00.000Z',
                    },
                  },
                  error: null,
                }),
              }),
            }),
            update: jestGlobal.fn(() => ({
              eq: jestGlobal.fn(async () => {
                updateConvCalled = true;
                return { data: null, error: null };
              }),
            })),
          } as never;
        }
        return {} as never;
      });

      await service.resume('tenant_1', 'conv_1');

      expect(updateEventCalled).toBe(true);
      expect(updateConvCalled).toBe(true);
    });

    it('no-op when no active handover event', async () => {
      let updateConvCalled = false;

      (mockSupabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'handover_events') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  eq: () => ({ single: async () => ({ data: null, error: { code: 'PGRST116' } }) }),
                }),
              }),
            }),
          } as never;
        }
        if (table === 'conversations') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: { metadata: {} }, error: null }),
              }),
            }),
            update: jestGlobal.fn(() => ({
              eq: jestGlobal.fn(async () => {
                updateConvCalled = true;
                return { data: null, error: null };
              }),
            })),
          } as never;
        }
        return {} as never;
      });

      await service.resume('tenant_1', 'conv_no_handover');

      expect(updateConvCalled).toBe(true);
    });
  });

  describe('getActiveHandover', () => {
    it('returns null when no active handover', async () => {
      (mockSupabase.from as jest.Mock).mockReturnValue({
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({ single: async () => ({ data: null, error: { code: 'PGRST116' } }) }),
            }),
          }),
        }),
      } as never);

      const result = await service.getActiveHandover('tenant_1', 'conv_1');
      expect(result).toBeNull();
    });

    it('returns handover event when found', async () => {
      (mockSupabase.from as jest.Mock).mockReturnValue({
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({ single: async () => ({
                data: { id: 'he_1', type: 'REQUEST', initiated_by: 'AI', note: 'test', created_at: '2026-01-01' },
                error: null,
              }) }),
            }),
          }),
        }),
      } as never);

      const result = await service.getActiveHandover('tenant_1', 'conv_1');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('he_1');
    });
  });
});
