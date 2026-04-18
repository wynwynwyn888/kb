// Supabase client configuration for frontend

import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env['NEXT_PUBLIC_SUPABASE_URL'] || 'http://localhost:54321';
const supabaseAnonKey = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] || 'your-anon-key';

let supabaseClient: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!supabaseClient) {
    supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    });
  }
  return supabaseClient;
}

export function getSupabaseUrl(): string {
  return supabaseUrl;
}

export function getSupabaseAnonKey(): string {
  return supabaseAnonKey;
}

// Auth user type
export interface AuthUser {
  id: string;
  email: string;
  role?: string;
  profileId?: string;
  agencyId?: string;
  tenantId?: string;
  fullName?: string;
}

export interface Tenant {
  id: string;
  name: string;
  ghlLocationId: string;
  status: string;
}

export interface Agency {
  id: string;
  name: string;
  role: string;
}