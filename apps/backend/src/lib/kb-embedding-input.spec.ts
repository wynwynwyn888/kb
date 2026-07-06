import {
  prepareEmbeddingInput,
  embeddingInputHash,
  prepareEmbeddingInputWithHash,
  MAX_EMBEDDING_INPUT_CHARS,
} from './kb-embedding-input';

describe('kb-embedding-input', () => {
  describe('prepareEmbeddingInput', () => {
    it('returns short input unchanged', () => {
      expect(prepareEmbeddingInput('hello world')).toBe('hello world');
    });

    it('returns input exactly at the cap unchanged', () => {
      const s = 'a'.repeat(MAX_EMBEDDING_INPUT_CHARS);
      expect(prepareEmbeddingInput(s)).toBe(s);
      expect(prepareEmbeddingInput(s).length).toBe(MAX_EMBEDDING_INPUT_CHARS);
    });

    it('truncates oversized input to the cap with a ... suffix', () => {
      const s = 'a'.repeat(MAX_EMBEDDING_INPUT_CHARS + 500);
      const out = prepareEmbeddingInput(s);
      expect(out.length).toBe(MAX_EMBEDDING_INPUT_CHARS);
      expect(out.endsWith('...')).toBe(true);
    });

    it('handles null/undefined-ish input safely', () => {
      expect(prepareEmbeddingInput(undefined as unknown as string)).toBe('');
    });
  });

  describe('embeddingInputHash', () => {
    it('is deterministic for identical input', () => {
      expect(embeddingInputHash('same')).toBe(embeddingInputHash('same'));
    });

    it('differs when content changes', () => {
      expect(embeddingInputHash('a')).not.toBe(embeddingInputHash('b'));
    });

    it('produces a 64-char hex sha256', () => {
      expect(embeddingInputHash('x')).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('prepareEmbeddingInputWithHash', () => {
    it('hashes the prepared (truncated) input, not the raw input', () => {
      const raw = 'z'.repeat(MAX_EMBEDDING_INPUT_CHARS + 100);
      const { input, hash } = prepareEmbeddingInputWithHash(raw);
      expect(input.length).toBe(MAX_EMBEDDING_INPUT_CHARS);
      expect(hash).toBe(embeddingInputHash(input));
      // Raw hash must not match, proving parity is on the prepared text.
      expect(hash).not.toBe(embeddingInputHash(raw));
    });
  });
});
