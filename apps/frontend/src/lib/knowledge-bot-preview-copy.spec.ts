import { describe, expect, it } from 'vitest';
import {
  KNOWLEDGE_BOT_PREVIEW_DESCRIPTION,
  KNOWLEDGE_BOT_PREVIEW_SUMMARY,
} from './knowledge-bot-preview-copy';

describe('Knowledge bot preview disclosure copy', () => {
  it('uses accurate non-vault-scoped labeling', () => {
    expect(KNOWLEDGE_BOT_PREVIEW_SUMMARY).toBe('Preview bot reply');
    expect(KNOWLEDGE_BOT_PREVIEW_DESCRIPTION).toContain('active AI Agent profile');
    expect(KNOWLEDGE_BOT_PREVIEW_DESCRIPTION).toContain('AI Agent Instructions');
  });
});
