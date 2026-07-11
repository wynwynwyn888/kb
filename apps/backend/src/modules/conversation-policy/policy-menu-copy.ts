/**
 * Generic, business-agnostic copy for the offerings flow. No vertical-specific categories. When the assistant must offer choices, it
 * builds them from the tenant's KB section titles via {@link buildOptionsFromKbSectionTitles}.
 */

import type { RetrievalChunk } from '../kb/dto/retrieval.dto';

export const SELECTION_UNCLEAR_REPLY =
  '';

/** Used only when option memory is missing AND no KB sections are available. */
export const MENU_PROMPT_NO_KB =
  '';

const LETTER_LABELS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;

/** Pretty-cased section title for customer text — preserves intent without all-caps shouting. */
export function prettySectionTitle(raw: string): string {
  const t = raw.trim();
  if (!t) return t;
  if (t.length > 4 && t === t.toUpperCase()) {
    return t
      .toLowerCase()
      .split(/\s+/)
      .map(word => (word ? word[0]!.toUpperCase() + word.slice(1) : word))
      .join(' ');
  }
  return t;
}

export interface BuildOptionsResult {
  /** Letter label (A/B/...) → human label, e.g. { A: "Service Menu", B: "Address" } */
  options: Record<string, string>;
  /** Customer-facing reply text including the choices. */
  reply: string;
  /** Source section titles (raw, in order) for option memory metadata. */
  rawSectionTitles: string[];
}

/**
 * Build A/B/C/D options from KB section titles for the **menu/services** intent.
 *
 * - We pick chunks whose section title looks like a service / menu / product category. We do NOT
 *   inject hardcoded categories — if a tenant has none, we return `null` so the caller falls back
 *   to a clarification reply.
 */
export function buildOptionsFromKbSectionTitles(
  chunks: RetrievalChunk[],
  opts: { headPrompt?: string } = {},
): BuildOptionsResult | null {
  const seen = new Set<string>();
  const titles: string[] = [];
  for (const c of chunks) {
    const st = c.metadata['sectionTitle'];
    if (typeof st !== 'string') continue;
    const trimmed = st.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    titles.push(trimmed);
    if (titles.length >= LETTER_LABELS.length) break;
  }

  if (titles.length === 0) return null;

  const options: Record<string, string> = {};
  const lines: string[] = [];
  titles.forEach((raw, idx) => {
    const label = LETTER_LABELS[idx]!;
    const display = prettySectionTitle(raw);
    options[label] = display;
    lines.push(`${label}) ${display}`);
  });

  const head = opts.headPrompt?.trim() || 'Which would you like to know more about?';
  const reply = `${head}\n\n${lines.join('\n')}\n\nReply with the letter and I'll share the details.`;

  return { options, reply, rawSectionTitles: titles };
}

/** Legacy compatibility shim; no-KB selections are no longer answered with canned copy. */
export function selectedCategoryNoKbReply(label: string): string {
  return '';
}
