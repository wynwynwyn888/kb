import type { AgencyProviderSnapshot } from '@/lib/api';

/** Providers with a working live adapter in the backend today. */
export function hasLiveGeneration(saveableProvider: string): boolean {
  const p = saveableProvider.toUpperCase();
  return p === 'OPENAI' || p === 'MINIMAX';
}

export function snapshotFor(
  provider: string,
  snapshots: Partial<Record<string, AgencyProviderSnapshot>> | undefined,
  fallbacks: { defaultModel: string; maxTokens: number; temperature: number },
): AgencyProviderSnapshot {
  const snap = snapshots?.[provider];
  if (snap) {
    return {
      defaultModel: snap.defaultModel || fallbacks.defaultModel,
      maxTokens: snap.maxTokens ?? fallbacks.maxTokens,
      temperature: snap.temperature ?? fallbacks.temperature,
      hasKey: snap.hasKey,
      ...(snap.minimaxGroupId ? { minimaxGroupId: snap.minimaxGroupId } : {}),
    };
  }
  return {
    defaultModel: fallbacks.defaultModel,
    maxTokens: fallbacks.maxTokens,
    temperature: fallbacks.temperature,
    hasKey: false,
  };
}
