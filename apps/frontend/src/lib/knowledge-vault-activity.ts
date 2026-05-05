import type { KbDocumentRow, KbVaultRow } from '@/lib/api';
import { parseApiInstantMs } from './datetime-display';

/**
 * Latest activity for a vault: metadata changes to the vault row, or any
 * document create/edit/move/delete in that vault (uses document updatedAt).
 */
export function getVaultActivityAt(vault: KbVaultRow, documents: KbDocumentRow[]): string {
  let maxMs = parseApiInstantMs(vault.updatedAt) ?? 0;
  for (const d of documents) {
    if (d.vaultId !== vault.id) continue;
    for (const iso of [d.updatedAt, d.createdAt]) {
      const ms = parseApiInstantMs(iso);
      if (ms != null && ms > maxMs) maxMs = ms;
    }
  }
  if (maxMs <= 0) return vault.updatedAt;
  return new Date(maxMs).toISOString();
}

/**
 * Display order: default vault first, then by last activity (newest first), then name.
 * TODO: optional manual order — add `sortOrder` / `orderIndex` on `knowledge_vaults`, drag handle on cards, persist PATCH after drag; keep default vault pinned first.
 */
export function sortVaultsForDisplay(vaults: KbVaultRow[], documents: KbDocumentRow[]): KbVaultRow[] {
  const copy = [...vaults];
  copy.sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    const actA = parseApiInstantMs(getVaultActivityAt(a, documents)) ?? 0;
    const actB = parseApiInstantMs(getVaultActivityAt(b, documents)) ?? 0;
    if (actA !== actB) return actB - actA;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
  return copy;
}
