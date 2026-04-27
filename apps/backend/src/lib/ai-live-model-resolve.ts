import {
  defaultModelForLiveProvider,
  isAgencyLiveAiProvider,
  normalizeModelForLiveProvider,
} from '@aisbp/types';

/** Routing / planner may recommend an OpenAI model id; never send that string to MiniMax. */
export function isLikelyOpenAiModelId(name: string): boolean {
  const n = name.trim();
  if (!n) return false;
  if (/^gpt-/i.test(n)) return true;
  if (/^o[0-9]/i.test(n)) return true;
  if (/^chatgpt-/i.test(n)) return true;
  if (/^text-davinci|^davinci|^curie|^babbage|^ada\b/i.test(n)) return true;
  return false;
}

/** Avoid sending MiniMax model names to the OpenAI adapter. */
export function isLikelyMinimaxModelId(name: string): boolean {
  return /^minimax-/i.test(name.trim());
}

export function isUsableOpenAiFallbackKey(apiKey: string | null | undefined): boolean {
  const k = (apiKey ?? '').trim();
  if (!k) return false;
  const lower = k.toLowerCase();
  if (lower.startsWith('demo-key')) return false;
  if (lower.startsWith('sk-test')) return false;
  if (/^sk-(demo|test|placeholder|xxxx)/i.test(k)) return false;
  if (lower === 'placeholder' || lower === 'replace-me' || lower === 'your-api-key-here') return false;
  return true;
}

export function resolveGenerationModel(
  providerName: string,
  rowSettingsModel: string | undefined,
  paramsModel: string | undefined,
): { model: string; coercedFromStored: boolean; coercedFromRequest: boolean } {
  const p = providerName.toUpperCase();
  if (!isAgencyLiveAiProvider(p)) {
    return {
      model: defaultModelForLiveProvider('OPENAI'),
      coercedFromStored: true,
      coercedFromRequest: true,
    };
  }

  const rowNorm = normalizeModelForLiveProvider(p, rowSettingsModel);
  const coercedFromStored =
    Boolean(rowSettingsModel?.trim()) && rowSettingsModel!.trim() !== rowNorm;

  const requested = (paramsModel ?? '').trim();
  let candidate = requested;

  if (p === 'MINIMAX') {
    if (!candidate || isLikelyOpenAiModelId(candidate)) {
      candidate = rowNorm;
    }
  } else if (p === 'OPENAI') {
    if (candidate && isLikelyMinimaxModelId(candidate)) {
      candidate = rowNorm;
    }
  }

  if (!candidate) {
    candidate = rowNorm;
  }

  const model = normalizeModelForLiveProvider(p, candidate);
  const coercedFromRequest = requested !== '' && model !== requested;

  return { model, coercedFromStored, coercedFromRequest };
}
