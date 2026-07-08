import { jest } from '@jest/globals';
import {
  CONVERSATION_MEMORY_MESSAGE_LIMIT,
  CONVERSATION_MEMORY_SESSION_GAP_MS,
  ConversationMemoryLoader,
} from './conversation-memory-loader';

const mockLimit = jest.fn();
const mockGt = jest.fn();
let mockRows: Array<Record<string, unknown>> = [];

jest.mock('../../lib/supabase', () => ({
  getSupabaseService: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          gt: mockGt.mockImplementation(() => ({
            order: () => ({
              limit: mockLimit.mockImplementation(() =>
                Promise.resolve({
                  data: mockRows,
                  error: null,
                })),
            }),
          })),
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

  it('scopes memory after /new and removes reset command/confirmation rows from prompt history', async () => {
    const now = Date.now();
    const resetAt = new Date(now - 20_000).toISOString();
    mockRows = [
      {
        id: 'm5',
        direction: 'INBOUND',
        sender: 'CONTACT',
        content: 'Hi',
        contentType: 'TEXT',
        created_at: new Date(now - 5_000).toISOString(),
      },
      {
        id: 'm4',
        direction: 'OUTBOUND',
        sender: 'AI',
        content: 'Started a fresh chat for this conversation.\n\nYou can test from here.',
        contentType: 'TEXT',
        created_at: new Date(now - 10_000).toISOString(),
      },
      {
        id: 'm3',
        direction: 'INBOUND',
        sender: 'CONTACT',
        content: '/new',
        contentType: 'TEXT',
        created_at: resetAt,
      },
    ];

    const loader = new ConversationMemoryLoader();
    const mem = await loader.loadMemory('conv_reset', { memoryResetAfterIso: resetAt });

    expect(mockGt).toHaveBeenCalledWith('created_at', resetAt);
    expect(mem.entries.map(e => e.content)).toEqual(['Hi']);
    expect(mem.turnCount).toBe(1);
  });

  it('collapses nearby duplicate prompt rows from webhook plus GHL sync', async () => {
    const now = Date.now();
    mockRows = [
      {
        id: 'm4',
        direction: 'OUTBOUND',
        sender: 'AI',
        content: 'Hello there',
        contentType: 'TEXT',
        created_at: new Date(now - 1_000).toISOString(),
      },
      {
        id: 'm3',
        direction: 'INBOUND',
        sender: 'CONTACT',
        content: 'hi',
        contentType: 'TEXT',
        created_at: new Date(now - 2_000).toISOString(),
        metadata: { ingestSource: 'webhook' },
      },
      {
        id: 'm2',
        direction: 'INBOUND',
        sender: 'CONTACT',
        content: 'hi',
        contentType: 'TEXT',
        created_at: new Date(now - 4_000).toISOString(),
        metadata: { ingestSource: 'ghl-sync' },
      },
      {
        id: 'm1',
        direction: 'INBOUND',
        sender: 'CONTACT',
        content: 'hi',
        contentType: 'TEXT',
        created_at: new Date(now - 30_000).toISOString(),
        metadata: { ingestSource: 'webhook' },
      },
    ];

    const loader = new ConversationMemoryLoader();
    const mem = await loader.loadMemory('conv_dupes');

    expect(mem.entries.map(e => e.content)).toEqual(['hi', 'hi', 'Hello there']);
    expect(mem.turnCount).toBe(2);
  });
});
