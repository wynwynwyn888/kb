import { jest as jestGlobal } from '@jest/globals';
import { ConversationMemoryLoader } from './conversation-memory-loader';

const mockFrom = jestGlobal.fn();

jestGlobal.mock('../../lib/supabase', () => ({
  getSupabaseService: () => ({
    from: mockFrom,
  }),
}));

describe('ConversationMemoryLoader', () => {
  let loader: ConversationMemoryLoader;

  beforeEach(() => {
    jestGlobal.clearAllMocks();
    loader = new ConversationMemoryLoader();
  });

  it('only includes messages with created_at strictly after memoryResetAt', async () => {
    mockFrom.mockReturnValue({
      select: () => ({
        eq: () => ({
          order: () =>
            Promise.resolve({
              data: [
                {
                  id: 'o',
                  direction: 'INBOUND',
                  sender: 'CONTACT',
                  content: 'before reset',
                  contentType: 'TEXT',
                  created_at: '2026-01-01T11:00:00.000Z',
                },
                {
                  id: 'n',
                  direction: 'INBOUND',
                  sender: 'CONTACT',
                  content: 'after reset',
                  contentType: 'TEXT',
                  created_at: '2026-01-01T12:00:01.000Z',
                },
              ],
              error: null,
            }),
        }),
      }),
    });

    const mem = await loader.loadMemory('conv-1', {
      memoryResetAfterIso: '2026-01-01T12:00:00.000Z',
    });
    const texts = mem.entries.map(e => e.content);
    expect(texts.some(t => t.includes('before reset'))).toBe(false);
    expect(texts.some(t => t.includes('after reset'))).toBe(true);
  });
});
