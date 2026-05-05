/** User-facing copy for vault delete rules (Knowledge page + API). */
export const KB_VAULT_DELETE_HAS_DOCUMENTS_MSG =
  "Move or delete this vault's knowledge items before deleting the vault.";

export function kbDuplicateVaultDisplayName(originalName: string): string {
  const t = originalName.trim();
  return t ? `${t} copy` : 'Vault copy';
}
