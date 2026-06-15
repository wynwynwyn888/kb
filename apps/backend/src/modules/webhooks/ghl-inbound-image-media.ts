/**
 * GHL inbound image attachment URL extraction (mirrors audio media helpers).
 * GHL often sends WhatsApp/Messenger photos as body `>IMAGE<` plus caption, with the real URL in attachments.
 */

import {
  collectGhlInboundMediaRootNodes,
  filenameExtensionHintsAudio,
  normalizeGhlBodyForPlaceholderClassification,
  peelGhlPlaceholderOuterWrappers,
} from './ghl-inbound-audio-media';

function asNonEmptyString(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

function isHttpUrl(s: string): boolean {
  return /^https?:\/\//i.test(s);
}

const URL_FIELD_KEYS = [
  'url',
  'fileUrl',
  'mediaUrl',
  'downloadUrl',
  'attachmentUrl',
  'secureUrl',
  'link',
  'sourceUrl',
  'src',
  'href',
] as const;

function extractUrlFromAttachmentLikeObject(item: Record<string, unknown>): string | null {
  for (const k of URL_FIELD_KEYS) {
    const u = asNonEmptyString(item[k]);
    if (u && isHttpUrl(u)) return u;
  }
  return null;
}

function attachmentHintsImage(item: Record<string, unknown>): boolean {
  const mime = String(item['contentType'] ?? item['mimeType'] ?? item['content_type'] ?? '').toLowerCase();
  const typ = String(item['type'] ?? item['messageType'] ?? '').toLowerCase();
  const name = String(item['name'] ?? item['filename'] ?? item['fileName'] ?? '').toLowerCase();
  if (mime.startsWith('image/')) return true;
  if (typ.includes('image') || typ === 'photo' || typ === 'picture') return true;
  if (/\.(jpe?g|png|gif|webp|heic|bmp|avif)$/i.test(name)) return true;
  return false;
}

function attachmentHintsAudio(item: Record<string, unknown>): boolean {
  const mime = String(item['contentType'] ?? item['mimeType'] ?? item['content_type'] ?? '').toLowerCase();
  const typ = String(item['type'] ?? item['messageType'] ?? '').toLowerCase();
  const name = String(item['name'] ?? item['filename'] ?? item['fileName'] ?? '').toLowerCase();
  if (mime.startsWith('audio/') || mime.includes('audio')) return true;
  if (typ.includes('audio') || typ.includes('voice')) return true;
  return filenameExtensionHintsAudio(name);
}

function urlFilenameHintsImage(url: string): boolean {
  const path = url.split('?')[0] ?? url;
  return /\.(jpe?g|png|gif|webp|heic|bmp|avif)$/i.test(path);
}

function urlLooksLikeAudio(url: string): boolean {
  return filenameExtensionHintsAudio(url);
}

/** GHL inbox placeholder line e.g. `>IMAGE<`, `[IMAGE]`, `IMAGE`. */
export function classifyGhlImagePlaceholderBody(value: unknown): 'IMAGE' | 'UNKNOWN' {
  const n = normalizeGhlBodyForPlaceholderClassification(value);
  if (!n) return 'UNKNOWN';
  const peeled = peelGhlPlaceholderOuterWrappers(n);
  const core = peeled.toLowerCase().trim();
  if (core === 'image' || core === 'photo' || core === 'picture') return 'IMAGE';
  return 'UNKNOWN';
}

export function ghlBodyIndicatesImagePlaceholder(value: unknown): boolean {
  const raw = String(value ?? '');
  if (!raw.trim()) return false;
  for (const line of raw.split(/\r?\n/)) {
    if (classifyGhlImagePlaceholderBody(line) === 'IMAGE') return true;
  }
  return classifyGhlImagePlaceholderBody(raw) === 'IMAGE';
}

/** Remove GHL `>IMAGE<` placeholder lines; keep customer caption text. */
export function stripGhlImagePlaceholderFromInboundBody(body: string): string {
  const kept = body
    .split(/\r?\n/)
    .filter(line => classifyGhlImagePlaceholderBody(line) === 'UNKNOWN');
  return kept.join('\n').trim();
}

function pushImageUrl(found: string[], url: string | null, relaxed: boolean): void {
  if (!url || !isHttpUrl(url) || urlLooksLikeAudio(url)) return;
  if (!relaxed && !urlFilenameHintsImage(url)) return;
  found.push(url);
}

function extractImageUrlsFromAttachmentsValue(
  attachments: unknown,
  relaxed: boolean,
  found: string[],
): void {
  if (!Array.isArray(attachments)) return;
  for (const item of attachments) {
    if (typeof item === 'string') {
      pushImageUrl(found, item.trim(), relaxed);
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    if (relaxed) {
      if (attachmentHintsAudio(rec)) continue;
      pushImageUrl(found, extractUrlFromAttachmentLikeObject(rec), true);
    } else if (attachmentHintsImage(rec)) {
      pushImageUrl(found, extractUrlFromAttachmentLikeObject(rec), false);
    }
  }
}

function extractImageUrlsFromMeta(meta: unknown, relaxed: boolean, found: string[]): void {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return;
  const m = meta as Record<string, unknown>;
  for (const key of URL_FIELD_KEYS) {
    const u = asNonEmptyString(m[key]);
    pushImageUrl(found, u, relaxed);
  }
  const wa = m['whatsapp'];
  if (wa && typeof wa === 'object' && !Array.isArray(wa)) {
    const w = wa as Record<string, unknown>;
    const att = w['attachment'];
    if (att && typeof att === 'object' && !Array.isArray(att)) {
      pushImageUrl(found, extractUrlFromAttachmentLikeObject(att as Record<string, unknown>), relaxed);
    }
  }
}

function extractImageUrlsFromNode(node: Record<string, unknown>, relaxed: boolean): string[] {
  const found: string[] = [];

  extractImageUrlsFromAttachmentsValue(node['attachments'], relaxed, found);
  extractImageUrlsFromMeta(node['meta'], relaxed, found);

  const consider = (item: Record<string, unknown>) => {
    if (relaxed) {
      if (attachmentHintsAudio(item)) return;
      pushImageUrl(found, extractUrlFromAttachmentLikeObject(item), true);
      return;
    }
    if (!attachmentHintsImage(item)) return;
    pushImageUrl(found, extractUrlFromAttachmentLikeObject(item), false);
  };

  const media = node['media'];
  if (media && typeof media === 'object' && !Array.isArray(media)) {
    consider(media as Record<string, unknown>);
  }
  if (Array.isArray(media)) {
    for (const item of media) {
      if (typeof item === 'string') {
        pushImageUrl(found, item.trim(), relaxed);
        continue;
      }
      if (!item || typeof item !== 'object') continue;
      consider(item as Record<string, unknown>);
    }
  }

  const msg = node['message'];
  if (typeof msg === 'string') {
    pushImageUrl(found, asNonEmptyString(msg), relaxed);
    for (const match of msg.matchAll(/https?:\/\/[^\s"'<>]+/gi)) {
      pushImageUrl(found, match[0] ?? null, relaxed);
    }
  }

  if (relaxed) {
    for (const key of URL_FIELD_KEYS) {
      pushImageUrl(found, asNonEmptyString(node[key]), true);
    }
  }

  return found;
}

/**
 * Best-effort image URL for inbound photo messages across nested GHL shapes.
 */
export function extractGhlInboundImageMediaUrl(
  data: Record<string, unknown>,
  opts?: {
    envelope?: Record<string, unknown>;
    workflowFlatRaw?: Record<string, unknown>;
    messageBody?: string;
  },
): string | null {
  const roots = collectGhlInboundMediaRootNodes(data, opts?.envelope, opts?.workflowFlatRaw);
  const bodyRelaxed = ghlBodyIndicatesImagePlaceholder(opts?.messageBody ?? '');
  const attachmentPresent = roots.some(node => {
    const att = node['attachments'];
    return Array.isArray(att) && att.length > 0;
  });
  const relaxed = bodyRelaxed || attachmentPresent;

  for (const node of roots) {
    const urls = extractImageUrlsFromNode(node, false);
    if (urls.length > 0) return urls[0]!;
  }

  if (relaxed) {
    for (const node of roots) {
      const urls = extractImageUrlsFromNode(node, true);
      if (urls.length > 0) return urls[0]!;
    }
  }

  return null;
}

/** True when webhook payload has attachment nodes but no audio URL was resolved. */
export function ghlInboundHasAttachmentNodes(
  data: Record<string, unknown>,
  envelope?: Record<string, unknown>,
  workflowFlatRaw?: Record<string, unknown>,
): boolean {
  return collectGhlInboundMediaRootNodes(data, envelope, workflowFlatRaw).some(node => {
    const att = node['attachments'];
    return Array.isArray(att) && att.length > 0;
  });
}

function rowBody(row: Record<string, unknown>): string {
  const messageObj =
    row['message'] && typeof row['message'] === 'object' && !Array.isArray(row['message'])
      ? (row['message'] as Record<string, unknown>)
      : null;
  for (const k of ['body', 'message', 'text', 'content'] as const) {
    const v = row[k] ?? messageObj?.[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

function messageRowIndicatesImage(row: Record<string, unknown>): boolean {
  const body = rowBody(row);
  if (ghlBodyIndicatesImagePlaceholder(body)) return true;
  const bundle = [
    String(row['type'] ?? ''),
    String(row['messageType'] ?? ''),
    String(row['contentType'] ?? ''),
    String(row['source'] ?? ''),
  ].join(' ');
  return /image|photo|picture|ImageMessage/i.test(bundle);
}

/** Extract image URL from a GHL conversation message row (message history API). */
export function extractGhlMessageImageMediaUrlFromRow(row: Record<string, unknown>): string | null {
  const body = rowBody(row);
  const relaxed =
    messageRowIndicatesImage(row) ||
    ghlBodyIndicatesImagePlaceholder(body) ||
    (Array.isArray(row['attachments']) && row['attachments'].length > 0);
  const direct = extractImageUrlsFromNode(row, relaxed);
  if (direct.length > 0) return direct[0]!;

  for (const nestedKey of ['message', 'payload', 'data', 'customData'] as const) {
    const nested = row[nestedKey];
    if (!nested || typeof nested !== 'object' || Array.isArray(nested)) continue;
    const urls = extractImageUrlsFromNode(nested as Record<string, unknown>, true);
    if (urls.length > 0) return urls[0]!;
  }
  return null;
}
