import {
  assistantReplyPresentForHealthCheck,
  extractAssistantTextFromOpenAiCompatibleBody,
  flattenOpenAiMessageContent,
} from './openai-compatible-completion-text';

describe('openai-compatible-completion-text', () => {
  it('flattens array-style message content (MiniMax / multimodal-style)', () => {
    const raw = [{ type: 'text', text: 'OK' }];
    expect(flattenOpenAiMessageContent(raw)).toBe('OK');
  });

  it('extracts assistant text from OpenAI-shaped JSON', () => {
    const body = {
      choices: [{ message: { content: [{ type: 'text', text: 'Sure.' }] } }],
    };
    expect(extractAssistantTextFromOpenAiCompatibleBody(body)).toBe('Sure.');
    expect(assistantReplyPresentForHealthCheck(extractAssistantTextFromOpenAiCompatibleBody(body))).toBe(true);
  });

  it('health check rejects empty extraction', () => {
    expect(assistantReplyPresentForHealthCheck('   ')).toBe(false);
  });
});
