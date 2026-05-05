import type { KbDocumentRow } from '@/lib/api';

/** Default vault if marked, otherwise first vault in list order. */
export function selectDefaultVaultId(vaults: Array<{ id: string; isDefault: boolean }>): string {
  if (!vaults.length) return '';
  const d = vaults.find(v => v.isDefault);
  return d?.id ?? vaults[0]!.id;
}

/** Keep previous selection when still valid; otherwise pick default/first. */
export function resolveSelectedVaultId(
  vaults: Array<{ id: string; isDefault: boolean }>,
  previous: string,
): string {
  if (!vaults.length) return '';
  if (previous && vaults.some(v => v.id === previous)) return previous;
  return selectDefaultVaultId(vaults);
}

export function vaultScopedDocuments(docs: KbDocumentRow[], vaultId: string): KbDocumentRow[] {
  if (!vaultId) return [];
  return docs.filter(d => d.vaultId === vaultId);
}

export function knowledgeSearchPlaceholder(vaultName: string): string {
  const n = vaultName.trim();
  return n ? `Search inside ${n}…` : 'Search…';
}
