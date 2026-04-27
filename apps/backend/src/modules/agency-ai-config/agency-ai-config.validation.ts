import { BadRequestException } from '@nestjs/common';
import { isAgencyLiveAiProvider, isModelAllowedForLiveProvider } from '@aisbp/types';

export function assertAgencyLiveAiProvider(provider: string): asserts provider is 'OPENAI' | 'MINIMAX' {
  if (!isAgencyLiveAiProvider(provider)) {
    throw new BadRequestException(
      `Unsupported provider "${provider}". Only OPENAI and MINIMAX are allowed.`,
    );
  }
}

export function assertModelBelongsToProvider(provider: string, model: string): void {
  assertAgencyLiveAiProvider(provider);
  const m = model.trim();
  if (!isModelAllowedForLiveProvider(provider, m)) {
    throw new BadRequestException(
      `Model "${m}" is not allowed for provider ${provider.toUpperCase()}.`,
    );
  }
}
