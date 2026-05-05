import { describe, expect, it } from 'vitest';
import { getVaultActivityAt, sortVaultsForDisplay } from './knowledge-vault-activity';
import type { KbDocumentRow, KbVaultRow } from './api';

function vault(partial: Partial<KbVaultRow> & Pick<KbVaultRow, 'id' | 'name'>): KbVaultRow {
  return {
    description: null,
    isDefault: false,
    documentCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T12:00:00.000Z',
    ...partial,
  };
}

function doc(partial: Partial<KbDocumentRow> & Pick<KbDocumentRow, 'id' | 'title' | 'source' | 'status'>): KbDocumentRow {
  return {
    ...partial,
  };
}

describe('getVaultActivityAt', () => {
  it('uses vault.updatedAt when there are no documents in the vault', () => {
    const v = vault({ id: 'v1', name: 'A', updatedAt: '2026-02-01T10:00:00.000Z' });
    const docs: KbDocumentRow[] = [
      doc({
        id: 'd1',
        title: 'x',
        source: 'faq',
        status: 'READY',
        vaultId: 'other',
        updatedAt: '2026-06-01T00:00:00.000Z',
      }),
    ];
    expect(getVaultActivityAt(v, docs)).toBe('2026-02-01T10:00:00.000Z');
  });

  it('uses newer document updatedAt when doc is newer than vault metadata', () => {
    const v = vault({ id: 'v1', name: 'A', updatedAt: '2026-02-01T10:00:00.000Z' });
    const docs: KbDocumentRow[] = [
      doc({
        id: 'd1',
        title: 'FAQ',
        source: 'faq',
        status: 'READY',
        vaultId: 'v1',
        updatedAt: '2026-05-10T15:30:00.000Z',
      }),
    ];
    expect(getVaultActivityAt(v, docs)).toBe(new Date('2026-05-10T15:30:00.000Z').toISOString());
  });
});

describe('sortVaultsForDisplay', () => {
  it('places default vault first regardless of activity', () => {
    const olderDefault = vault({
      id: 'def',
      name: 'Default',
      isDefault: true,
      updatedAt: '2020-01-01T00:00:00.000Z',
    });
    const newerOther = vault({
      id: 'o1',
      name: 'Other',
      isDefault: false,
      updatedAt: '2026-06-01T00:00:00.000Z',
    });
    const sorted = sortVaultsForDisplay([newerOther, olderDefault], []);
    expect(sorted.map(x => x.id)).toEqual(['def', 'o1']);
  });

  it('sorts non-default vaults by activity then name', () => {
    const a = vault({ id: 'a', name: 'Alpha', isDefault: false, updatedAt: '2026-01-01T00:00:00.000Z' });
    const b = vault({ id: 'b', name: 'Bravo', isDefault: false, updatedAt: '2026-03-01T00:00:00.000Z' });
    const docs: KbDocumentRow[] = [
      doc({ id: 'd1', title: 't', source: 'faq', status: 'READY', vaultId: 'a', updatedAt: '2026-06-01T00:00:00.000Z' }),
    ];
    const sorted = sortVaultsForDisplay([b, a], docs);
    expect(sorted.map(x => x.id)).toEqual(['a', 'b']);
  });
});
