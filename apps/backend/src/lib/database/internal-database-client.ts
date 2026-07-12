import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseService } from '../supabase';

/**
 * Unrestricted RLS-bypassing client for classified internal adapters only.
 * User-facing controllers must never import this module.
 */
export function getInternalDatabaseClient(): SupabaseClient {
  return getSupabaseService();
}
