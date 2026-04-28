/**
 * Generic, business-agnostic section splitting for plain-text / markdown KB notes.
 *
 * Heading detectors only — never matches specific industries or business names.
 * Supports:
 *   - Markdown ATX headings (# .. ######)
 *   - Markdown Setext headings (line followed by === or ---)
 *   - ALL-CAPS headings (Unicode-aware: handles accents like LUMIÈRE)
 *   - Markdown bold-wrapped headings on a line of their own (**ADDRESS**)
 *   - Short colon-suffixed labels ("Opening Hours:")
 *
 * Input is normalized (CRLF/CR/LS/PS → LF, BOM stripped, NBSP → space) before parsing
 * so notes pasted from Word, web editors, or Mac classic line endings still chunk.
 */

export type KbNoteSection = {
  sectionIndex: number;
  /** `null` = preamble before first heading. */
  sectionTitle: string | null;
  body: string;
};

const MAX_SECTION_CHARS_DEFAULT = 12_000;
const SUBPART_TARGET = 6000;

/** Markdown ATX headings at line start. */
const RE_MD_HEADING = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;

/** Horizontal rule / separator line — section boundary without a new title (flush block). */
const RE_HR = /^\s*(?:-{3,}|_{3,}|\*{3,}|={3,})\s*$/;

/** `**Heading**` or `__Heading__` (entire line). */
const RE_BOLD_LINE = /^\s*(?:\*\*|__)([^*_]{2,80})(?:\*\*|__)\s*$/;

/** Setext underline `===` (level 1) or `---` (level 2) — must be ≥ title length. */
const RE_SETEXT_EQ = /^\s*={3,}\s*$/;
const RE_SETEXT_DASH = /^\s*-{3,}\s*$/;

/**
 * Normalize note text so heading detection isn't broken by editor/OS quirks.
 * - strip BOM and zero-width chars
 * - CRLF / CR / LS / PS → LF
 * - NBSP / narrow NBSP → regular space
 * - trim trailing whitespace per line
 * - collapse 3+ blank lines to a single blank line (keeps section boundaries readable)
 */
export function normalizeNoteText(input: string): string {
  if (!input) return '';
  let s = input;
  // Strip UTF-8/16 BOM and zero-width / direction marks at start of stream.
  s = s.replace(/^\uFEFF/, '');
  s = s.replace(/[\u200B-\u200D\u2060]/g, '');
  // Normalize all line separators to LF so split('\n') is reliable.
  s = s.replace(/\r\n?|\u2028|\u2029|\u0085/g, '\n');
  // NBSP variants → regular space.
  s = s.replace(/[\u00A0\u202F\u2007]/g, ' ');
  // Per-line trailing whitespace trim, keep internal indentation.
  s = s
    .split('\n')
    .map(line => line.replace(/[\t \u3000]+$/u, ''))
    .join('\n');
  // Collapse runs of blank lines (3+) to two — keeps explicit section gaps tidy.
  s = s.replace(/\n{3,}/g, '\n\n');
  return s;
}

/**
 * Decide whether a single line *looks like* a heading.
 *
 * Universal rules (no business knowledge):
 *  - Markdown `#` ATX heading
 *  - Markdown bold/underline-bold on a line by itself
 *  - ALL-CAPS heading (Unicode-aware)
 *  - Short label ending with `:` and no internal sentence punctuation
 */
export function detectHeading(line: string): { isHeading: boolean; reason: string; title: string } {
  const t = line.trim();
  if (!t) return { isHeading: false, reason: 'blank', title: '' };
  if (RE_HR.test(t)) return { isHeading: false, reason: 'separator', title: '' };

  if (RE_MD_HEADING.test(t)) {
    const m = t.match(RE_MD_HEADING)!;
    return { isHeading: true, reason: 'markdown_atx', title: (m[2] ?? '').trim() };
  }

  if (RE_BOLD_LINE.test(t)) {
    const m = t.match(RE_BOLD_LINE)!;
    return { isHeading: true, reason: 'markdown_bold', title: (m[1] ?? '').trim() };
  }

  if (lineLooksLikeAllCapsHeading(t)) {
    return { isHeading: true, reason: 'all_caps', title: t };
  }

  if (lineLooksLikeColonHeading(t)) {
    return { isHeading: true, reason: 'colon_label', title: t.replace(/:\s*$/, '').trim() };
  }

  return { isHeading: false, reason: 'prose', title: '' };
}

