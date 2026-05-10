// MiniMax text generation — OpenAI-compatible (international) by default; legacy chat host optional.
import axios from 'axios';
import {
  extractAssistantTextFromOpenAiCompatibleBody,
} from '../../lib/openai-compatible-completion-text';
import { summarizeAxiosErrorForLogs } from '../../lib/safe-http-error';

/** International keys from platform.minimax.io use this base + `/chat/completions`. */
const DEFAULT_BASE = 'https://api.minimax.io/v1';

export type MinimaxMessage = { role: 'system' | 'user' | 'assistant'; content: string };

function toSenderType(role: MinimaxMessage['role']): 'SYSTEM' | 'USER' | 'ASSISTANT' {
  if (role === 'system') return 'SYSTEM';
  if (role === 'assistant') return 'ASSISTANT';
  return 'USER';
}

function resolveBase(baseUrl?: string): string {
  let b = (baseUrl ?? process.env['MINIMAX_API_BASE'] ?? DEFAULT_BASE).replace(/\/$/, '');
  // International keys from platform.minimax.io authenticate on `api.minimax.io`; the same Bearer
  // token often returns 2049 "invalid api key" on the older `api.minimax.chat` host.
  if (/\bapi\.minimax\.chat\b/i.test(b)) {
    b = DEFAULT_BASE.replace(/\/$/, '');
  }
  // OpenAI-compat client posts `{base}/chat/completions`; base must include `/v1`.
  if (/^https?:\/\/api\.minimax\.io$/i.test(b)) {
    b = `${b}/v1`;
  }
  return b;
}

/** Legacy China-oriented HTTP API (`text/chatcompletion_v2`). */
function useLegacyChatHost(base: string): boolean {
  return /\bapi\.minimax\.chat\b/i.test(base);
}

/**
 * MiniMax chat completion.
 * - Default: `POST {base}/chat/completions` (OpenAI-compatible, `https://api.minimax.io/v1`).
 * - `api.minimax.chat` bases are rewritten to `api.minimax.io` before the request (same key often 2049 on `.chat`).
 */
export async function minimaxChatCompletion(params: {
  apiKey: string;
  baseUrl?: string;
  /** Optional org / group id for accounts that require it. */
  groupId?: string;
  model: string;
  messages: MinimaxMessage[];
  temperature: number;
  maxTokens: number;
  /** Request timeout in ms (default 60s). */
  timeoutMs?: number;
}): Promise<{ content: string; totalTokens: number; model: string }> {
  const base = resolveBase(params.baseUrl);
  if (useLegacyChatHost(base)) {
    return minimaxLegacyV2(base, params);
  }
  return minimaxOpenAiCompat(base, params);
}

async function minimaxOpenAiCompat(
  base: string,
  params: {
    apiKey: string;
    groupId?: string;
    model: string;
    messages: MinimaxMessage[];
    temperature: number;
    maxTokens: number;
    timeoutMs?: number;
  },
): Promise<{ content: string; totalTokens: number; model: string }> {
  const url = `${base}/chat/completions`;
  const body: Record<string, unknown> = {
    model: params.model,
    messages: params.messages.map(m => ({ role: m.role, content: m.content })),
    max_tokens: Math.min(8192, Math.max(1, params.maxTokens)),
    temperature: params.temperature,
  };
  if (params.groupId) {
    body['group_id'] = params.groupId;
  }

  let data: OpenAiCompatResponse;
  try {
    const res = await axios.post<OpenAiCompatResponse>(url, body, {
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: params.timeoutMs ?? 60_000,
    });
    data = res.data;
  } catch (err) {
    const hint = summarizeAxiosErrorForLogs(err, `MiniMax POST ${url}`);
    throw new Error(
      `${hint} | model=${params.model} group_id=${params.groupId ? 'set' : 'none'}`,
    );
  }

  if (data?.error?.message) {
    throw new Error(data.error.message);
  }

  const text =
    extractAssistantTextFromOpenAiCompatibleBody(data) ||
    (data as { reply?: string })?.reply ??
    (data as { text?: string })?.text ??
    '';

  const total =
    data?.usage?.total_tokens ??
    (data as { total_tokens?: number })?.total_tokens ??
    Math.ceil(String(text).length / 4);

  return { content: String(text).trim(), totalTokens: total, model: params.model };
}

async function minimaxLegacyV2(
  base: string,
  params: {
    apiKey: string;
    groupId?: string;
    model: string;
    messages: MinimaxMessage[];
    temperature: number;
    maxTokens: number;
    timeoutMs?: number;
  },
): Promise<{ content: string; totalTokens: number; model: string }> {
  const url = `${base}/text/chatcompletion_v2`;

  const body: Record<string, unknown> = {
    model: params.model,
    messages: params.messages.map(m => ({
      sender_type: toSenderType(m.role),
      text: m.content,
    })),
    tokens_to_generate: Math.min(8192, Math.max(1, params.maxTokens)),
    temperature: params.temperature,
  };
  if (params.groupId) {
    body['group_id'] = params.groupId;
  }

  let data: MinimaxV2Response;
  try {
    const res = await axios.post<MinimaxV2Response>(url, body, {
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: params.timeoutMs ?? 60_000,
    });
    data = res.data;
  } catch (err) {
    throw new Error(summarizeAxiosErrorForLogs(err, `MiniMax legacy POST ${url}`));
  }

  const br = (data as { base_resp?: { status_code?: number; status_msg?: string } })?.base_resp;
  if (br && br.status_code != null && br.status_code !== 0) {
    throw new Error(br.status_msg ?? `MiniMax error ${br.status_code}`);
  }

  const text =
    data?.reply ??
    (data as { choices?: Array<{ message?: { content?: string } }> })?.choices?.[0]?.message?.content ??
    (data as { text?: string })?.text ??
    '';

  const total =
    (data as { usage?: { total_tokens?: number } })?.usage?.total_tokens ??
    (data as { total_tokens?: number })?.total_tokens ??
    Math.ceil(String(text).length / 4);

  return { content: String(text).trim(), totalTokens: total, model: params.model };
}

interface OpenAiCompatResponse {
  choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }>;
  usage?: { total_tokens?: number };
  error?: { message?: string; type?: string };
}

interface MinimaxV2Response {
  reply?: string;
  result?: string;
  usage?: { total_tokens?: number };
}
