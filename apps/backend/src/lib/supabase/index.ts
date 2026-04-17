// Supabase client configuration
// Uses Supabase for auth and database access

import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || 'http://localhost:54321';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'your-service-role-key';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || 'your-anon-key';

// Client for server-side operations with service role (bypasses RLS)
export function getSupabaseService(): SupabaseClient {
  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

// Client for client-side operations (respects RLS)
export function getSupabaseClient(): SupabaseClient {
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
    },
  });
}

// Client for server-side API operations (uses anon key, respects RLS)
export function getSupabaseServer(): SupabaseClient {
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export interface AuthUser {
  id: string;
  email: string;
  role: 'agency_owner' | 'agency_admin' | 'agency_operator' | 'agency_member' | 'tenant_admin' | 'tenant_agent' | 'tenant_viewer';
  profileId: string;
  agencyId?: string;
  tenantId?: string;
}

export interface SessionUser {
  id: string;
  email: string;
  profile?: {
    id: string;
    fullName?: string;
    avatarUrl?: string;
  };
  agencyRole?: 'OWNER' | 'ADMIN' | 'OPERATOR' | 'MEMBER';
  tenantRole?: 'ADMIN' | 'AGENT' | 'VIEWER';
  agencyId?: string;
  tenantId?: string;
}