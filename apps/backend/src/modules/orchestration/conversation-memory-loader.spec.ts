import { jest } from '@jest/globals';
import {
  CONVERSATION_MEMORY_MESSAGE_LIMIT,
  CONVERSATION_MEMORY_SESSION_GAP_MS,
  ConversationMemoryLoader,
} from './conversation-memory-loader';

const mockLimit = jest.fn();
let mockRows: Array<Record<string, unknown>> = [];

jest.mock('../../lib/supabase', () => ({
  getSupabaseService: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: mockLimit.mockImplementation(() =>
              Promise.resolve({
                data: mockRows,
                error: null,
              })),
          }),
        }),
      }),
    }),
  }),
}));

describe('ConversationMemoryLoader', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRows = [
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
    ];
  });

  it('returns empty memory when last message is older than 24h', async () => {
    const loader = new ConversationMemoryLoader();
    const mem = await loader.loadMemory('conv_gap');
    expect(mem.entries).toHaveLength(0);
    expect(mem.turnCount).toBe(0);
  });

  it('loads the latest 30 total messages including GHL outbound context', async () => {
    const now = Date.now();
    mockRows = [
      {
        id: 'm3',
        direction: 'INBOUND',
        sender: 'CONTACT',
        content: 'Can I book?',
        contentType: 'TEXT',
        created_at: new Date(now - 1000).toISOString(),
      },
      {
        id: 'm2',
        direction: 'OUTBOUND',
        sender: 'SYSTEM',
        content: 'Workflow offer: book today for 10% off',
        contentType: 'TEXT',
        created_at: new Date(now - 2000).toISOString(),
      },
      {
        id: 'm1',
        direction: 'INBOUND',
        sender: 'CONTACT',
        content: 'Hi',
        contentType: 'TEXT',
        created_at: new Date(now - 3000).toISOString(),
      },
    ];

    const loader = new ConversationMemoryLoader();
    const mem = await loader.loadMemory('conv_recent');

    expect(mockLimit).toHaveBeenCalledWith(CONVERSATION_MEMORY_MESSAGE_LIMIT);
    expect(mem.entries.map(e => e.content)).toEqual([
      'Hi',
      'Workflow offer: book today for 10% off',
      'Can I book?',
    ]);
    expect(mem.entries[1]?.role).toBe('assistant');
    expect(mem.turnCount).toBe(2);
  });
});
