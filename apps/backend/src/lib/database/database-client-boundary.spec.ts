import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const createClient = jest.fn(() => ({ kind: 'supabase-client' }));
jest.mock('@supabase/supabase-js', () => ({ createClient: (...args: unknown[]) => createClient(...args) }));

function filesBelow(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesBelow(path) : [path];
  });
}

describe('database client boundary', () => {
  const previousUrl = process.env['SUPABASE_URL'];
  const previousAnon = process.env['SUPABASE_ANON_KEY'];

  beforeEach(() => {
    createClient.mockClear();
    process.env['SUPABASE_URL'] = 'https://project.supabase.co';
    process.env['SUPABASE_ANON_KEY'] = 'anon-public-key';
  });

  afterAll(() => {
    if (previousUrl === undefined) delete process.env['SUPABASE_URL'];
    else process.env['SUPABASE_URL'] = previousUrl;
    if (previousAnon === undefined) delete process.env['SUPABASE_ANON_KEY'];
    else process.env['SUPABASE_ANON_KEY'] = previousAnon;
  });

  it('creates a fresh anon-key client carrying only the caller JWT', async () => {
    const { createUserDatabaseClient } = await import('./user-database-client');
    const first = createUserDatabaseClient('jwt-one');
    const second = createUserDatabaseClient('jwt-two');
    expect(first).not.toBe(second);
    expect(createClient).toHaveBeenNthCalledWith(1, 'https://project.supabase.co', 'anon-public-key', {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: 'Bearer jwt-one' } },
    });
    expect(createClient).toHaveBeenNthCalledWith(2, 'https://project.supabase.co', 'anon-public-key', {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: 'Bearer jwt-two' } },
    });
  });

  it.each(['', ' ', 'Bearer token', 'token with spaces'])(
    'rejects malformed raw token %p before constructing a client',
    async token => {
      const { createUserDatabaseClient } = await import('./user-database-client');
      expect(() => createUserDatabaseClient(token)).toThrow('valid raw caller access token');
      expect(createClient).not.toHaveBeenCalled();
    },
  );

  it('rejects an oversized token before constructing a client', async () => {
    const { createUserDatabaseClient } = await import('./user-database-client');
    expect(() => createUserDatabaseClient('x'.repeat(16_385))).toThrow('valid raw caller access token');
    expect(createClient).not.toHaveBeenCalled();
  });

  it('keeps service-role clients out of every controller', () => {
    const controllers = filesBelow(join(process.cwd(), 'src/modules'))
      .filter(path => path.endsWith('.controller.ts'));
    for (const path of controllers) {
      const source = readFileSync(path, 'utf8');
      expect(source).not.toContain('getSupabaseService');
      expect(source).not.toContain('getInternalDatabaseClient');
      expect(source).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
    }
  });

  it('ratchets legacy service-role consumers so new files cannot be added', () => {
    const sourceRoot = join(process.cwd(), 'src');
    const consumers = filesBelow(sourceRoot).filter(path => {
      const local = relative(sourceRoot, path).replaceAll('\\', '/');
      if (!path.endsWith('.ts') || /\.(spec|test)\.ts$/.test(path)) return false;
      if (local.startsWith('integration/') || local.startsWith('scripts/') || local.startsWith('test/')) return false;
      if (local === 'lib/supabase/index.ts' || local === 'lib/database/internal-database-client.ts') return false;
      return readFileSync(path, 'utf8').includes('getSupabaseService');
    });
    expect(consumers.length).toBeLessThanOrEqual(59);
  });

  it('keeps the caller client source free of service credentials and token logging', () => {
    const source = readFileSync(join(process.cwd(), 'src/lib/database/user-database-client.ts'), 'utf8');
    expect(source).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(source).not.toMatch(/console\.|Logger|safeLog/);
    expect(source).toContain("requiredEnvironment('SUPABASE_ANON_KEY')");
  });
});
