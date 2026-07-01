// OpenAI provider adapter for @aisbp/ai-router
// Implements AiProviderAdapter using the Chat Completions API.

import axios from 'axios';
import type { AxiosInstance, AxiosError } from 'axios';
import type {
  AiProviderAdapter,
  ProviderConfig,
  GenerateOptions,
  AiResponse,
} from '@aisbp/ai-router';
import { AiProvider } from '@aisbp/types';

const OPENAI_BASE_URL = 'https://api.openai.com/v1';

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 500;

function isRetryableError(err: AxiosError): boolean {
  if (!err.response) {
    const code = (err as AxiosError & { code?: string }).code;
    return code === 'ETIMEDOUT' || code === 'ECONNRESET' || code === 'ECONNREFUSED' || code === 'ECONNABORTED';
  }
  const status = err.response.status;
  return status === 429 || (status >= 500 && status <= 504);
}

function isNonRetryableError(err: AxiosError): boolean {
  if (!err.response) return false;
  const status = err.response.status;
  return status === 400 || status === 401 || status === 403;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function backoffMs(attempt: number): number {
  const base = RETRY_BASE_MS * Math.pow(2, attempt);
  const jitter = Math.random() * (base * 0.3);
  return Math.floor(base + jitter);
}

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  label: string,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err;
      if (attempt >= MAX_RETRIES) break;
      if (isNonRetryableError(err as AxiosError)) break;
      if (!isRetryableError(err as AxiosError)) break;
      const delay = backoffMs(attempt);
      const status =
        (err as AxiosError).response?.status ?? 'network';
      console.warn(
        `OpenAI ${label} attempt ${attempt + 1}/${MAX_RETRIES + 1} failed (${status}); retrying in ${delay}ms`,
      );
      await sleep(delay);
    }
  }
  throw lastError;
}

export class OpenAiProviderAdapter implements AiProviderAdapter {
  readonly provider: AiProvider = AiProvider.OpenAI;
  readonly supportedModels = [
    'gpt-4o',
    'gpt-4o-mini',
    'gpt-4-turbo',
    'gpt-4',
    'gpt-3.5-turbo',
  ];

  private config: ProviderConfig | null = null;
  private client: AxiosInstance | null = null;

  initialize(config: ProviderConfig): void {
    this.config = config;
    this.client = axios.create({
      baseURL: config.endpoint ?? OPENAI_BASE_URL,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 30_000,
    });
  }

  async generate(options: GenerateOptions): Promise<AiResponse> {
    if (!this.client || !this.config) {
      throw new Error('OpenAI provider not initialized');
    }

    const { model, messages, temperature, maxTokens } = options;

    const response = await retryWithBackoff(
      () =>
        this.client!.post<OpenAIChatResponse>('/chat/completions', {
          model,
          messages: messages.map(m => ({ role: m.role, content: m.content })),
          temperature: temperature ?? this.config!.temperature ?? 0.7,
          max_tokens: maxTokens ?? this.config!.maxTokens ?? 500,
        }),
      'chat/completions',
    );

    const choice = response.data.choices[0];
    const usage = response.data.usage;

    return {
      content: choice?.message?.content ?? '',
      usage: {
        promptTokens: usage?.prompt_tokens ?? 0,
        completionTokens: usage?.completion_tokens ?? 0,
        totalTokens: usage?.total_tokens ?? 0,
      },
      model: response.data.model,
      provider: this.provider,
      finishReason: choice?.finish_reason ?? 'stop',
    };
  }

  async getTokenCount(text: string): Promise<number> {
    return Math.ceil(text.length / 4);
  }
}

// Internal types
interface OpenAIChatResponse {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  created: number;
}
