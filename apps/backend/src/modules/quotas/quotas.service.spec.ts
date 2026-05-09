import { jest as jestGlobal } from '@jest/globals';
import { QuotasService } from './quotas.service';
import { createMockSupabase, mockFrom } from '../../test/mock-supabase';

const mockSupabase = createMockSupabase();

jestGlobal.mock('../../lib/supabase', () => ({
  getSupabaseService: () => mockSupabase,
}));

describe('QuotasService', () => {
  let service: QuotasService;

  beforeEach(() => {
    jestGlobal.clearAllMocks();
    service = new QuotasService({ add: jest.fn() } as never);
  });

  describe('getTenantUsageSummary', () => {
    it('returns a stable zero snapshot when no quota_wallets row exists', async () => {
      mockFrom(mockSupabase, 'quota_wallets', null);
      const r = await service.getTenantUsageSummary('tenant-uuid-1');
      expect(r.tenantId).toBe('tenant-uuid-1');
      expect(r.totalQuota).toBe(0);
      expect(r.usedQuota).toBe(0);
      expect(r.balance).toBe(0);
      expect(r.usedToday).toBe(0);
      expect(r.usedThisMonth).toBe(0);
      expect(r.usedThisYear).toBe(0);
      expect(r.status).toBe('ACTIVE');
    });

    it('returns wallet balance from quota_wallets when a row exists', async () => {
      const wid = 'wallet-1';
      mockFrom(mockSupabase, 'quota_wallets', {
        id: wid,
        tenant_id: 't1',
        total_quota: 5000,
        used_quota: 0,
        allow_negative_credits: false,
        negative_credit_limit: 0,
        low_credit_threshold: 100,
      });
      mockFrom(mockSupabase, 'quota_ledgers', []);
      const r = await service.getTenantUsageSummary('t1');
      expect(r.balance).toBe(5000);
      expect(r.totalQuota).toBe(5000);
      expect(r.usedQuota).toBe(0);
      expect(r.usedThisYear).toBe(0);
    });
  });
});
