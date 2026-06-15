import { jest as jestGlobal } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';

jestGlobal.mock('@aisbp/types', () =>
  jestGlobal.requireActual('../../../../../packages/types/src/ai-provider-registry.ts'),
);

import { assertAgencyLiveAiProvider, assertModelBelongsToProvider } from './agency-ai-config.validation';

describe('agency-ai-config.validation', () => {
  it('rejects unsupported provider', () => {
    expect(() => assertAgencyLiveAiProvider('GOOGLE')).toThrow(BadRequestException);
  });

  it('rejects OpenAI model for MiniMax', () => {
    expect(() => assertModelBelongsToProvider('MINIMAX', 'gpt-4o-mini')).toThrow(BadRequestException);
  });

  it('rejects MiniMax model for OpenAI', () => {
    expect(() => assertModelBelongsToProvider('OPENAI', 'MiniMax-M2.7')).toThrow(BadRequestException);
  });

  it('accepts allowed OpenAI model', () => {
    expect(() => assertModelBelongsToProvider('OPENAI', 'gpt-4o-mini')).not.toThrow();
  });

  it('accepts allowed MiniMax model', () => {
    expect(() => assertModelBelongsToProvider('MINIMAX', 'MiniMax-M3')).not.toThrow();
    expect(() => assertModelBelongsToProvider('MINIMAX', 'MiniMax-M2.7')).not.toThrow();
  });
});
