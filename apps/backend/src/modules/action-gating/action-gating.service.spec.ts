import { jest as jestGlobal } from '@jest/globals';

import { ActionGatingService } from './action-gating.service';
import { createMockSupabase } from '../../test/mock-supabase';

const mockSupabase = createMockSupabase();
jestGlobal.mock('../../lib/supabase', () => ({
  getSupabaseService: () => mockSupabase,
}));

describe('ActionGatingService', () => {
  let service: ActionGatingService;

  beforeEach(() => {
    jestGlobal.clearAllMocks();
    // Default: insert succeeds
    (mockSupabase.from as jest.Mock).mockReturnValue({
      insert: jestGlobal.fn(async () => ({ data: null, error: null })),
    } as never);
    service = new ActionGatingService();
  });

  describe('gateAction', () => {
    const gate = (type: string) => (service as never)['gateAction']({ type, params: {}, reason: '' });

    it('TAG_CONTACT → DEFERRED', () => {
      expect(gate('TAG_CONTACT')).toMatchObject({ status: 'DEFERRED', actionType: 'TAG_CONTACT' });
    });

    it('BOOK_SLOT → DEFERRED', () => {
      expect(gate('BOOK_SLOT')).toMatchObject({ status: 'DEFERRED' });
    });

    it('ESCALATE → DEFERRED', () => {
      expect(gate('ESCALATE')).toMatchObject({ status: 'DEFERRED' });
    });

    it('TRANSFER → DEFERRED', () => {
      expect(gate('TRANSFER')).toMatchObject({ status: 'DEFERRED' });
    });

    it('unknown type → BLOCKED', () => {
      const result = gate('UNKNOWN_ACTION');
      expect(result.status).toBe('BLOCKED');
    });
  });

  describe('gateActions', () => {
    it('calls persistIntent once per action', async () => {
      const actions = [
        { type: 'TAG_CONTACT' as const, params: { tags: ['vip'] }, reason: 'test' },
        { type: 'BOOK_SLOT' as const, params: { detected: true }, reason: 'test' },
      ];

      const persistSpy = jestGlobal.spyOn(service as never, 'persistIntent');

      await service.gateActions(actions, 'tenant_1', 'conv_1', 'AI');

      expect(persistSpy).toHaveBeenCalledTimes(2);
    });

    it('returns gating results for all actions', async () => {
      const actions = [
        { type: 'TAG_CONTACT' as const, params: {}, reason: 'test' },
        { type: 'UNKNOWN' as const, params: {}, reason: 'test' },
      ];

      const results = await service.gateActions(actions, 'tenant_1', 'conv_1');
      expect(results.length).toBe(2);
      expect(results[0]!.status).toBe('DEFERRED');
      expect(results[1]!.status).toBe('BLOCKED');
    });
  });

  describe('persistIntent error handling', () => {
    it('errors are logged and not thrown', async () => {
      (mockSupabase.from as jest.Mock).mockReturnValue({
        insert: jestGlobal.fn(async () => ({ data: null, error: { message: 'DB error' } })),
      } as never);

      await expect(
        service.gateActions([{ type: 'TAG_CONTACT', params: {}, reason: 'test' }], 'tenant_1', 'conv_1')
      ).resolves.not.toThrow();
    });
  });
});
