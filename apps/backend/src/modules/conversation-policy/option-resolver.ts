import type { MemoryEntry } from '../orchestration/dto';
import type { AisbpPolicyStateV1 } from './conversation-policy-state';

export type SelectionResolution = {
  raw: string;
  selectedLabel: string;
  selectedText: string;
  source: 'conversation_state' | 'previous_assistant_options';
};

export type MultiSelectionResolution = {
  rawMessages: string[];
  selections: SelectionResolution[];
};

export const LETTER_LABELS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;

/** Match `A) Label`, `A. Label`, `A: Label` (also `1) ...`, `1. ...`). */
const RE_OPTION_LINE = /^\s*(?:([A-Ha-h])|(\d{1,2}))\s*[\)\.\:]\s*(.+?)\s*$/;
/** Match unlabelled bullets like `- Label` or `* Label` (only when 2+ in a row). */
const RE_BULLET_LINE = /^\s*[-•*]\s+(.+?)\s*$/;

/**
 * Parse option lines from an assistant bubble. Supports A/B/C/D, 1/2/3, A) / A. / A: variants,
 * and bullet lists (when at least 2 consecutive bullets exist).
 */
export function parseAssistantOptionLines(assistantText: string): Record<string, string> {
  const lines = assistantText.split(/\r?\n/);
  const labelled: Record<string, string> = {};

  // Pass 1: explicit labels (letters, then digits)
  for (const line of lines) {
    const m = line.match(RE_OPTION_LINE);
    if (!m) continue;
    const letter = m[1]?.toUpperCase();
    const digit = m[2];
    const label = (m[3] ?? '').trim();
    if (!label) continue;
    if (letter && /^[A-H]$/.test(letter)) {
      if (!labelled[letter]) labelled[letter] = label;
    } else if (digit) {
      const idx = parseInt(digit, 10);
      if (idx >= 1 && idx <= LETTER_LABELS.length) {
        const k = LETTER_LABELS[idx - 1]!;
        if (!labelled[k]) labelled[k] = label;
      }
    }
  }
  if (Object.keys(labelled).length > 0) return labelled;

  // Pass 2: consecutive bullets — treat as unnumbered options.
  const bullets: string[] = [];
  let inBlock = false;
  for (const line of lines) {
    const m = line.match(RE_BULLET_LINE);
    if (m) {
      const label = (m[1] ?? '').trim();
      if (label) bullets.push(label);
      inBlock = true;
    } else if (inBlock && line.trim() === '') {
      // continue the bullet block across blank lines
    } else if (line.trim().length > 0) {
      inBlock = false;
    }
  }
  if (bullets.length >= 2) {
    bullets.slice(0, LETTER_LABELS.length).forEach((label, idx) => {
      labelled[LETTER_LABELS[idx]!] = label;
    });
  }
  return labelled;
}

function optionsFromState(state: AisbpPolicyStateV1): Record<string, string> | null {
  if (state.options && Object.keys(state.options).length > 0) return state.options;
  if (state.lastAssistantOptions && Object.keys(state.lastAssistantOptions).length > 0) {
    return state.lastAssistantOptions;
  }
  return null;
}

/** Count labels in persisted option memory (options or lastAssistantOptions). */
export function countBundledPolicyOptions(state: AisbpPolicyStateV1): number {
  const m = optionsFromState(state);
  return m ? Object.keys(m).length : 0;
}

function recentAssistantTexts(memory: MemoryEntry[], max = 4): string[] {
  const out: string[] = [];
  for (let i = memory.length - 1; i >= 0 && out.length < max; i--) {
    const e = memory[i]!;
    if (e.role === 'assistant' && e.content?.trim()) {
      out.push(e.content);
    }
  }
  return out;
}

function normalizeSelectionRaw(raw: string): string {
  return raw
    .trim()
    .replace(/^option\s*/i, '')
    .replace(/^choice\s*/i, '')
    .replace(/[!?.]+$/g, '')
    .trim();
}

/**
 * Single-letter A–Z or digit 1–8 selection token after normalizing whitespace/punctuation.
 * Used while `awaiting=option_selection`: never send these through unconstrained KB+LLM.
 */
export function isOptionSelectionSingleToken(raw: string): boolean {
  const t = normalizeSelectionRaw(raw).replace(/[!?.]+$/g, '').trim();
  if (/^[1-8]$/.test(t)) return true;
  return /^[a-zA-Z]$/.test(t);
}

/** Pure A–H / 1–8 option reply while awaiting option_selection — skip KB + unconstrained retrieval. */
export function shouldSkipKbForPureOptionLetterSelection(
  state: AisbpPolicyStateV1,
  latestUserMessageTrimmed: string,
): boolean {
  return (
    state.awaiting === 'option_selection' &&
    countBundledPolicyOptions(state) > 0 &&
    isOptionSelectionSingleToken(latestUserMessageTrimmed)
  );
}

