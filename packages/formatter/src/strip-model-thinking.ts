/**
 * Removes model-internal reasoning from text before it is shown or sent to customers.
 * Strips `<think>...</think>` (case-insensitive, flexible whitespace, multiline),
 * paired `<think>...</think>` blocks, and backtick-fenced `` … `` style leaks.
 */

const REDACTED_PAIR =
  /<\s*redacted_thinking\s*>[\s\S]*?<\s*\/\s*redacted_thinking\s*>/gi;
const REDACTED_OPEN = /<\s*redacted_thinking\s*>/i;

const THINK_PAIR = /<\s*think\s*>[\s\S]*?<\s*\/\s*think\s*>/gi;
const THINK_OPEN = /<\s*think\s*>/i;

/** `` … `` style (MiniMax / similar) */
const FENCE_THINK_PAIR = /`+thinking`+[\s\S]*?`+thinking`+/gi;
const FENCE_THINK_OPEN = /`+thinking`+/i;

function removePairedBlocks(s: string, pair: RegExp): string {
  let out = s;
  let prev: string;
  do {
    prev = out;
    out = out.replace(pair, '');
  } while (out !== prev);
  return out;
}

function truncateAfterFirstOpen(s: string, openRe: RegExp): string {
  const m = openRe.exec(s);
  if (!m) return s;
  return s.slice(0, m.index);
}

function normalizeWhitespace(s: string): string {
  return s
    .replace(/[ \t\f\v]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function stripModelThinking(text: string): string {
  if (text == null || text === '') return '';

  let s = text;

  s = removePairedBlocks(s, REDACTED_PAIR);
  s = truncateAfterFirstOpen(s, REDACTED_OPEN);

  s = removePairedBlocks(s, THINK_PAIR);
  s = truncateAfterFirstOpen(s, THINK_OPEN);

  s = removePairedBlocks(s, FENCE_THINK_PAIR);
  s = truncateAfterFirstOpen(s, FENCE_THINK_OPEN);

  return normalizeWhitespace(s);
}
