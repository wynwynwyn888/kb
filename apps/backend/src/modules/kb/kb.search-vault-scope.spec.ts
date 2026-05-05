import { jest as jestGlobal } from '@jest/globals';

import { KbService } from './kb.service';

const fromMock = jestGlobal.fn();

jestGlobal.mock('../../lib/supabase', () => ({
  getSupabaseService: () => ({ from: fromMock }),
}));

describe('KbService.searchKnowledge vault scope', () => {
  let service: KbService;

  beforeEach(() => {
    fromMock.mockReset();
    service = new KbService();
  });

  it('applies vault_id filter when vaultId is set (Knowledge page search)', async () => {
    const eqTenant = jestGlobal.fn();
    const eqStatus = jestGlobal.fn();
    const eqVault = jestGlobal.fn().mockResolvedValue({
      data: [{ id: 'd1', title: 'T', source: 'faq', updated_at: '2020-01-01' }],
      error: null,
    });
    eqTenant.mockReturnValue({ eq: eqStatus });
    eqStatus.mockReturnValue({ eq: eqVault });
    const docSelect = jestGlobal.fn().mockReturnValue({ eq: eqTenant });
    fromMock.mockImplementation((table: string) => {
      if (table === 'knowledge_documents') {
        return { select: docSelect };
      }
      if (table === 'knowledge_chunks') {
        return {
          select: () => ({
            in: () =>
              Promise.resolve({
                data: [
                  {
                    id: 'ch1',
                    document_id: 'd1',
                    content: 'hello vault phrase',
                    metadata: {},
                  },
                ],
                error: null,
              }),
          }),
        };
      }
      return {};
    });

    await service.searchKnowledge({
      tenantId: 'tenant-1',
      query: 'phrase',
      topK: 5,
      vaultId: 'vault-aa',
    });

    expect(eqVault).toHaveBeenCalledWith('vault_id', 'vault-aa');
  });
});
