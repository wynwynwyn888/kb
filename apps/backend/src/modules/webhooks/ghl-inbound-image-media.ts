/**
 * GHL inbound image attachment URL extraction (mirrors audio media helpers).
 */

import { collectGhlInboundMediaRootNodes } from './ghl-inbound-audio-media';

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
  if (typ.includes('image')) return true;
  if (/\.(jpe?g|png|gif|webp|heic|bmp|avif)$/i.test(name)) return true;
  return false;
}

function urlFilenameHintsImage(url: string): boolean {
  const path = url.split('?')[0] ?? url;
  return /\.(jpe?g|png|gif|webp|heic|bmp|avif)$/i.test(path);
}

function extractImageUrlsFromNode(node: Record<string, unknown>): string[] {
  const found: string[] = [];

  const att = node['attachments'];
  if (Array.isArray(att)) {
    for (const item of att) {
      if (!item || typeof item !== 'object') continue;
      const o = item as Record<string, unknown>;
      if (!attachmentHintsImage(o)) continue;
      const u = extractUrlFromAttachmentLikeObject(o);
      if (u) found.push(u);
    }
  }

  const media = node['media'];
  if (media && typeof media === 'object' && !Array.isArray(media)) {
    const o = media as Record<string, unknown>;
    if (attachmentHintsImage(o)) {
      const u = extractUrlFromAttachmentLikeObject(o);
      if (u) found.push(u);
    }
  }
  if (Array.isArray(media)) {
    for (const item of media) {
      if (!item || typeof item !== 'object') continue;
      const o = item as Record<string, unknown>;
      if (!attachmentHintsImage(o)) continue;
      const u = extractUrlFromAttachmentLikeObject(o);
      if (u) found.push(u);
    }
  }

  const msg = node['message'];
  if (typeof msg === 'string') {
    const u = asNonEmptyString(msg);
    if (u && isHttpUrl(u) && urlFilenameHintsImage(u)) found.push(u);
  }

  return found;
}

/**
 * Best-effort image URL for inbound photo messages across nested GHL shapes.
 */
export function extractGhlInboundImageMediaUrl(
  data: Record<string, unknown>,
  opts?: { envelope?: Record<string, unknown>; workflowFlatRaw?: Record<string, unknown> },
): string | null {
  const roots = collectGhlInboundMediaRootNodes(data, opts?.envelope, opts?.workflowFlatRaw);
  for (const node of roots) {
    const urls = extractImageUrlsFromNode(node);
    if (urls.length > 0) return urls[0]!;
  }
  return null;
}
