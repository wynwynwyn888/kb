/**
 * Deterministic WhatsApp replies for pure A–H / 1–8 option picks (no LLM).
 * Parses assistant option lines like "Title: Description" or "Title - Description".
 */

export type ParsedOptionLine = {
  title: string;
  /** Substance after ':' or spaced hyphen; null when absent */
  description: string | null;
};

function stripTrailingPeriodRun(s: string): string {
  return s.replace(/\.+$/, '').trim();
}

function normalizeOptionalDescription(raw: string): string | null {
  const d = stripTrailingPeriodRun(raw.trim());
  return d.length > 0 ? d : null;
}

/**
 * Split stored option label text into title + optional description.
 * Prefer spaced hyphen (` - `) before first colon so titles may contain ':' rarely.
 */
export function parseSelectedOptionTitleDescription(optionText: string): ParsedOptionLine {
  const t = optionText.trim();
  if (!t) return { title: '', description: null };

  const hyphen = t.match(/^(.+?)\s+-\s+(.+)$/);
  if (hyphen) {
    const title = stripTrailingPeriodRun(hyphen[1]!.trim());
    const description = normalizeOptionalDescription(hyphen[2]!);
    if (title) return { title, description };
  }

  const colonIdx = t.indexOf(':');
  if (colonIdx > 0) {
    const title = stripTrailingPeriodRun(t.slice(0, colonIdx).trim());
    const rest = t.slice(colonIdx + 1).trim();
    const description = normalizeOptionalDescription(rest);
    if (title) {
      return { title, description: description && description.length ? description : null };
    }
  }

  return { title: stripTrailingPeriodRun(t), description: null };
}

/** Lowercase first letter so it reads mid-sentence after "is …". */
export function descriptionForMidSentence(description: string): string {
  const d = stripTrailingPeriodRun(description.trim());
  if (!d) return d;
  const first = d[0]!;
  const rest = d.slice(1);
  return /[A-Za-z]/.test(first) ? first.toLowerCase() + rest : d;
}

const CTA_WITH_DETAILS =
  'Would you like me to help check availability, or share more details about this service?';
const CTA_TITLE_ONLY = 'Would you like me to share more details?';

export function buildOptionSelectionCustomerReply(parsed: ParsedOptionLine): string {
  const title = (parsed.title || 'that').trim();
  const desc = parsed.description?.trim();
  if (desc) {
    const mid = descriptionForMidSentence(desc);
    return `Sure — ${title} is ${mid}.\n\n${CTA_WITH_DETAILS}`;
  }
  return `Sure — you selected ${title}.\n\n${CTA_TITLE_ONLY}`;
}
