/** Align with backend `tenant_bot_profiles.knowledge_access_mode`. */
export const KNOWLEDGE_ACCESS_ALL_VAULTS = 'all_vaults';
export const KNOWLEDGE_ACCESS_SELECTED_VAULTS = 'selected_vaults';

/** Legacy — `tenant_bot_profiles.knowledge_scope_mode` (synced server-side). */
export const KNOWLEDGE_SCOPE_ALL_WORKSPACE = 'all_workspace_knowledge';
export const KNOWLEDGE_SCOPE_SELECTED_COLLECTIONS = 'selected_collections';

/** Short label for profile cards (sidebar / compact). */
export function knowledgeVaultAccessCardLabel(
  accessMode: string | undefined,
  selectedVaultCount: number,
): string {
  const m = accessMode?.trim();
  if (m === KNOWLEDGE_ACCESS_SELECTED_VAULTS) {
    if (selectedVaultCount <= 0) return 'Selected vaults (none)';
    return `${selectedVaultCount} selected vault${selectedVaultCount === 1 ? '' : 's'}`;
  }
  return 'All knowledge vaults';
}

/** Active assistant hero line: “Vaults: …” right-hand phrase only. */
export function activeAssistantVaultsSummary(
  accessMode: string | undefined,
  selectedVaultCount: number,
): string {
  const m = accessMode?.trim();
  if (m === KNOWLEDGE_ACCESS_SELECTED_VAULTS && selectedVaultCount > 0) {
    return `${selectedVaultCount} selected`;
  }
  if (m === KNOWLEDGE_ACCESS_SELECTED_VAULTS) {
    return 'None selected';
  }
  return 'All knowledge vaults';
}

export function formatProfileUpdatedAt(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
}
