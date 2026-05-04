import { describe, expect, it } from 'vitest';
import {
  KNOWLEDGE_ACCESS_ALL_VAULTS,
  KNOWLEDGE_ACCESS_SELECTED_VAULTS,
  knowledgeVaultAccessCardLabel,
} from './assistant-profiles-ui';

describe('assistant-profiles-ui', () => {
  it('knowledgeVaultAccessCardLabel defaults to all vaults', () => {
    expect(knowledgeVaultAccessCardLabel(undefined, 0)).toBe('All knowledge vaults');
    expect(knowledgeVaultAccessCardLabel(KNOWLEDGE_ACCESS_ALL_VAULTS, 0)).toBe('All knowledge vaults');
  });

  it('knowledgeVaultAccessCardLabel formats selected vault counts', () => {
    expect(knowledgeVaultAccessCardLabel(KNOWLEDGE_ACCESS_SELECTED_VAULTS, 0)).toBe('Selected vaults (none)');
    expect(knowledgeVaultAccessCardLabel(KNOWLEDGE_ACCESS_SELECTED_VAULTS, 1)).toBe('1 selected vault');
    expect(knowledgeVaultAccessCardLabel(KNOWLEDGE_ACCESS_SELECTED_VAULTS, 3)).toBe('3 selected vaults');
  });
});
