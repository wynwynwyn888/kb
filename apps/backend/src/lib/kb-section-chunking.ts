/**
 * Generic section splitting for long plain-text / markdown knowledge notes.
 * No business-specific headings — detects structure only (markdown #, ALL-CAPS lines, rules).
 */

export type KbNoteSection = {
  sectionIndex: number;
  /** `null` = preamble before first heading */
  sectionTitle: string | null;
  body: string;
};

const MAX_SECTION_CHARS_DEFAULT = 12_000;
const SUBPART_TARGET = 6000;

/** Markdown ATX headings at line start. */
const RE_MD_HEADING = /^\s{0,3}(#{1,6})\s+(.+?)\s*$/;

/** Horizontal rule / separator line — section boundary without a new title (flush block). */
const RE_HR = /^\s*(?:-{3,}|_{3,}|\*{3,}|={3,})\s*$/;

function stripMdHashes(raw: string): string {
  const m = raw.match(RE_MD_HEADING);
  if (!m) return raw.trim();
  return (m[2] ?? '').trim();
}

/**
 * Line looks like an ALL-CAPS title (no lowercase letters; has letters; bounded length).
 */
export function lineLooksLikeAllCapsHeading(line: string): boolean {
  const t = line.trim();
  if (t.length < 3 || t.length > 88) return false;
  if (/[a-z]/.test(t)) return false;
  if (!/[A-Z]/.test(t)) return false;
  if (/[.!?]\s+[A-Z]/.test(t)) return false;
  if (/\d{4}-\d{2}-\d{2}/.test(t)) return false;
  const letters = t.replace(/[^A-Za-z]/g, '');
  if (letters.length < 3) return false;
  const upper = t.replace(/[^A-Z]/g, '').length;
  return upper / letters.length >= 0.85;
}

export function isSectionHeadingLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (RE_MD_HEADING.test(t)) return true;
  if (RE_HR.test(t)) return false;
  return lineLooksLikeAllCapsHeading(t);
}

export function headingTitleFromLine(line: string): string {
  const t = line.trim();
  const m = t.match(RE_MD_HEADING);
  if (m?.[2]) return m[2].trim();
  return t;
}

/**
 * Split full note text into ordered sections (preamble allowed with `sectionTitle: null`).
 */
export function splitNoteIntoSections(fullText: string): KbNoteSection[] {
  const raw = fullText.replace(/\r\n/g, '\n').trim();
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

  for (const line of lines) {
    if (RE_HR.test(line)) {
      flush();
      currentTitle = null;
      continue;
    }
    if (isSectionHeadingLine(line)) {
      flush();
      currentTitle = headingTitleFromLine(line);
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
          ...(parts.length > 1 ? { sectionPartIndex: partIdx } : {}),
          documentTitle: params.documentTitle,
          charCount: body.length,
          documentUpdatedAt: params.documentUpdatedAtIso,
          updatedAt: params.documentUpdatedAtIso,
        },
      });
    });
  }

  if (rows.length === 0) {
    const fallback = params.fullText.trim().slice(0, maxSection);
    rows.push({
      content: fallback,
      tokenCount: Math.max(1, Math.ceil(fallback.length / 4)),
      metadata: {
        chunkType: 'section',
        sectionTitle: null,
        sectionIndex: 0,
        documentTitle: params.documentTitle,
        charCount: fallback.length,
        documentUpdatedAt: params.documentUpdatedAtIso,
        updatedAt: params.documentUpdatedAtIso,
      },
    });
  }

  return rows;
}