/**
 * Resolve SHORT_SELECTION (a single A–H letter, 1–8 digit, "first", "last") against the option
 * memory. Looks at the policy state first, then walks recent assistant messages.
 */
export function resolveShortSelection(
  rawMessage: string,
  state: AisbpPolicyStateV1,
  memory: MemoryEntry[],
): SelectionResolution | null {
  const raw = normalizeSelectionRaw(rawMessage);
  if (!raw) return null;

  let opts = optionsFromState(state);
  let source: SelectionResolution['source'] = 'conversation_state';

  if (!opts || Object.keys(opts).length === 0) {
    for (const text of recentAssistantTexts(memory)) {
      const parsed = parseAssistantOptionLines(text);
      if (Object.keys(parsed).length > 0) {
        opts = parsed;
        source = 'previous_assistant_options';
        break;
      }
    }
  }

  if (!opts || Object.keys(opts).length === 0) return null;

  const lower = raw.toLowerCase();

  if (/^[a-h]$/i.test(lower)) {
    const k = lower.toUpperCase();
    const text = opts[k];
    if (text) return { raw: rawMessage.trim(), selectedLabel: k, selectedText: text, source };
  }

  if (/^[1-8]$/.test(lower)) {
    const keys = Object.keys(opts).sort();
    const idx = Number(lower) - 1;
    const k = keys[idx];
    if (k && opts[k]) {
      return { raw: rawMessage.trim(), selectedLabel: k, selectedText: opts[k]!, source };
    }
  }

  if (/\bfirst\b/i.test(lower)) {
    const keys = Object.keys(opts).sort();
    const k = keys[0];
    if (k && opts[k]) {
      return { raw: rawMessage.trim(), selectedLabel: k, selectedText: opts[k]!, source };
    }
  }

  if (/\b(last|final)\b/i.test(lower)) {
    const keys = Object.keys(opts).sort();
    const k = keys[keys.length - 1];
    if (k && opts[k]) {
      return { raw: rawMessage.trim(), selectedLabel: k, selectedText: opts[k]!, source };
    }
  }

  if (/\bsecond\b/i.test(lower)) {
    const keys = Object.keys(opts).sort();
    const k = keys[1];
    if (k && opts[k]) {
      return { raw: rawMessage.trim(), selectedLabel: k, selectedText: opts[k]!, source };
    }
  }
  if (/\bthird\b/i.test(lower)) {
    const keys = Object.keys(opts).sort();
    const k = keys[2];
    if (k && opts[k]) {
      return { raw: rawMessage.trim(), selectedLabel: k, selectedText: opts[k]!, source };
    }
  }
  if (/\bfourth\b/i.test(lower)) {
    const keys = Object.keys(opts).sort();
    const k = keys[3];
    if (k && opts[k]) {
      return { raw: rawMessage.trim(), selectedLabel: k, selectedText: opts[k]!, source };
    }
  }

  const optMatch = lower.match(/\boption\s*([a-h1-8])\b/);
  if (optMatch) {
    const x = optMatch[1]!.toUpperCase();
    if (/[A-H]/.test(x) && opts[x]) {
      return { raw: rawMessage.trim(), selectedLabel: x, selectedText: opts[x]!, source };
    }
    const n = Number(x);
    if (n >= 1 && n <= 8) {
      const keys = Object.keys(opts).sort();
      const k = keys[n - 1];
      if (k && opts[k]) {
        return { raw: rawMessage.trim(), selectedLabel: k, selectedText: opts[k]!, source };
      }
    }
  }

  return null;
}

/**
 * Resolve a debounced burst such as `2`, `3`, `4` against one option menu.
 * Returns null unless there are at least two messages and every message is a
 * valid, resolvable single selection. Duplicate labels are collapsed while
 * preserving the customer's first-seen order.
 */
export function resolveMultiSelectionBurst(
  rawMessages: string[],
  state: AisbpPolicyStateV1,
  memory: MemoryEntry[],
): MultiSelectionResolution | null {
  const messages = rawMessages.map(message => message.trim()).filter(Boolean);
  if (messages.length < 2 || !messages.every(isOptionSelectionSingleToken)) return null;

  const resolved: SelectionResolution[] = [];
  const seen = new Set<string>();
  for (const message of messages) {
    const selection = resolveShortSelection(message, state, memory);
    if (!selection) return null;
    if (seen.has(selection.selectedLabel)) continue;
    seen.add(selection.selectedLabel);
    resolved.push(selection);
  }
  if (resolved.length < 2) return null;
  return { rawMessages: messages, selections: resolved };
}
