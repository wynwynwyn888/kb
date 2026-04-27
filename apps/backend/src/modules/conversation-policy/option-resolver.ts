import type { MemoryEntry } from '../orchestration/dto';
import type { AisbpPolicyStateV1 } from './conversation-policy-state';

export type SelectionResolution = {
  raw: string;
  selectedLabel: string;
  selectedText: string;
  source: 'conversation_state' | 'previous_assistant_options';
};

const RE_LINES = /^([A-Da-d])\)\s*(.+)$/gm;

/**
 * Parse A) Label / B) Label from assistant bubble text.
 */
export function parseAssistantOptionLines(assistantText: string): Record<string, string> {
  const out: Record<string, string> = {};
  let m: RegExpExecArray | null;
  const re = new RegExp(RE_LINES.source, RE_LINES.flags);
  while ((m = re.exec(assistantText)) !== null) {
    const key = m[1]!.toUpperCase();
    const label = m[2]!.trim();
    if (label) out[key] = label;
  }
  return out;
}

function optionsFromState(state: AisbpPolicyStateV1): Record<string, string> | null {
  if (state.options && Object.keys(state.options).length > 0) return state.options;
  if (state.lastAssistantOptions && Object.keys(state.lastAssistantOptions).length > 0) {
    return state.lastAssistantOptions;
  }
  return null;
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
  return raw.trim().replace(/^option\s*/i, '').replace(/[!?.]+$/g, '').trim();
}

/**
 * Resolve SHORT_SELECTION from state first, then last assistant messages.
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

  if (/^[abcd]$/i.test(lower)) {
    const k = lower.toUpperCase();
    const text = opts[k];
    if (text) return { raw: rawMessage.trim(), selectedLabel: k, selectedText: text, source };
  }

  if (/^[1-4]$/.test(lower)) {
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

  if (/\blast\b/i.test(lower)) {
    const keys = Object.keys(opts).sort();
    const k = keys[keys.length - 1];
    if (k && opts[k]) {
      return { raw: rawMessage.trim(), selectedLabel: k, selectedText: opts[k]!, source };
    }
  }

  const optMatch = lower.match(/\boption\s*([abcd1-4])\b/);
  if (optMatch) {
    const x = optMatch[1]!.toUpperCase();
    if (/[ABCD]/.test(x) && opts[x]) {
      return { raw: rawMessage.trim(), selectedLabel: x, selectedText: opts[x]!, source };
    }
    const n = Number(x);
    if (n >= 1 && n <= 4) {
      const keys = Object.keys(opts).sort();
      const k = keys[n - 1];
      if (k && opts[k]) {
        return { raw: rawMessage.trim(), selectedLabel: k, selectedText: opts[k]!, source };
      }
    }
  }

  return null;
}
