// OpenAI provider adapter for @aisbp/ai-router
// Implements AiProviderAdapter using the Chat Completions API.

import axios from 'axios';
import type { AxiosInstance } from 'axios';
import type {
  AiProviderAdapter,
  ProviderConfig,
  GenerateOptions,
  AiResponse,
} from '@aisbp/ai-router';
import { AiProvider } from '@aisbp/types';

const OPENAI_BASE_URL = 'https://api.openai.com/v1';

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

    const response = await this.client.post<OpenAIChatResponse>('/chat/completions', {
      model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      temperature: temperature ?? this.config.temperature ?? 0.7,
      max_tokens: maxTokens ?? this.config.maxTokens ?? 500,
    });

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
    // Approximate: ~4 chars per token for English text
    return Math.ceil(text.length / 4);
  }
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

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
