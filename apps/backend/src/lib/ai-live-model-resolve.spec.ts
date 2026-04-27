import { jest as jestGlobal } from '@jest/globals';

jestGlobal.mock('@aisbp/types', () =>
  jestGlobal.requireActual('../../../../packages/types/src/ai-provider-registry.ts'),
);

import { resolveGenerationModel, isUsableOpenAiFallbackKey } from './ai-live-model-resolve';

describe('ai-live-model-resolve', () => {
  it('resolves invalid stored MiniMax model to registry default', () => {
    const r = resolveGenerationModel('MINIMAX', 'gpt-4o', undefined);
    expect(r.model).toBe('MiniMax-M2.7');
    expect(r.coercedFromStored).toBe(true);
  });

  it('resolves tenant OpenAI id when provider is MiniMax', () => {
    const r = resolveGenerationModel('MINIMAX', 'MiniMax-M2.7', 'gpt-4o');
    expect(r.model).toBe('MiniMax-M2.7');
    expect(r.coercedFromRequest).toBe(true);
  });

  it('applies tenant override when valid for OpenAI', () => {
    const r = resolveGenerationModel('OPENAI', 'gpt-4o-mini', 'gpt-4.1');
    expect(r.model).toBe('gpt-4.1');
    expect(r.coercedFromStored).toBe(false);
    expect(r.coercedFromRequest).toBe(false);
  });

  it('uses agency row when no tenant override (OpenAI)', () => {
    const r = resolveGenerationModel('OPENAI', 'gpt-4o-mini', undefined);
    expect(r.model).toBe('gpt-4o-mini');
  });

  it('placeholder OpenAI key is not usable for fallback', () => {
    expect(isUsableOpenAiFallbackKey('sk-test-123')).toBe(false);
    expect(isUsableOpenAiFallbackKey('sk-demo-abc')).toBe(false);
    expect(isUsableOpenAiFallbackKey('placeholder')).toBe(false);
    expect(isUsableOpenAiFallbackKey('sk-real-looking-but-short')).toBe(true);
  });
});
