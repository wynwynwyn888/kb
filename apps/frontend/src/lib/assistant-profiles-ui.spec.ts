import { describe, expect, it } from 'vitest';
import {
  KNOWLEDGE_SCOPE_ALL_WORKSPACE,
  KNOWLEDGE_SCOPE_SELECTED_COLLECTIONS,
  formatProfileUpdatedAt,
  knowledgeScopeCardLabel,
  knowledgeScopeSentence,
} from './assistant-profiles-ui';

describe('assistant-profiles-ui', () => {
  it('knowledgeScopeCardLabel defaults to all workspace', () => {
    expect(knowledgeScopeCardLabel(undefined)).toBe('All workspace knowledge');
    expect(knowledgeScopeCardLabel(KNOWLEDGE_SCOPE_ALL_WORKSPACE)).toBe('All workspace knowledge');
  });

  it('knowledgeScopeCardLabel maps selected collections', () => {
    expect(knowledgeScopeCardLabel(KNOWLEDGE_SCOPE_SELECTED_COLLECTIONS)).toBe('Selected collections');
  });

  it('knowledgeScopeSentence includes Knowledge prefix', () => {
    expect(knowledgeScopeSentence(KNOWLEDGE_SCOPE_ALL_WORKSPACE)).toContain('All workspace knowledge');
    expect(knowledgeScopeSentence(KNOWLEDGE_SCOPE_SELECTED_COLLECTIONS)).toContain('Selected collections');
  });

  it('formatProfileUpdatedAt parses ISO', () => {
    const s = formatProfileUpdatedAt('2026-05-04T12:00:00.000Z');
    expect(s.length).toBeGreaterThan(4);
  });
});
