// OpenAI embedding key/endpoint resolver for the RAG shadow lane.
//
// Mirrors the agency provider resolution used by generation:
//   tenant -> agency -> agency_model_providers(OPENAI) -> usable key + endpoint.
//
// SKELETON: this resolver is intentionally NOT wired into any runtime path in
// this change. It is exported for unit testing and for the later shadow
// processor to consume. It performs no work unless explicitly called.

import { isUsableOpenAiFallbackKey } from '../../../lib/ai-live-model-resolve';

/**
 * Minimal Supabase-like surface this resolver needs. Kept structural so it can
 * be unit-tested with a stub and so this module has no Nest/DI coupling yet.
 */
interface SupabaseFilterBuilder {
  eq(column: string, value: string): SupabaseFilterBuilder;
  maybeSingle(): Promise<{ data: unknown; error: unknown }>;
}

export interface SupabaseLikeClient {
  from(table: string): {
    select(columns: string): SupabaseFilterBuilder;
  };
}

export interface ResolvedOpenAiEmbeddingCredentials {
  apiKey: string;
  /** Custom base URL / endpoint override when the agency configured one. */
  endpoint: string | null;
}

export type OpenAiEmbeddingKeyResolution =
  | { ok: true; credentials: ResolvedOpenAiEmbeddingCredentials }
  | { ok: false; reason: 'no_agency' | 'no_openai_row' | 'unusable_key' };

/**
 * Resolve usable OpenAI embedding credentials for a tenant, or a structured
 * reason why none are available. Never throws for the "missing key" cases —
 * callers fall back to keyword retrieval safely.
 */
export async function resolveOpenAiEmbeddingCredentials(
  supabase: SupabaseLikeClient,
  tenantId: string,
): Promise<OpenAiEmbeddingKeyResolution> {
  const tenantRes = await supabase
    .from('tenants')
    .select('agency_id')
    .eq('id', tenantId)
    .maybeSingle();
  const agencyId = (tenantRes.data as { agency_id?: string | null } | null)?.agency_id ?? null;
  if (!agencyId) return { ok: false, reason: 'no_agency' };

  const providerRes = await supabase
    .from('agency_model_providers')
    .select('api_key, endpoint')
    .eq('agency_id', agencyId)
    .eq('provider', 'OPENAI')
    .maybeSingle();
  const row =
    (providerRes.data as { api_key?: string | null; endpoint?: string | null } | null) ?? null;
  if (!row) return { ok: false, reason: 'no_openai_row' };

  if (!isUsableOpenAiFallbackKey(row.api_key)) {
    return { ok: false, reason: 'unusable_key' };
  }

  const endpoint =
    typeof row.endpoint === 'string' && row.endpoint.trim() ? row.endpoint.trim() : null;
  return { ok: true, credentials: { apiKey: row.api_key as string, endpoint } };
}
