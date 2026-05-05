/**
 * GHL inbound `conversation_message_created` payloads vary by channel and version.
 * We collect likely audio attachment URLs from common shapes without coupling to one schema.
 */

export { VOICE_INBOUND_PLACEHOLDER_NO_MEDIA_USER_MESSAGE } from '../transcription/audio-transcription.service';

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

/** GHL / WhatsApp often sends a text placeholder instead of real body when type is "unsupported". */
export function ghlBodyIndicatesAudioPlaceholder(message: string): boolean {
  const t = message.trim().toLowerCase();
  if (!t) return false;
  const needles = [
    'this message type is not supported',
    'message type is not supported',
    'audio message',
    'voice message',
    'unsupported message',
    'unsupported audio',
  ];
  return needles.some((n) => t.includes(n));
}

/**
 * Plain inbound text from `data.message` (string) or nested text fields when message is an object.
 */
export function extractGhlInboundMessageBodyString(data: Record<string, unknown>): string {
  const m = data['message'];
  if (typeof m === 'string') return m;
  if (m && typeof m === 'object' && !Array.isArray(m)) {
    const o = m as Record<string, unknown>;
    const nested =
      asNonEmptyString(o['text']) ??
      asNonEmptyString(o['body']) ??
      asNonEmptyString(o['content']) ??
      asNonEmptyString(o['message']);
    if (nested) return nested;
  }
  return '';
}

function digRecord(root: Record<string, unknown>, path: string[]): Record<string, unknown> | null {
  let cur: unknown = root;
  for (const key of path) {
    if (cur == null || typeof cur !== 'object' || Array.isArray(cur)) return null;
    cur = (cur as Record<string, unknown>)[key];
  }
  if (cur == null || typeof cur !== 'object' || Array.isArray(cur)) return null;
  return cur as Record<string, unknown>;
}

function firstMessagesArrayItem(root: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!root) return null;
  const arr = root['messages'];
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const first = arr[0];
  if (!first || typeof first !== 'object' || Array.isArray(first)) return null;
  return first as Record<string, unknown>;
}

/**
 * Ordered nodes that may carry `attachments`, `media`, or URL fields (deepest / message-shaped first).
 */
export function collectGhlInboundMediaRootNodes(
  data: Record<string, unknown>,
  envelope?: Record<string, unknown>,
  workflowFlatRaw?: Record<string, unknown>,
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const seen = new WeakSet<object>();

  const push = (o: Record<string, unknown> | null) => {
    if (!o || seen.has(o)) return;
    seen.add(o);
    out.push(o);
  };

  if (workflowFlatRaw) {
    const w = workflowFlatRaw;
    push(digRecord(w, ['customData', 'message']));
    const cd = w['customData'];
    if (cd && typeof cd === 'object' && !Array.isArray(cd)) {
      push(cd as Record<string, unknown>);
    }
    const topMsg = w['message'];
    if (topMsg && typeof topMsg === 'object' && !Array.isArray(topMsg)) {
      push(topMsg as Record<string, unknown>);
    }
    push(w);
  }

  push(digRecord(data, ['data', 'message']));
  push(digRecord(data, ['message']));
  push(firstMessagesArrayItem(data));
  push(digRecord(data, ['data']));
  push(data);
  push(firstMessagesArrayItem(envelope));
  if (envelope && typeof envelope === 'object' && !Array.isArray(envelope)) {
    push(envelope as Record<string, unknown>);
  }

  return out;
}

function extractUrlFromAttachmentLikeObject(item: Record<string, unknown>): string | null {
  for (const k of URL_FIELD_KEYS) {
    const u = asNonEmptyString(item[k]);
    if (u && isHttpUrl(u)) return u;
  }
  return null;
}

function extractUrlsFromNode(node: Record<string, unknown>): string | null {
  for (const key of [
    'mediaUrl',
    'fileUrl',
    'downloadUrl',
    'attachmentUrl',
    'url',
    'audioUrl',
    'mediaURL',
  ]) {
    const u = asNonEmptyString(node[key]);
    if (u && isHttpUrl(u)) return u;
  }

  const msg = node['message'];
  if (typeof msg === 'string') {
    const u = asNonEmptyString(msg);
    if (u && isHttpUrl(u)) return u;
  }

  const att = node['attachments'];
  if (Array.isArray(att)) {
    for (const item of att) {
      if (!item || typeof item !== 'object') continue;
      const u = extractUrlFromAttachmentLikeObject(item as Record<string, unknown>);
      if (u) return u;
    }
  }

  const media = node['media'];
  if (media && typeof media === 'object' && !Array.isArray(media)) {
    const o = media as Record<string, unknown>;
    const u =
      extractUrlFromAttachmentLikeObject(o) ??
      asNonEmptyString(o['url']) ??
      asNonEmptyString(o['sourceUrl']) ??
      asNonEmptyString(o['link']);
    if (u && isHttpUrl(u)) return u;
  }

  if (Array.isArray(media)) {
    for (const item of media) {
      if (!item || typeof item !== 'object') continue;
      const u = extractUrlFromAttachmentLikeObject(item as Record<string, unknown>);
      if (u) return u;
    }
  }

  return null;
}

