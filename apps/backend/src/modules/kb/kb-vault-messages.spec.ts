import { describe, expect, it } from '@jest/globals';
import { KB_VAULT_DELETE_HAS_DOCUMENTS_MSG, kbDuplicateVaultDisplayName } from './kb-vault-messages';

describe('kb-vault-messages', () => {
  it('kbDuplicateVaultDisplayName appends copy', () => {
    expect(kbDuplicateVaultDisplayName('LUMIÈRE HAIR ATELIER')).toBe('LUMIÈRE HAIR ATELIER copy');
  });

  it('KB_VAULT_DELETE_HAS_DOCUMENTS_MSG is stable copy', () => {
    expect(KB_VAULT_DELETE_HAS_DOCUMENTS_MSG).toContain('Move or delete');
  });
});
