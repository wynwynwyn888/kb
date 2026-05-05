import { describe, expect, it } from 'vitest';
import {
  knowledgeSearchPlaceholder,
  resolveSelectedVaultId,
  selectDefaultVaultId,
  vaultScopedDocuments,
} from './knowledge-vault-scope';
import type { KbDocumentRow } from './api';

describe('knowledge-vault-scope', () => {
  it('selectDefaultVaultId prefers isDefault', () => {
    const id = selectDefaultVaultId([
      { id: 'a', isDefault: false },
      { id: 'b', isDefault: true },
    ]);
    expect(id).toBe('b');
  });

  it('selectDefaultVaultId falls back to first', () => {
    const id = selectDefaultVaultId([
      { id: 'x', isDefault: false },
      { id: 'y', isDefault: false },
    ]);
    expect(id).toBe('x');
  });

  it('resolveSelectedVaultId keeps valid previous', () => {
    const id = resolveSelectedVaultId(
      [
        { id: 'a', isDefault: true },
        { id: 'b', isDefault: false },
      ],
      'b',
    );
    expect(id).toBe('b');
  });

  it('resolveSelectedVaultId resets stale selection', () => {
    const id = resolveSelectedVaultId([{ id: 'a', isDefault: true }], 'gone');
    expect(id).toBe('a');
  });

  it('vaultScopedDocuments filters by vaultId', () => {
    const docs = [
      { id: '1', title: 'A', source: 'faq', status: 'READY', vaultId: 'v1' },
      { id: '2', title: 'B', source: 'faq', status: 'READY', vaultId: 'v2' },
    ] as unknown as KbDocumentRow[];
    expect(vaultScopedDocuments(docs, 'v1')).toHaveLength(1);
    expect(vaultScopedDocuments(docs, 'v1')[0]!.id).toBe('1');
  });

  it('knowledgeSearchPlaceholder includes vault name', () => {
    expect(knowledgeSearchPlaceholder('DapperDog')).toBe('Search inside DapperDog…');
  });
});