/**
 * Best-effort media URL for voice / audio inbound messages across nested GHL shapes.
 */
export function extractGhlInboundAudioMediaUrl(
  data: Record<string, unknown>,
  opts?: { envelope?: Record<string, unknown>; workflowFlatRaw?: Record<string, unknown> },
): string | null {
  const roots = collectGhlInboundMediaRootNodes(
    data,
    opts?.envelope,
    opts?.workflowFlatRaw,
  );
  for (const node of roots) {
    const u = extractUrlsFromNode(node);
    if (u) return u;
  }
  return null;
}

function attachmentArrayHintsAudio(attachments: unknown): boolean {
  if (!Array.isArray(attachments)) return false;
  for (const item of attachments) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const mime = String(o['contentType'] ?? o['mimeType'] ?? o['content_type'] ?? '').toLowerCase();
    const typ = String(o['type'] ?? o['messageType'] ?? '').toLowerCase();
    const name = String(o['name'] ?? o['filename'] ?? o['fileName'] ?? '').toLowerCase();
    if (mime.startsWith('audio/') || mime.includes('audio')) return true;
    if (typ.includes('audio') || typ.includes('voice')) return true;
    if (filenameExtensionHintsAudio(name)) return true;
  }
  return false;
}

function mediaObjectHintsAudio(media: unknown): boolean {
  if (!media || typeof media !== 'object') return false;
  if (Array.isArray(media)) {
    for (const m of media) {
      if (m && typeof m === 'object' && attachmentArrayHintsAudio([m])) return true;
    }
    return false;
  }
  const o = media as Record<string, unknown>;
  const mime = String(o['contentType'] ?? o['mimeType'] ?? '').toLowerCase();
  const typ = String(o['type'] ?? '').toLowerCase();
  if (mime.startsWith('audio/') || mime.includes('audio')) return true;
  if (typ.includes('audio') || typ.includes('voice')) return true;
  const u = String(o['url'] ?? o['fileUrl'] ?? '').toLowerCase();
  if (u && urlFilenameHintsAudio(u)) return true;
  return false;
}

/** True when attachments / media on any collected root suggests audio. */
export function ghlAttachmentsHintAudio(
  data: Record<string, unknown>,
  envelope?: Record<string, unknown>,
  workflowFlatRaw?: Record<string, unknown>,
): boolean {
  for (const node of collectGhlInboundMediaRootNodes(data, envelope, workflowFlatRaw)) {
    if (attachmentArrayHintsAudio(node['attachments'])) return true;
    if (mediaObjectHintsAudio(node['media'])) return true;
  }
  return false;
}

export function filenameExtensionHintsAudio(nameOrUrl: string): boolean {
  return /\.(m4a|mp3|wav|ogg|oga|aac|amr|webm|opus|aiff?)(\?|#|$)/i.test(nameOrUrl.toLowerCase());
}

export function urlFilenameHintsAudio(url: string): boolean {
  const lower = url.toLowerCase();
  return filenameExtensionHintsAudio(lower) || lower.includes('/audio/');
}

/**
 * Whether this inbound should be treated as voice/audio for server-side transcription.
 */
export function ghlInboundShouldTranscribeVoice(params: {
  messageType: 'text' | 'image' | 'audio' | 'video' | 'unknown';
  messageContent: string;
  audioMediaUrl: string | null;
  rawData: Record<string, unknown>;
  /** Full webhook envelope (top-level `messages`, etc.). */
  envelope?: Record<string, unknown>;
  /** Original GHL workflow-flat body — used for attachment/media hints. */
  workflowFlatRaw?: Record<string, unknown>;
}): boolean {
  const url = params.audioMediaUrl?.trim() || '';
  const body = String(params.messageContent ?? '').trim();
  const bodyEmpty = !body;
  const placeholder = ghlBodyIndicatesAudioPlaceholder(params.messageContent);

  if (params.messageType === 'audio') {
    return true;
  }

  if (placeholder && url) {
    return true;
  }

  if (!url) return false;

  if (params.messageType === 'image' || params.messageType === 'video') {
    return false;
  }

  if (ghlAttachmentsHintAudio(params.rawData, params.envelope, params.workflowFlatRaw)) {
    return true;
  }

  if (urlFilenameHintsAudio(url)) {
    return true;
  }

  if (bodyEmpty) {
    return urlFilenameHintsAudio(url);
  }

  return false;
}
