/**
 * Model UI for agency live AI — options come from `liveAiCatalog` on GET /agency-ai-config when available.
 */
import type { LiveAiCatalogDto } from '@/lib/api';
import { AI_LIVE_PROVIDER_REGISTRY } from '@aisbp/types';

export type ModelOption = { value: string; label: string };

export type ModelFieldResult =
  | {
      mode: 'list';
      options: ModelOption[];
      defaultModel: string;
    }
  | { mode: 'text'; defaultModel: string };

export const PROVIDER_LABEL: Record<string, string> = {
  OPENAI: AI_LIVE_PROVIDER_REGISTRY.OPENAI.label,
  MINIMAX: AI_LIVE_PROVIDER_REGISTRY.MINIMAX.label,
};

export const AGENCY_LIVE_PROVIDER_ORDER = ['MINIMAX', 'OPENAI'] as const;

export function catalogProviderIds(catalog?: LiveAiCatalogDto | null): Array<'OPENAI' | 'MINIMAX'> {
  if (catalog?.providers?.length) {
    return catalog.providers.map(p => p.id);
  }
  return [...AGENCY_LIVE_PROVIDER_ORDER];
}

export function getModelFieldForProvider(provider: string, catalog?: LiveAiCatalogDto | null): ModelFieldResult {
  const p = provider.toUpperCase();
  if (p === 'OPENAI' || p === 'MINIMAX') {
    const models =
      catalog?.modelsByProvider?.[p as 'OPENAI' | 'MINIMAX'] ?? AI_LIVE_PROVIDER_REGISTRY[p as 'OPENAI' | 'MINIMAX'].models;
    const options: ModelOption[] = models.map(m => ({ value: m.id, label: m.label }));
    const defaultModel = p === 'MINIMAX' ? 'MiniMax-M2.7' : 'gpt-4o-mini';
    return { mode: 'list', options, defaultModel };
  }
  return {
    mode: 'list',
    options: AI_LIVE_PROVIDER_REGISTRY.OPENAI.models.map(m => ({ value: m.id, label: m.label })),
    defaultModel: 'gpt-4o-mini',
  };
}
