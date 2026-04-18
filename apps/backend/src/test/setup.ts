// Jest test setup

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