/** Backward-compatible boolean checker (used by some callers/tests). */
export function isSectionHeadingLine(line: string): boolean {
  return detectHeading(line).isHeading;
}

/** Backward-compatible title extractor. */
export function headingTitleFromLine(line: string): string {
  return detectHeading(line).title || line.trim();
}

/**
 * ALL-CAPS heading detector — Unicode-aware so accented headings (e.g. LUMIÈRE)
 * are recognised. Also tolerates `&`, `/`, `-`, `(`, `)`, `'`, `,`, digits.
 */
export function lineLooksLikeAllCapsHeading(line: string): boolean {
  const t = line.trim();
  if (t.length < 2 || t.length > 88) return false;
  // Disallow obvious sentence endings (heading shouldn't end with `.`, `!`, `?`).
  if (/[.!?]\s*$/.test(t)) return false;
  // Disallow lines containing internal sentence-style punctuation runs.
  if (/[.!?]\s+\S/.test(t)) return false;
  // ISO date is not a heading.
  if (/\b\d{4}-\d{2}-\d{2}\b/.test(t)) return false;

  const lowercase = (t.match(/\p{Ll}/gu) ?? []).length;
  if (lowercase > 0) return false;
  const letters = (t.match(/\p{L}/gu) ?? []).length;
  if (letters < 2) return false;
  const upper = (t.match(/\p{Lu}/gu) ?? []).length;
  return upper / letters >= 0.7;
}

/**
 * `Opening Hours:` style — short label terminated by colon, no sentence punctuation.
 */
export function lineLooksLikeColonHeading(line: string): boolean {
  const t = line.trim();
  if (!t.endsWith(':')) return false;
  const body = t.replace(/:\s*$/, '').trim();
  if (body.length < 2 || body.length > 60) return false;
  if (/[.!?]/.test(body)) return false;
  // Must contain at least one letter (avoid timestamps "12:")
  if (!/\p{L}/u.test(body)) return false;
  return true;
}

/**
 * Diagnostic-only helper: classify the first `maxLines` non-empty lines so operators can
 * see *why* heading detection is/is not firing on a real note. Truncates lines at 80 chars.
 */
export function classifyHeadingLines(
  rawText: string,
  maxLines = 20,
): Array<{
  lineNum: number;
  rawLen: number;
  trimmedPreview: string;
  isHeading: boolean;
  headingReason: string;
}> {
  const norm = normalizeNoteText(rawText);
  const lines = norm.split('\n');
  const out: Array<{
    lineNum: number;
    rawLen: number;
    trimmedPreview: string;
    isHeading: boolean;
    headingReason: string;
  }> = [];
  for (let i = 0; i < lines.length && out.length < maxLines; i++) {
    const raw = lines[i] ?? '';
    if (!raw.trim()) continue;
    const det = detectHeading(raw);
    out.push({
      lineNum: i + 1,
      rawLen: raw.length,
      trimmedPreview: raw.trim().slice(0, 80),
      isHeading: det.isHeading,
      headingReason: det.reason,
    });
  }
  return out;
}

/**
 * Split full note text into ordered sections (preamble allowed with `sectionTitle: null`).
 * Handles Setext-style headings ("Title\n===") via lookahead.
 */
