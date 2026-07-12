// Supabase client configuration
// Uses Supabase for auth and database access
//
// Read process.env inside factories (not at module top level). Otherwise the first
// import of this module can run before Nest ConfigModule loads `.env`, and clients
// would keep wrong URL/keys for the whole process.

import { createClient, SupabaseClient } from '@supabase/supabase-js';

const serviceAuth = {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
} as const;

const clientAuthPersist = {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
  },
} as const;

let memoService: { client: SupabaseClient; sig: string } | undefined;
let memoAnonServer: { client: SupabaseClient; sig: string } | undefined;
let memoAnonClient: { client: SupabaseClient; sig: string } | undefined;

function envUrl(): string {
  return process.env['SUPABASE_URL'] ?? 'http://localhost:54321';
}

function envServiceKey(): string {
  return process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? 'your-service-role-key';
}

function envAnonKey(): string {
  return process.env['SUPABASE_ANON_KEY'] ?? 'your-anon-key';
}

// Client for server-side operations with service role (bypasses RLS)
/** @deprecated New code must use a caller-scoped client or the classified internal adapter. */
export function getSupabaseService(): SupabaseClient {
  const sig = `${envUrl()}\0${envServiceKey()}`;
  if (!memoService || memoService.sig !== sig) {
    memoService = { client: createClient(envUrl(), envServiceKey(), serviceAuth), sig };
  }
  return memoService.client;
}

// Client for client-side operations (respects RLS)
export function getSupabaseClient(): SupabaseClient {
  const sig = `${envUrl()}\0${envAnonKey()}`;
  if (!memoAnonClient || memoAnonClient.sig !== sig) {
    memoAnonClient = { client: createClient(envUrl(), envAnonKey(), clientAuthPersist), sig };
  }
  return memoAnonClient.client;
}

// Client for server-side API operations (uses anon key, respects RLS)
export function getSupabaseServer(): SupabaseClient {
  const sig = `${envUrl()}\0${envAnonKey()}`;
  if (!memoAnonServer || memoAnonServer.sig !== sig) {
    memoAnonServer = { client: createClient(envUrl(), envAnonKey(), serviceAuth), sig };
  }
  return memoAnonServer.client;
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
  /** Complete membership facts for centralized authorization; never serialized by auth endpoints. */
  accessContext?: {
    profileId: string;
    membershipStatus: 'complete' | 'partial' | 'failed';
    agencyMemberships: Array<{ agencyId: string; role: 'OWNER' | 'ADMIN' | 'OPERATOR' | 'MEMBER' }>;
    tenantMemberships: Array<{
      tenantId: string;
      agencyId: string;
      role: 'ADMIN' | 'AGENT' | 'VIEWER';
    }>;
  };
}
