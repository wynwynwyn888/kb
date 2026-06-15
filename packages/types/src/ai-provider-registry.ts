/** Controlled agency-level live AI providers and models (OpenAI + MiniMax only). */

export const AGENCY_LIVE_AI_PROVIDERS = ['OPENAI', 'MINIMAX'] as const;
export type AgencyLiveAiProvider = (typeof AGENCY_LIVE_AI_PROVIDERS)[number];

export type AgencyLiveModelTier = 'cost-effective' | 'balanced' | 'premium' | 'default' | 'highspeed';

export type AgencyLiveModelDef = {
  id: string;
  label: string;
  tier: AgencyLiveModelTier;
};

export const AI_LIVE_PROVIDER_REGISTRY: Record<
  AgencyLiveAiProvider,
  { label: string; models: readonly AgencyLiveModelDef[] }
> = {
  OPENAI: {
    label: 'OpenAI',
    models: [
      { id: 'gpt-4o-mini', label: 'GPT-4o mini', tier: 'cost-effective' },
      { id: 'gpt-4o', label: 'GPT-4o', tier: 'premium' },
      { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini', tier: 'balanced' },
      { id: 'gpt-4.1', label: 'GPT-4.1', tier: 'premium' },
    ],
  },
  MINIMAX: {
    label: 'MiniMax',
    models: [
      { id: 'MiniMax-M3', label: 'MiniMax M3 (vision)', tier: 'default' },
      { id: 'MiniMax-M2.7', label: 'MiniMax M2.7', tier: 'balanced' },
      { id: 'MiniMax-M2.7-highspeed', label: 'MiniMax M2.7 Highspeed', tier: 'highspeed' },
    ],
  },
} as const;

export const OPENAI_DEFAULT_API_BASE = 'https://api.openai.com/v1';
export const MINIMAX_DEFAULT_API_BASE = 'https://api.minimax.io/v1';

const OPENAI_IDS = new Set(AI_LIVE_PROVIDER_REGISTRY.OPENAI.models.map(m => m.id));
const MINIMAX_IDS = new Set(AI_LIVE_PROVIDER_REGISTRY.MINIMAX.models.map(m => m.id));

export function isAgencyLiveAiProvider(p: string): p is AgencyLiveAiProvider {
  const u = p.toUpperCase();
  return u === 'OPENAI' || u === 'MINIMAX';
}

export function isModelAllowedForLiveProvider(provider: string, model: string): boolean {
  const u = provider.toUpperCase();
  const m = model.trim();
  if (u === 'OPENAI') return OPENAI_IDS.has(m);
  if (u === 'MINIMAX') return MINIMAX_IDS.has(m);
  return false;
}

export function defaultModelForLiveProvider(provider: string): string {
  return provider.toUpperCase() === 'MINIMAX' ? 'MiniMax-M3' : 'gpt-4o-mini';
}

/** Agencies saved before M3 default still have MiniMax-M2.7 in settings — treat as M3 unless highspeed. */
export function upgradeLegacyMinimaxDefaultModel(model: string): string {
  const m = model.trim();
  if (m === 'MiniMax-M2.7') return 'MiniMax-M3';
  return m;
}

/** Returns a registry-approved model id, or the provider default when missing/invalid. */
export function normalizeModelForLiveProvider(provider: string, model: string | null | undefined): string {
  const p = provider.toUpperCase();
  if (!isAgencyLiveAiProvider(p)) return defaultModelForLiveProvider('OPENAI');
  const m = (model ?? '').trim();
  let resolved = m;
  if (!isModelAllowedForLiveProvider(p, m)) {
    resolved = defaultModelForLiveProvider(p);
  }
  if (p === 'MINIMAX') {
    resolved = upgradeLegacyMinimaxDefaultModel(resolved);
  }
  return resolved;
}

export function listModelIdsForLiveProvider(provider: string): readonly string[] {
  const p = provider.toUpperCase();
  if (!isAgencyLiveAiProvider(p)) return [];
  return AI_LIVE_PROVIDER_REGISTRY[p].models.map(m => m.id);
}
