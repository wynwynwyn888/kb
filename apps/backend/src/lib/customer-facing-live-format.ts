/**
 * Customer-facing text shaping for live WhatsApp/SMS outbound — shared by ReplyPlannerService
 * (orchestration → send queue) and Bot Test preview so spacing rules stay aligned.
 *
 * Drift note: FormatterService / `@aisbp/formatter` HTTP path is separate; do not assume parity.
 */

/** Collapse 3+ consecutive newlines to 2 (one blank paragraph separator). */
export function normalizeExcessiveBlankLines(text: string): string {
  return text.replace(/\n{3,}/g, '\n\n');
}

/**
 * Prepare plain text before bubble packing: preserve `\n\n` paragraph breaks (e.g. list block
 * vs trailing question). Older `normalizeShortMultilineBody` incorrectly joined short paragraphs
 * with single `\n`, which removed the blank line WhatsApp needs.
 */
export function prepareCustomerFacingPlainTextForOutboundSplit(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  return normalizeExcessiveBlankLines(trimmed);
}

/**
 * Regex markdown strip for outbound (not full CommonMark). Keeps paragraph breaks; does not
 * collapse `\n\n` to `\n`.
 */
export function stripLiveCustomerMarkdownForOutbound(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/#{1,6}\s+(.+)/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/\[(.+?)\]\(.+?\)/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .trim();
}

export function newlineDebugMetrics(s: string): { newlineCount: number; doubleNewlineSeqCount: number } {
  return {
    newlineCount: (s.match(/\n/g) ?? []).length,
    doubleNewlineSeqCount: (s.match(/\n\n/g) ?? []).length,
  };
}

/** Safe log preview: newlines shown as `\n`, length capped. */
export function previewWithVisibleNewlines(s: string, maxLen: number): string {
  return s.slice(0, maxLen).replace(/\n/g, '\\n');
}
