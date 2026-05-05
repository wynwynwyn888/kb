import { describe, expect, it } from 'vitest';
import { countWords } from './prompt-text-stats';

describe('countWords', () => {
  it('returns 0 for empty or whitespace', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   \n\t  ')).toBe(0);
  });

  it('counts whitespace-separated words', () => {
    expect(countWords('Hello world')).toBe(2);
    expect(countWords('  one two three  ')).toBe(3);
  });
});
