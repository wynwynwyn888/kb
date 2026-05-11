import { packPlainTextIntoOutboundBubbles } from './outbound-bubbles';
import type { ReplyBubbleDraft } from '../modules/reply-planning/dto';

function isLikelyListPhraseLine(trim: string): boolean {
  if (!trim || trim.startsWith('•')) return false;
  if (/[.!?]$/.test(trim)) return false;
  if (trim.length > 56 || trim.length < 3) return false;
  if (/\n/.test(trim)) return false;
  const words = trim.split(/\s+/).filter(Boolean);
  if (words.length > 8) return false;
  if (/^[-*+]\s/.test(trim)) return false;
  if (/^#{1,6}\s/.test(trim)) return false;
  return true;
}

/**
 * When several consecutive short label lines look like an unbulleted list, prefix with •.
 */
export function bulletizeAdjacentShortPhraseLines(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const lineRaw = lines[i]!;
    const trim = lineRaw.trim();
    if (!trim) {
      out.push(lineRaw);
      i++;
      continue;
    }

    const run: string[] = [];
    let j = i;
    while (j < lines.length) {
      const t = lines[j]!.trim();
      if (!t) break;
      if (!isLikelyListPhraseLine(t)) break;
      run.push(t);
      j++;
    }

    const eligible =
      run.length >= 3 ||
      (run.length === 2 && run[0]!.split(/\s+/).length <= 5 && run[1]!.split(/\s+/).length <= 5);

    if (eligible) {
      for (const r of run) {
        out.push(`• ${r}`);
      }
      i = j;
    } else {
      out.push(lineRaw);
      i++;
    }
  }

  return out.join('\n');
}

/**
 * When a reply would stay in one bubble only due to length but has clear paragraphs, split once
 * for readability (two physical bubbles max from this helper).
 */
export function splitLongTwoParagraphReplyForReadability(text: string): [string] | [string, string] {
  const t = text.trim();
  if (t.length <= 350) return [t];
  if (t.length > 520) return [t];

  const parts = t
    .split(/\n\s*\n/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
  if (parts.length < 2) return [t];

  const first = parts[0]!;
  const rest = parts.slice(1).join('\n\n');
  if (first.length < 40 || rest.length < 40) return [t];

  return [first, rest];
}

/**
 * If readability split yields two sections that each fit a single outbound bubble, return them.
 * Otherwise return null so the caller uses normal packing.
 */
export function tryReadabilityTwoBubbleDrafts(preparedPlain: string): ReplyBubbleDraft[] | null {
  const split = splitLongTwoParagraphReplyForReadability(preparedPlain);
  if (split.length === 1) return null;
  const a = packPlainTextIntoOutboundBubbles(split[0]!);
  const b = packPlainTextIntoOutboundBubbles(split[1]!);
  if (a.length === 1 && b.length === 1) {
    return [
      { index: 0, text: a[0]!.text },
      { index: 1, text: b[0]!.text },
    ];
  }
  return null;
}
