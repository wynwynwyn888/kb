import { createClient, type SupabaseClient } from '@supabase/supabase-js';

function requiredEnvironment(name: 'SUPABASE_URL' | 'SUPABASE_ANON_KEY'): string {
  const value = String(process.env[name] ?? '').trim();
  if (!value) throw new Error(`${name} is required for caller-scoped database access`);
  return value;
}

function validRawAccessToken(accessToken: string): string {
  const token = String(accessToken ?? '').trim();
  if (!token || token.length > 16_384 || /^Bearer\s/i.test(token) || /\s/.test(token)) {
    throw new Error('A valid raw caller access token is required');
  }
  return token;
}

/**
 * Creates a fresh caller-scoped Supabase client. Never memoize this by process:
 * doing so could reuse one user's Authorization header for another request.
 */
export function createUserDatabaseClient(accessToken: string): SupabaseClient {
  const token = validRawAccessToken(accessToken);
  return createClient(requiredEnvironment('SUPABASE_URL'), requiredEnvironment('SUPABASE_ANON_KEY'), {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}
