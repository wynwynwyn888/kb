import { jest } from '@jest/globals';
import {
  CONVERSATION_MEMORY_SESSION_GAP_MS,
  ConversationMemoryLoader,
} from './conversation-memory-loader';

jest.mock('../../lib/supabase', () => ({
  getSupabaseService: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: () =>
              Promise.resolve({
                data: [
                  {
                    id: 'm1',
                    direction: 'INBOUND',
                    sender: 'CONTACT',
                    content: 'old',
                    contentType: 'TEXT',
                    created_at: new Date(
                      Date.now() - CONVERSATION_MEMORY_SESSION_GAP_MS - 60_000,
                    ).toISOString(),
                  },
                ],
                error: null,
              }),
          }),
        }),
      }),
    }),
  }),
}));

describe('ConversationMemoryLoader', () => {
  it('returns empty memory when last message is older than 24h', async () => {
    const loader = new ConversationMemoryLoader();
    const mem = await loader.loadMemory('conv_gap');
    expect(mem.entries).toHaveLength(0);
    expect(mem.turnCount).toBe(0);
  });
});
