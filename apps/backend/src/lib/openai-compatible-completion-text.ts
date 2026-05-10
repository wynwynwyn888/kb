/**
 * OpenAI-compatible chat completion responses may return `choices[0].message.content` as a
 * string or as an array of parts (e.g. `{ type: 'text', text: '...' }`). MiniMax and others
 * follow the same shape. This module normalizes to plain text for health checks and generation.
 */
export function flattenOpenAiMessageContent(raw: unknown): string {
  if (raw == null) return '';
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) {
    return raw
      .map(part => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object') {
          const o = part as Record<string, unknown>;
          if (typeof o['text'] === 'string') return o['text'];
          if (typeof o['content'] === 'string') return o['content'];
        }
        return '';
      })
      .join('');
  }
  if (typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    if (typeof o['text'] === 'string') return o['text'];
  }
  return '';
}

/** Extract assistant-visible text from a typical OpenAI-style JSON body (`/chat/completions`). */
export function extractAssistantTextFromOpenAiCompatibleBody(data: unknown): string {
  if (!data || typeof data !== 'object') return '';
  const d = data as Record<string, unknown>;
  const choices = d['choices'];
  if (!Array.isArray(choices) || choices.length === 0) return '';
  const ch0 = choices[0];
  if (!ch0 || typeof ch0 !== 'object') return '';
  const c0 = ch0 as Record<string, unknown>;
  if (typeof c0['text'] === 'string') return c0['text'];
  const message = c0['message'];
  if (!message || typeof message !== 'object') return '';
  const content = (message as Record<string, unknown>)['content'];
  return flattenOpenAiMessageContent(content);
}

/** Non-empty assistant text after a successful HTTP response means the key, model, and API path work. */
export function assistantReplyPresentForHealthCheck(text: string): boolean {
  return text.trim().length > 0;
}
