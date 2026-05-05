/**
 * GHL inbound `conversation_message_created` payloads vary by channel and version.
 * We collect likely audio attachment URLs from common shapes without coupling to one schema.
 */

function asNonEmptyString(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

function isHttpUrl(s: string): boolean {
  return /^https?:\/\//i.test(s);
}

/** True when attachments array suggests an audio file (mime, type, or filename). */
export function ghlAttachmentsHintAudio(data: Record<string, unknown>): boolean {
  const att = data['attachments'];
  if (!Array.isArray(att)) return false;
  for (const item of att) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const mime = String(o['contentType'] ?? o['mimeType'] ?? o['content_type'] ?? '').toLowerCase();
    const typ = String(o['type'] ?? o['messageType'] ?? '').toLowerCase();
    const name = String(o['name'] ?? o['filename'] ?? o['fileName'] ?? '').toLowerCase();
    if (mime.includes('audio')) return true;
    if (typ.includes('audio')) return true;
    if (/\.(m4a|mp3|wav|ogg|aac|amr|webm|opus|aiff?)(\?|$)/i.test(name)) return true;
  }
  return false;
}

export function urlFilenameHintsAudio(url: string): boolean {
  const lower = url.toLowerCase();
  return /\.(m4a|mp3|wav|ogg|aac|amr|webm|opus|aiff?)(\?|#|$)/i.test(lower) || lower.includes('/audio/');
}

/**
 * Best-effort media URL for voice / audio inbound messages.
 * Checks: attachments[].url, media.url, top-level mediaUrl/fileUrl, and message when it is a URL.
 */
export function extractGhlInboundAudioMediaUrl(data: Record<string, unknown>): string | null {
  for (const key of ['mediaUrl', 'fileUrl', 'attachmentUrl', 'audioUrl', 'mediaURL']) {
    const u = asNonEmptyString(data[key]);
    if (u && isHttpUrl(u)) return u;
  }

  const msg = asNonEmptyString(data['message']);
  if (msg && isHttpUrl(msg)) return msg;

  const att = data['attachments'];
  if (Array.isArray(att)) {
    for (const item of att) {
      if (!item || typeof item !== 'object') continue;
      const o = item as Record<string, unknown>;
      const u =
        asNonEmptyString(o['url']) ??
        asNonEmptyString(o['secureUrl']) ??
        asNonEmptyString(o['mediaUrl']) ??
        asNonEmptyString(o['fileUrl']);
      if (u && isHttpUrl(u)) return u;
    }
  }

  const media = data['media'];
  if (media && typeof media === 'object') {
    const o = media as Record<string, unknown>;
    const u = asNonEmptyString(o['url']) ?? asNonEmptyString(o['sourceUrl']) ?? asNonEmptyString(o['link']);
    if (u && isHttpUrl(u)) return u;
  }

  return null;
}

/**
 * Whether this inbound should be treated as voice/audio for server-side transcription.
 * - Explicit `audio` / `AudioMessage` (mapped before call).
 * - Empty text body with a media URL that looks like audio, or attachments that hint audio.
 */
export function ghlInboundShouldTranscribeVoice(params: {
  messageType: 'text' | 'image' | 'audio' | 'video' | 'unknown';
  messageContent: string;
  audioMediaUrl: string | null;
  rawData: Record<string, unknown>;
}): boolean {
  const bodyEmpty = !params.messageContent.trim();
  const url = params.audioMediaUrl?.trim() || '';

  if (params.messageType === 'audio') {
    return true;
  }

  if (!url || !bodyEmpty) return false;
  if (params.messageType === 'image' || params.messageType === 'video') return false;

  if (ghlAttachmentsHintAudio(params.rawData)) return true;
  if (urlFilenameHintsAudio(url)) return true;
  if (params.messageType === 'text' && urlFilenameHintsAudio(url)) return true;

  return false;
}