export function splitNoteIntoSections(fullText: string): KbNoteSection[] {
  const raw = normalizeNoteText(fullText).trim();
  if (!raw) return [];

  const lines = raw.split('\n');
  const out: KbNoteSection[] = [];
  let currentTitle: string | null = null;
  const buf: string[] = [];

  const flush = () => {
    const body = buf.join('\n').trim();
    buf.length = 0;
    if (!body && currentTitle === null && out.length === 0) return;
    if (!body && currentTitle === null) return;
    out.push({
      sectionIndex: out.length,
      sectionTitle: currentTitle,
      body: body || '',
    });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';

    // Setext: previous line is the title, this line is === or ---
    const next = lines[i + 1] ?? '';
    const trimmedLine = line.trim();
    if (trimmedLine && (RE_SETEXT_EQ.test(next) || RE_SETEXT_DASH.test(next))) {
      // Avoid mistaking a real HR after blank line as setext underline (require non-blank title above).
      const looksLikeUnderlineForThisLine = trimmedLine.length > 0 && trimmedLine.length <= 88;
      if (looksLikeUnderlineForThisLine) {
        flush();
        currentTitle = trimmedLine;
        i++; // consume underline
        continue;
      }
    }

    if (RE_HR.test(line)) {
      flush();
      currentTitle = null;
      continue;
    }

    const det = detectHeading(line);
    if (det.isHeading) {
      flush();
      currentTitle = det.title || trimmedLine;
      continue;
    }

    buf.push(line);
  }
  flush();

  if (out.length === 0) {
    return [{ sectionIndex: 0, sectionTitle: null, body: raw }];
  }
  return out.map((s, i) => ({ ...s, sectionIndex: i }));
}

function splitBodyBySize(body: string, maxChars: number): string[] {
  const b = body.trim();
  if (b.length <= maxChars) return [b];
  const parts: string[] = [];
  const paras = b.split(/\n{2,}/);
  let cur = '';
  for (const p of paras) {
    const add = cur ? `${cur}\n\n${p}` : p;
    if (add.length > maxChars && cur) {
      parts.push(cur.trim());
      cur = p;
    } else {
      cur = add;
    }
  }
  if (cur.trim()) parts.push(cur.trim());
  if (parts.length === 0) return [b.slice(0, maxChars)];
  const refined: string[] = [];
  for (const part of parts) {
    if (part.length <= maxChars) {
      refined.push(part);
      continue;
    }
    for (let i = 0; i < part.length; i += SUBPART_TARGET) {
      refined.push(part.slice(i, i + SUBPART_TARGET).trim());
    }
  }
  return refined.filter(Boolean);
}

export type RichTextChunkSpec = {
  content: string;
  tokenCount: number;
  metadata: Record<string, unknown>;
};

/**
 * Build DB-ready chunk rows for a rich-text / manual note with section metadata.
 * Always emits `sectionTitle`, `sectionIndex`, `sectionPartIndex`, `documentTitle`,
 * `chunkType`, `documentUpdatedAt`, `updatedAt` so downstream retrieval is stable.
 */
export function buildRichTextChunkSpecs(params: {
  fullText: string;
  documentTitle: string;
  documentUpdatedAtIso: string;
  maxSectionChars?: number;
}): RichTextChunkSpec[] {
  const maxSection = params.maxSectionChars ?? MAX_SECTION_CHARS_DEFAULT;
  const sections = splitNoteIntoSections(params.fullText);
  const rows: RichTextChunkSpec[] = [];

  for (const sec of sections) {
    const parts = splitBodyBySize(sec.body, maxSection);
    parts.forEach((body, partIdx) => {
      if (!body.trim()) return;
      rows.push({
        content: body.trim(),
        tokenCount: Math.max(1, Math.ceil(body.length / 4)),
        metadata: {
          chunkType: 'section',
          sectionTitle: sec.sectionTitle,
          sectionIndex: sec.sectionIndex,
          sectionPartIndex: partIdx,
          documentTitle: params.documentTitle,
          charCount: body.length,
          documentUpdatedAt: params.documentUpdatedAtIso,
          updatedAt: params.documentUpdatedAtIso,
        },
      });
    });
  }

  if (rows.length === 0) {
    const fallback = normalizeNoteText(params.fullText).trim().slice(0, maxSection);
    rows.push({
      content: fallback,
      tokenCount: Math.max(1, Math.ceil(fallback.length / 4)),
      metadata: {
        chunkType: 'section',
        sectionTitle: null,
        sectionIndex: 0,
        sectionPartIndex: 0,
        documentTitle: params.documentTitle,
        charCount: fallback.length,
        documentUpdatedAt: params.documentUpdatedAtIso,
        updatedAt: params.documentUpdatedAtIso,
      },
    });
  }

  return rows;
}
