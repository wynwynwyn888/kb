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

function extractImageUrlsFromNode(node: Record<string, unknown>, relaxed: boolean): string[] {
  const found: string[] = [];

  const consider = (item: Record<string, unknown>) => {
    if (relaxed) {
      if (attachmentHintsAudio(item)) return;
      const u = extractUrlFromAttachmentLikeObject(item);
      if (u && !urlLooksLikeAudio(u)) found.push(u);
      return;
    }
    if (!attachmentHintsImage(item)) return;
    const u = extractUrlFromAttachmentLikeObject(item);
    if (u) found.push(u);
  };

  const att = node['attachments'];
  if (Array.isArray(att)) {
    for (const item of att) {
      if (!item || typeof item !== 'object') continue;
      consider(item as Record<string, unknown>);
    }
  }

  const media = node['media'];
  if (media && typeof media === 'object' && !Array.isArray(media)) {
    consider(media as Record<string, unknown>);
  }
  if (Array.isArray(media)) {
    for (const item of media) {
      if (!item || typeof item !== 'object') continue;
      consider(item as Record<string, unknown>);
    }
  }

  const msg = node['message'];
  if (typeof msg === 'string') {
    const u = asNonEmptyString(msg);
    if (u && isHttpUrl(u) && !urlLooksLikeAudio(u)) {
      if (relaxed || urlFilenameHintsImage(u)) found.push(u);
    }
  }

  if (relaxed) {
    for (const key of URL_FIELD_KEYS) {
      const u = asNonEmptyString(node[key]);
      if (u && isHttpUrl(u) && !urlLooksLikeAudio(u)) found.push(u);
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
  const relaxed = ghlBodyIndicatesImagePlaceholder(opts?.messageBody ?? '');

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
