// Simple mock factory for Supabase client
// Uses jest.fn() directly — no complex chainable types needed

export interface MockDbResult<T = unknown> {
  data: T | null;
  error: { message: string; code?: string } | null;
}

// Creates a chainable mock for a query result
function makeQueryResult(data: unknown, error: unknown = null) {
  const result = { data, error: error ?? null };
  return {
    select: jest.fn(() => makeQueryResult(data, error)),
    eq: jest.fn(() => makeQueryResult(data, error)),
    in: jest.fn(() => makeQueryResult(data, error)),
    order: jest.fn(() => makeQueryResult(data, error)),
    limit: jest.fn(() => makeQueryResult(data, error)),
    gte: jest.fn(() => makeQueryResult(data, error)),
    single: jest.fn(async () => result),
    maybeSingle: jest.fn(async () => result),
  };
}

// Creates a chainable mock for insert result (select is chained, not awaited)
function makeInsertResult(data: unknown, error: unknown = null) {
  const result = { data, error: error ?? null };
  return {
    select: jest.fn(() => makeQueryResult(data, error)),
    single: jest.fn(async () => result),
  };
}

// Creates a chainable mock for update/delete result (eq/select/single are chained, not awaited)
function makeUpdateResult(data: unknown, error: unknown = null) {
  const result = { data, error: error ?? null };
  return {
    eq: jest.fn(() => makeUpdateResult(data, error)),
    select: jest.fn(() => makeQueryResult(data, error)),
    single: jest.fn(async () => result),
    maybeSingle: jest.fn(async () => result),
  };
}

// Creates a mock that resolves to the given data
export function createMockSupabase<T = unknown>(mockData: T | null = null, mockError: unknown = null) {
  const fromMock = jest.fn(() => makeQueryResult(null, null) as never);
  const insertMock = jest.fn(() => makeInsertResult(null, null) as never);
  const updateMock = jest.fn(() => makeUpdateResult(null, null) as never);
  const deleteMock = jest.fn(() => makeUpdateResult(null, null) as never);

  return {
    from: fromMock,
    insert: insertMock,
    update: updateMock,
    delete: deleteMock,
  };
}

// Sets up mock to return specific data for one table
// Note: uses mockImplementation so it doesn't conflict with other mockFrom calls
export function mockFrom(
  supabase: ReturnType<typeof createMockSupabase>,
  table: string,
  data: unknown,
  error: unknown = null
) {
  const result = { data, error: error ?? null };
  const prevImpl = (supabase.from as jest.Mock).getMockImplementation();
  (supabase.from as jest.Mock).mockImplementation((tableName: string) => {
    if (tableName === table) {
      return {
        select: jest.fn(() => makeQueryResult(data, error)),
        insert: jest.fn(() => makeInsertResult(data, error)),
        update: jest.fn(() => makeUpdateResult(data, error)),
        delete: jest.fn(() => makeUpdateResult(data, error)),
      } as never;
    }
    // Fall back to previous implementation or default
    return prevImpl ? prevImpl(tableName) : makeQueryResult(null, null);
  });
}
