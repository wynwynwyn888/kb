// Jest test setup

// AES-256-GCM requires a 32-byte UTF-8 key. Set only under Jest so integration/unit
// tests can encrypt/decrypt fixtures without weakening production (no dev fallback flag).
if (typeof process.env.JEST_WORKER_ID !== 'undefined' && !process.env.ENCRYPTION_KEY?.trim()) {
  process.env.ENCRYPTION_KEY = '12345678901234567890123456789012';
}

// Silence NestJS logger during tests
jest.mock('../lib/supabase', () => ({
  getSupabaseService: jest.fn(() => ({
    from: jest.fn(),
    insert: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    select: jest.fn(),
  })),
}));

// Clear all mocks before each test
beforeEach(() => {
  jest.clearAllMocks();
});
