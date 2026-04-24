/**
 * Model UI by provider. Only OPENAI + MINIMAX have live generation in the API today; others are stored for future routing.
 * MiniMax text model ids and order follow official MiniMax platform text-generation docs (e.g. M2.7, M2.5, M2.1, M2 + -highspeed variants; legacy group for older ids).
 */
export type ModelOption = { value: string; label: string };

export type ModelFieldResult =
  | {
      mode: 'list';
      /** Flat list (primary + legacy) for validation and fallbacks */
      options: ModelOption[];
      /** When set, the model <select> should render optgroups in this order */
      groups?: { label: string; options: ModelOption[] }[];
      defaultModel: string;
    }
  | { mode: 'text'; defaultModel: string };

export const PROVIDER_LABEL: Record<string, string> = {
  OPENAI: 'OpenAI',
  MINIMAX: 'MiniMax',
  GOOGLE: 'Google Gemini',
  ANTHROPIC: 'Anthropic',
  AZURE: 'Azure OpenAI',
  CUSTOM: 'Other',
};

const OPENAI_MODELS: ModelOption[] = [
  { value: 'gpt-4o-mini', label: 'GPT-4o mini' },
  { value: 'gpt-4o', label: 'GPT-4o' },
  { value: 'gpt-4.1-mini', label: 'GPT-4.1 mini' },
  { value: 'o4-mini', label: 'o4 mini' },
];

/** Current MiniMax text-generation model ids (documented order for agency AI settings). */
const MINIMAX_MODELS_PRIMARY: ModelOption[] = [
  { value: 'MiniMax-M2.7', label: 'MiniMax-M2.7' },
  { value: 'MiniMax-M2.7-highspeed', label: 'MiniMax-M2.7-highspeed' },
  { value: 'MiniMax-M2.5', label: 'MiniMax-M2.5' },
  { value: 'MiniMax-M2.5-highspeed', label: 'MiniMax-M2.5-highspeed' },
  { value: 'MiniMax-M2.1', label: 'MiniMax-M2.1' },
  { value: 'MiniMax-M2.1-highspeed', label: 'MiniMax-M2.1-highspeed' },
  { value: 'MiniMax-M2', label: 'MiniMax-M2' },
];

const MINIMAX_MODELS_LEGACY: ModelOption[] = [
  { value: 'MiniMax-Text-01', label: 'MiniMax-Text-01' },
  { value: 'abab6.5s-chat', label: 'abab6.5s-chat' },
  { value: 'MiniMax-Text-01-241115', label: 'MiniMax-Text-01-241115' },
];

const GEMINI_MODELS: ModelOption[] = [
  { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
  { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
  { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
];

const CLAUDE_MODELS: ModelOption[] = [
  { value: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
  { value: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet' },
  { value: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku' },
];

export function getModelFieldForProvider(provider: string): ModelFieldResult {
  const p = provider.toUpperCase();
  if (p === 'OPENAI') {
    return { mode: 'list', options: OPENAI_MODELS, defaultModel: 'gpt-4o-mini' };
  }
  if (p === 'MINIMAX') {
    const all = [...MINIMAX_MODELS_PRIMARY, ...MINIMAX_MODELS_LEGACY];
    return {
      mode: 'list',
      options: all,
      groups: [
        { label: 'MiniMax text models', options: MINIMAX_MODELS_PRIMARY },
        { label: 'Legacy', options: MINIMAX_MODELS_LEGACY },
      ],
      defaultModel: 'MiniMax-M2.7',
    };
  }
  if (p === 'GOOGLE') {
    return { mode: 'list', options: GEMINI_MODELS, defaultModel: 'gemini-2.0-flash' };
  }
  if (p === 'ANTHROPIC') {
    return { mode: 'list', options: CLAUDE_MODELS, defaultModel: 'claude-3-5-sonnet-20241022' };
  }
  if (p === 'AZURE') {
    return { mode: 'text', defaultModel: 'gpt-4o' };
  }
  if (p === 'CUSTOM') {
    return { mode: 'text', defaultModel: '' };
  }
  return { mode: 'text', defaultModel: 'model-id' };
}
