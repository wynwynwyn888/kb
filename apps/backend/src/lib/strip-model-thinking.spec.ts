import { stripModelThinking } from '@aisbp/formatter';

describe('stripModelThinking', () => {
  it('returns empty for empty input', () => {
    expect(stripModelThinking('')).toBe('');
  });

  it('leaves plain customer text unchanged', () => {
    expect(stripModelThinking('Hello, how can I help?')).toBe('Hello, how can I help?');
  });

  it('removes a single redacted_thinking block', () => {
    const raw =
      '<think>The user said hi.</think> Good evening, welcome to our restaurant.';
    expect(stripModelThinking(raw)).toBe('Good evening, welcome to our restaurant.');
  });

  it('is case-insensitive on tag names', () => {
    const raw =
      '<Redacted_Thinking>secret</REDACTED_THINKING>Hi there.';
    expect(stripModelThinking(raw)).toBe('Hi there.');
  });

  it('allows whitespace inside tag delimiters', () => {
    const raw = '<  redacted_thinking  >nope<  /  redacted_thinking  >Visible.';
    expect(stripModelThinking(raw)).toBe('Visible.');
  });

  it('removes multiple blocks', () => {
    const raw = '<think>a</think>One<think>b</think> Two';
    expect(stripModelThinking(raw)).toBe('One Two');
  });

  it('handles multiline blocks', () => {
    const raw = '<think>\nline1\nline2\n</think>\nAnswer.';
    expect(stripModelThinking(raw)).toBe('Answer.');
  });

  it('drops remainder when opening tag is not closed', () => {
    const raw = 'Prefix <think>leaked reasoning continues forever';
    expect(stripModelThinking(raw)).toBe('Prefix');
  });

  it('strips think tag blocks', () => {
    expect(stripModelThinking('<think>x</think>OK')).toBe('OK');
  });

  it('strips backtick thinking fences', () => {
    expect(stripModelThinking('`thinking`plan`thinking`Done')).toBe('Done');
  });

  it('truncates after unclosed backtick fence open', () => {
    expect(stripModelThinking('Hi `thinking`secret')).toBe('Hi');
  });
});
