import { detectRepeatedCustomerUserLines } from './repeated-customer-message';
import type { MemoryEntry } from '../modules/orchestration/dto/memory-entry';

function user(content: string): MemoryEntry {
  return {
    role: 'user',
    content,
    sender: 'CONTACT',
    timestamp: new Date().toISOString(),
    messageType: 'text',
  };
}

function assistant(content: string): MemoryEntry {
  return {
    role: 'assistant',
    content,
    sender: 'AI',
    timestamp: new Date().toISOString(),
    messageType: 'text',
  };
}

describe('repeated-customer-message', () => {
  it('same text twice in a row after assistant => answer_again', () => {
    const r = detectRepeatedCustomerUserLines([
      user('how much is haircut?'),
      assistant('It starts at $45.'),
      user('how much is haircut?'),
    ]);
    expect(r.repeatedHumanTextDetected).toBe(true);
    expect(r.repeatedHumanTextAction).toBe('answer_again');
  });

  it('same text three times => concise_confirm', () => {
    const r = detectRepeatedCustomerUserLines([
      user('how much is haircut?'),
      assistant('It starts at $45.'),
      user('how much is haircut?'),
      assistant('Still $45.'),
      user('how much is haircut?'),
    ]);
    expect(r.repeatedHumanTextDetected).toBe(true);
    expect(r.repeatedHumanTextAction).toBe('concise_confirm');
  });

  it('same text with different message IDs is not provider dedupe — memory shows two user lines', () => {
    const r = detectRepeatedCustomerUserLines([user('ping'), user('ping')]);
    expect(r.repeatedHumanTextDetected).toBe(true);
  });

  it('three consecutive identical user lines => concise_confirm', () => {
    const r = detectRepeatedCustomerUserLines([user('x'), user('x'), user('x')]);
    expect(r.repeatedHumanTextDetected).toBe(true);
    expect(r.repeatedHumanTextAction).toBe('concise_confirm');
  });
});
