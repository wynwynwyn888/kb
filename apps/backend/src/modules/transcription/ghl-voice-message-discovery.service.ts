/**
 * Phase 1C+: discover message id and direct media URL from GHL message history.
 */

import { Injectable, Logger } from '@nestjs/common';
import { getSupabaseService } from '../../lib/supabase';
import { decrypt } from '../../lib/encryption';
import {
  classifyGhlAudioPlaceholderBody,
  type GhlAudioPlaceholderKind,
} from '../webhooks/ghl-inbound-audio-media';
import { extractGhlMessageImageMediaUrlFromRow } from '../webhooks/ghl-inbound-image-media';

const LIST_TIMEOUT_MS = 35_000;
const MESSAGE_LIMIT = 40;
const URL_KEYS = [
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
const SHAPE_WALK_KEYS = ['messages', 'data', 'items', 'results', 'conversation'] as const;

function ghlApiBase(): string {
  return (
    process.env['GHL_API_BASE_URL']?.trim().replace(/\/$/, '') ||
    'https://services.leadconnectorhq.com'
  );
}

function readBoundedInt(key: string, fallback: number, min: number, max: number): number {
  const raw = process.env[key]?.trim();
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function asRecordArray(v: unknown): Record<string, unknown>[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is Record<string, unknown> => Boolean(asRecord(x)));
}

function firstNonEmptyString(values: unknown[]): string {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

function messageLikeRow(row: Record<string, unknown>): boolean {
  return [
    'id',
    'messageId',
    'message_id',
    'conversationMessageId',
    '_id',
    'body',
    'message',
    'text',
    'content',
    'type',
    'messageType',
    'contentType',
    'direction',
    'source',
    'attachments',
    'media',
    'dateAdded',
    'createdAt',
    'timestamp',
  ].some((k) => k in row);
}

function extractBody(row: Record<string, unknown>): string {
  const messageObj = asRecord(row['message']);
  const payloadObj = asRecord(row['payload']);
  return firstNonEmptyString([
    row['body'],
    row['message'],
    row['text'],
    row['content'],
    messageObj?.['body'],
    messageObj?.['text'],
    messageObj?.['content'],
    payloadObj?.['body'],
    payloadObj?.['message'],
  ]);
}

function hasAudioHintInString(v: string): boolean {
  const s = v.toLowerCase();
  return (
    s.includes('audio') ||
    s.includes('voice') ||
    s.includes('stark-media') ||
    s.includes('storage.googleapis.com') ||
    /\.(mp3|ogg|oga|m4a|wav|webm|aac|amr)(\?|#|$)/i.test(s)
  );
}

function safeUrlShape(raw: string): { host: string; pathLen: number } | null {
  if (!/^https?:\/\//i.test(raw)) return null;
  try {
    const u = new URL(raw);
    return { host: u.hostname, pathLen: u.pathname.length };
  } catch {
    return null;
  }
}

function redactedBodyPreview(v: string): string {
  return v
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[url]')
    .replace(/\bsk-[a-zA-Z0-9_-]{10,}\b/gi, '[token]')
    .slice(0, 120);
}

function resolveMessageRowId(row: Record<string, unknown>): string | null {
  const id =
    row['id'] ??
    row['messageId'] ??
    row['message_id'] ??
    row['conversationMessageId'] ??
    row['_id'];
  if (typeof id === 'string' && id.trim()) return id.trim();
  return null;
}

function directionSourceOf(row: Record<string, unknown>): string {
  return firstNonEmptyString([row['direction'], row['source'], row['from']]).toLowerCase();
}

function inboundLikeDirectionSource(s: string): boolean {
  return /(inbound|customer|contact|user|client)/i.test(s);
}

function attachmentSampleNodes(attachments: unknown, maxNodes: number): unknown[] {
  if (attachments == null) return [];
  if (Array.isArray(attachments)) return attachments.slice(0, maxNodes);
  const rec = asRecord(attachments);
  if (rec) return Object.values(rec).slice(0, maxNodes);
  return [];
}

function describeMediaAttachmentNodeShape(node: unknown): Record<string, unknown> {
  if (node === null || node === undefined) return { nodeType: 'null' };
  if (typeof node === 'string') {
    const http = /^https?:\/\//i.test(node);
    return {
      nodeType: 'string',
      stringLen: node.length,
      ...(http ? { urlShape: safeUrlShape(node) } : {}),
    };
  }
  if (Array.isArray(node)) {
    return { nodeType: 'array', arrayLen: node.length };
  }
  const r = asRecord(node);
  if (!r) return { nodeType: typeof node };
  const urlFieldShapes: Record<string, { host: string; pathLen: number } | null> = {};
  for (const key of URL_KEYS) {
    const v = r[key];
    if (typeof v === 'string' && /^https?:\/\//i.test(v)) {
      urlFieldShapes[String(key)] = safeUrlShape(v);
    }
  }
  const mimeRaw = r['mimeType'] ?? r['contentType'];
  const nameRaw = r['fileName'] ?? r['filename'] ?? r['name'];
  let extOnly: string | undefined;
  if (typeof nameRaw === 'string' && nameRaw.includes('.')) {
    const m = /\.([a-z0-9]+)$/i.exec(nameRaw);
    extOnly = m?.[1]?.toLowerCase();
  }
  return {
    nodeType: 'object',
    keySample: Object.keys(r).slice(0, 20),
    ...(Object.keys(urlFieldShapes).length ? { urlFieldShapes } : {}),
    ...(mimeRaw != null && String(mimeRaw).trim()
      ? { mimeTypePresent: true, mimeTypeShort: String(mimeRaw).slice(0, 40) }
      : { mimeTypePresent: false }),
    ...(typeof nameRaw === 'string' && nameRaw.trim()
      ? { filenamePresent: true, ...(extOnly ? { filenameExtOnly: extOnly } : {}) }
      : { filenamePresent: false }),
  };
}

function attachmentShapeSamples(attachments: unknown): Record<string, unknown>[] {
  return attachmentSampleNodes(attachments, 3).map(describeMediaAttachmentNodeShape);
}

function mediaShapeSamples(media: unknown): Record<string, unknown>[] {
  if (media == null) return [];
  if (Array.isArray(media)) {
    return media.slice(0, 3).map(describeMediaAttachmentNodeShape);
  }
  const r = asRecord(media);
  if (r) return Object.values(r).slice(0, 3).map(describeMediaAttachmentNodeShape);
  return [describeMediaAttachmentNodeShape(media)];
}

function attachmentMediaStats(row: Record<string, unknown>): {
  hasAttachments: boolean;
  attachmentCount: number;
  hasMedia: boolean;
  mediaKeyNodeCount: number;
  hasAudioHint: boolean;
} {
  const attachments = row['attachments'];
  const media = row['media'];
  let hasAttachments = false;
  let attachmentCount = 0;
  let hasMedia = false;
  let mediaKeyNodeCount = 0;
  let hasAudioHint = false;

  const inspectNode = (node: Record<string, unknown>) => {
    const mime = String(node['contentType'] ?? node['mimeType'] ?? '').toLowerCase();
    const name = String(node['name'] ?? node['filename'] ?? node['fileName'] ?? '');
    const direct = firstNonEmptyString(URL_KEYS.map((k) => node[k]));
    if (mime.startsWith('audio/') || hasAudioHintInString(name) || hasAudioHintInString(direct)) {
      hasAudioHint = true;
    }
  };

  if (attachments != null) {
    hasAttachments = true;
    if (Array.isArray(attachments)) {
      attachmentCount = attachments.length;
      for (const item of attachments) {
        const r = asRecord(item);
        if (r) inspectNode(r);
      }
    } else {
      const r = asRecord(attachments);
      if (r) {
        attachmentCount = Object.keys(r).length;
        for (const v of Object.values(r)) {
          const rec = asRecord(v);
          if (rec) inspectNode(rec);
        }
      } else if (typeof attachments === 'string') {
        attachmentCount = 1;
        if (hasAudioHintInString(attachments)) hasAudioHint = true;
      }
    }
  }

  if (media != null) {
    hasMedia = true;
    if (Array.isArray(media)) {
      mediaKeyNodeCount = media.length;
      for (const item of media) {
        const r = asRecord(item);
        if (r) inspectNode(r);
      }
    } else {
      const r = asRecord(media);
      if (r) {
        mediaKeyNodeCount = Object.keys(r).length > 0 ? 1 : 0;
        inspectNode(r);
      } else if (typeof media === 'string') {
        mediaKeyNodeCount = 1;
        if (hasAudioHintInString(media)) hasAudioHint = true;
      }
    }
  }

  return { hasAttachments, attachmentCount, hasMedia, mediaKeyNodeCount, hasAudioHint };
}

function audioUrlHasAudioExtension(url: string): boolean {
  const lower = url.toLowerCase();
  return /\.(mp3|ogg|oga|m4a|wav|webm|aac|amr)(\?|#|$)/i.test(lower);
}

function audioUrlStarkMediaHint(url: string): boolean {
  try {
    return new URL(url).pathname.toLowerCase().includes('stark-media');
  } catch {
    return url.toLowerCase().includes('stark-media');
  }
}

function mimeAndFilenameFromParent(parent: Record<string, unknown> | undefined): {
  mime: string;
  fileName: string;
} {
  const mime = String(parent?.['contentType'] ?? parent?.['mimeType'] ?? '').toLowerCase();
  const fileName = String(parent?.['fileName'] ?? parent?.['filename'] ?? parent?.['name'] ?? '').toLowerCase();
  return { mime, fileName };
}

/** Strict: non-placeholder rows — require audio signals on URL or parent metadata. */
function strictAudioUrlAcceptable(url: string, parent: Record<string, unknown> | undefined): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  const { mime, fileName } = mimeAndFilenameFromParent(parent);
  if (mime.startsWith('audio/')) return true;
  if (audioUrlHasAudioExtension(url)) return true;
  if (audioUrlHasAudioExtension(fileName)) return true;
  return audioUrlStarkMediaHint(url);
}

function placeholderRowUrlAcceptable(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

const NESTED_URL_CONTAINERS = [
  'file',
  'media',
  'attachment',
  'download',
  'metadata',
  'data',
  'value',
] as const;

function collectMediaSubtreeRoots(message: Record<string, unknown>): unknown[] {
  const roots: unknown[] = [];
  const push = (v: unknown) => {
    if (v === null || v === undefined) return;
    roots.push(v);
  };

  push(message['attachments']);
  push(message['media']);
  push(message['files']);

  const nested = [asRecord(message['message']), asRecord(message['payload']), asRecord(message['customData']), asRecord(message['data'])];
  for (const r of nested) {
    if (!r) continue;
    push(r['attachments']);
    push(r['media']);
    push(r['files']);
  }
  return roots;
}

function dfsMediaSubtree(
  node: unknown,
  depth: number,
  seen: WeakSet<object>,
  parentObject: Record<string, unknown> | undefined,
  placeholderRelaxed: boolean,
): { url: string | null; visitedNodes: number } {
  if (depth < 0 || node === null || node === undefined) return { url: null, visitedNodes: 0 };

  if (typeof node === 'string') {
    const ok = placeholderRelaxed ? placeholderRowUrlAcceptable(node) : strictAudioUrlAcceptable(node, parentObject);
    return ok ? { url: node, visitedNodes: 1 } : { url: null, visitedNodes: 1 };
  }

  if (typeof node !== 'object') return { url: null, visitedNodes: 1 };

  if (seen.has(node as object)) return { url: null, visitedNodes: 0 };
  seen.add(node as object);

  let visited = 1;

  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = dfsMediaSubtree(item, depth - 1, seen, parentObject, placeholderRelaxed);
      visited += hit.visitedNodes;
      if (hit.url) return { url: hit.url, visitedNodes: visited };
    }
    return { url: null, visitedNodes: visited };
  }

  const rec = node as Record<string, unknown>;

  for (const nk of NESTED_URL_CONTAINERS) {
    if (!(nk in rec)) continue;
    const hit = dfsMediaSubtree(rec[nk], depth - 1, seen, rec, placeholderRelaxed);
    visited += hit.visitedNodes;
    if (hit.url) return { url: hit.url, visitedNodes: visited };
  }

  for (const key of URL_KEYS) {
    if (!(key in rec)) continue;
    const raw = rec[key];
    if (typeof raw === 'string' && raw.trim()) {
      const v = raw.trim();
      const ok = placeholderRelaxed ? placeholderRowUrlAcceptable(v) : strictAudioUrlAcceptable(v, rec);
      if (ok) return { url: v, visitedNodes: visited };
    }
  }

  const keyList = Object.keys(rec);
  keyList.sort((a, b) => a.localeCompare(b));
  for (const key of keyList) {
    if ((NESTED_URL_CONTAINERS as readonly string[]).includes(key)) continue;
    if ((URL_KEYS as readonly string[]).includes(key)) continue;
    const hit = dfsMediaSubtree(rec[key], depth - 1, seen, rec, placeholderRelaxed);
    visited += hit.visitedNodes;
    if (hit.url) return { url: hit.url, visitedNodes: visited };
  }

  return { url: null, visitedNodes: visited };
}

export function extractGhlMessageAudioMediaUrl(
  message: Record<string, unknown>,
  bodyPlaceholderKind?: GhlAudioPlaceholderKind,
): {
  audioMediaUrl: string | null;
  audioMediaUrlShape: { host: string; pathLen: number } | null;
  mediaKeyNodeCount: number;
  attachmentUrlFound: boolean;
} {
  const relaxed = bodyPlaceholderKind === 'AUDIO' || bodyPlaceholderKind === 'VOICE';

  const seen = new WeakSet<object>();

  let attachmentUrlFound = false;
  let bestUrl: string | null = null;
  let visitedTotal = 0;

  for (const root of collectMediaSubtreeRoots(message)) {
    const hit = dfsMediaSubtree(root, 8, seen, undefined, relaxed);
    visitedTotal += hit.visitedNodes;
    if (hit.url) {
      bestUrl = hit.url;
      attachmentUrlFound = true;
      break;
    }
  }

  if (!bestUrl) {
    for (const key of URL_KEYS) {
      const raw = message[key];
      if (typeof raw !== 'string' || !raw.trim()) continue;
      const v = raw.trim();
      const ok = relaxed ? placeholderRowUrlAcceptable(v) : strictAudioUrlAcceptable(v, message);
      if (ok) {
        bestUrl = v;
        attachmentUrlFound = false;
        break;
      }
    }
  }

  const mediaKeyNodeCount = Math.max(1, visitedTotal);
  return {
    audioMediaUrl: bestUrl,
    audioMediaUrlShape: bestUrl ? safeUrlShape(bestUrl) : null,
    mediaKeyNodeCount,
    attachmentUrlFound,
  };
}

type CandidateReason =
  | 'placeholder_attachment_url'
  | 'inbound_audio_type_with_direct_url'
  | 'inbound_with_direct_audio_url'
  | 'inbound_placeholder_audio_or_voice'
  | 'inbound_audio_type'
  | 'latest_direct_audio_url_no_direction';

type RankedCandidate = {
  row: Record<string, unknown>;
  reason: CandidateReason;
  score: number;
  audioMediaUrl: string | null;
  attachmentUrlFound: boolean;
};

function scoreCandidateReason(reason: CandidateReason): number {
  if (reason === 'placeholder_attachment_url') return 500;
  if (reason === 'inbound_audio_type_with_direct_url') return 400;
  if (reason === 'inbound_with_direct_audio_url') return 390;
  if (reason === 'inbound_placeholder_audio_or_voice') return 300;
  if (reason === 'inbound_audio_type') return 200;
  return 100;
}

function candidateFromRow(row: Record<string, unknown>): RankedCandidate | null {
  const body = extractBody(row);
  const bodyKind = classifyGhlAudioPlaceholderBody(body);
  const directionSource = directionSourceOf(row);
  const inboundLike = inboundLikeDirectionSource(directionSource);
  const ph = bodyKind === 'AUDIO' || bodyKind === 'VOICE';
  const typeBundle = [
    String(row['type'] ?? ''),
    String(row['messageType'] ?? ''),
    String(row['contentType'] ?? ''),
    String(row['source'] ?? ''),
  ].join(' ');
  const typeAudio = /voice|audio|VoiceMessage|AudioMessage/i.test(typeBundle);
  const stats = attachmentMediaStats(row);
  const extracted = extractGhlMessageAudioMediaUrl(row, bodyKind);
  const directUrl = extracted.audioMediaUrl;

  const attFound = extracted.attachmentUrlFound;

  if (inboundLike && directUrl && ph) {
    return {
      row,
      reason: 'placeholder_attachment_url',
      score: scoreCandidateReason('placeholder_attachment_url'),
      audioMediaUrl: directUrl,
      attachmentUrlFound: attFound,
    };
  }
  if (inboundLike && directUrl && (typeAudio || stats.hasAudioHint)) {
    return {
      row,
      reason: 'inbound_audio_type_with_direct_url',
      score: scoreCandidateReason('inbound_audio_type_with_direct_url'),
      audioMediaUrl: directUrl,
      attachmentUrlFound: attFound,
    };
  }
  if (inboundLike && directUrl) {
    return {
      row,
      reason: 'inbound_with_direct_audio_url',
      score: scoreCandidateReason('inbound_with_direct_audio_url'),
      audioMediaUrl: directUrl,
      attachmentUrlFound: attFound,
    };
  }
  if (inboundLike && ph) {
    return {
      row,
      reason: 'inbound_placeholder_audio_or_voice',
      score: scoreCandidateReason('inbound_placeholder_audio_or_voice'),
      audioMediaUrl: directUrl,
      attachmentUrlFound: attFound,
    };
  }
  if (inboundLike && (typeAudio || stats.hasAudioHint || directUrl)) {
    return {
      row,
      reason: 'inbound_audio_type',
      score: scoreCandidateReason('inbound_audio_type'),
      audioMediaUrl: directUrl,
      attachmentUrlFound: attFound,
    };
  }
  if (!inboundLike && directUrl) {
    return {
      row,
      reason: 'latest_direct_audio_url_no_direction',
      score: scoreCandidateReason('latest_direct_audio_url_no_direction'),
      audioMediaUrl: directUrl,
      attachmentUrlFound: attFound,
    };
  }
  return null;
}

function timestampMsForRow(row: Record<string, unknown>): number {
  const raw = firstNonEmptyString([row['dateAdded'], row['createdAt'], row['timestamp']]);
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function compareCandidates(a: RankedCandidate, b: RankedCandidate, webhookMs: number): number {
  if (b.score !== a.score) return b.score - a.score;
  const ta = timestampMsForRow(a.row);
  const tb = timestampMsForRow(b.row);
  if (tb !== ta) return tb - ta;
  const da = Math.abs(ta - webhookMs);
  const db = Math.abs(tb - webhookMs);
  return da - db;
}

type ImageRankedCandidate = {
  row: Record<string, unknown>;
  score: number;
  imageMediaUrl: string;
};

function imageCandidateFromRow(row: Record<string, unknown>): ImageRankedCandidate | null {
  const imageMediaUrl = extractGhlMessageImageMediaUrlFromRow(row);
  if (!imageMediaUrl) return null;
  const directionSource = directionSourceOf(row);
  const inboundLike = inboundLikeDirectionSource(directionSource);
  let score = inboundLike ? 300 : 100;
  const body = extractBody(row);
  if (/image|photo|picture|ImageMessage/i.test(body)) score += 50;
  const typeBundle = [
    String(row['type'] ?? ''),
    String(row['messageType'] ?? ''),
    String(row['contentType'] ?? ''),
  ].join(' ');
  if (/image|photo|picture|ImageMessage/i.test(typeBundle)) score += 80;
  return { row, score, imageMediaUrl };
}

function compareImageCandidates(a: ImageRankedCandidate, b: ImageRankedCandidate, webhookMs: number): number {
  if (b.score !== a.score) return b.score - a.score;
  const ta = timestampMsForRow(a.row);
  const tb = timestampMsForRow(b.row);
  if (tb !== ta) return tb - ta;
  return Math.abs(ta - webhookMs) - Math.abs(tb - webhookMs);
}

function safeMessageSample(row: Record<string, unknown>, index: number): Record<string, unknown> {
  const id = resolveMessageRowId(row);
  const body = extractBody(row);
  const bodyKind = classifyGhlAudioPlaceholderBody(body);
  const stats = attachmentMediaStats(row);
  const extracted = extractGhlMessageAudioMediaUrl(row, bodyKind);
  const dateAdded = firstNonEmptyString([row['dateAdded'], row['createdAt'], row['timestamp']]);
  return {
    index,
    idPresent: Boolean(id),
    idLen: id ? id.length : undefined,
    direction: firstNonEmptyString([row['direction']]),
    source: firstNonEmptyString([row['source']]),
    type: firstNonEmptyString([row['type']]),
    messageType: firstNonEmptyString([row['messageType']]),
    contentType: firstNonEmptyString([row['contentType']]),
    keySample: Object.keys(row).slice(0, 20),
    bodyShape: {
      length: body.length,
      startsWithCharCode: body.length ? body.charCodeAt(0) : 0,
      endsWithCharCode: body.length ? body.charCodeAt(body.length - 1) : 0,
      normalizedPreview: redactedBodyPreview(body),
      bodyPlaceholderKind: bodyKind,
    },
    hasAttachments: stats.hasAttachments,
    attachmentCount: stats.attachmentCount,
    hasMedia: stats.hasMedia,
    mediaKeyNodeCount: extracted.mediaKeyNodeCount,
    audioMediaUrlShape: extracted.audioMediaUrlShape,
    attachmentShapeSample: attachmentShapeSamples(row['attachments']),
    mediaShapeSample: mediaShapeSamples(row['media']),
    dateAdded: dateAdded ? dateAdded.slice(0, 25) : undefined,
  };
}

type ExtractResult = {
  rows: Record<string, unknown>[];
  detectedCollectionPath: string;
  nestedArrayCandidatePaths: string[];
};

function extractMessagesArray(payload: unknown): ExtractResult {
  const root = asRecord(payload);
  if (!root) return { rows: [], detectedCollectionPath: 'none', nestedArrayCandidatePaths: [] };

  const pathCandidates: Array<{ path: string; value: unknown }> = [
    { path: 'messages', value: root['messages'] },
    { path: 'messages.messages', value: asRecord(root['messages'])?.['messages'] },
    { path: 'messages.data', value: asRecord(root['messages'])?.['data'] },
    { path: 'messages.items', value: asRecord(root['messages'])?.['items'] },
    { path: 'messages.results', value: asRecord(root['messages'])?.['results'] },
    { path: 'data.messages', value: asRecord(root['data'])?.['messages'] },
    { path: 'data.messages.messages', value: asRecord(asRecord(root['data'])?.['messages'])?.['messages'] },
    { path: 'data.messages.items', value: asRecord(asRecord(root['data'])?.['messages'])?.['items'] },
    { path: 'data.messages.data', value: asRecord(asRecord(root['data'])?.['messages'])?.['data'] },
    { path: 'data.messages.results', value: asRecord(asRecord(root['data'])?.['messages'])?.['results'] },
    { path: 'data.conversation.messages', value: asRecord(asRecord(root['data'])?.['conversation'])?.['messages'] },
    { path: 'conversation.messages', value: asRecord(root['conversation'])?.['messages'] },
    { path: 'items', value: root['items'] },
    { path: 'results', value: root['results'] },
  ];

  for (const p of pathCandidates) {
    const rows = asRecordArray(p.value).filter(messageLikeRow);
    if (rows.length > 0) {
      return { rows, detectedCollectionPath: p.path, nestedArrayCandidatePaths: [p.path] };
    }
  }

  const nestedPaths: string[] = [];
  const visited = new WeakSet<object>();
  const walk = (node: unknown, path: string, depth: number): Record<string, unknown>[] => {
    if (depth > 4 || !node || typeof node !== 'object') return [];
    if (visited.has(node as object)) return [];
    visited.add(node as object);
    if (Array.isArray(node)) {
      const rows = asRecordArray(node).filter(messageLikeRow);
      if (rows.length > 0) {
        nestedPaths.push(path);
        return rows;
      }
      return [];
    }
    const rec = node as Record<string, unknown>;
    for (const key of SHAPE_WALK_KEYS) {
      if (!(key in rec)) continue;
      const child = rec[key];
      const childPath = path ? `${path}.${key}` : key;
      const rows = walk(child, childPath, depth + 1);
      if (rows.length > 0) return rows;
    }
    return [];
  };

  const rows = walk(root, '', 0);
  return {
    rows,
    detectedCollectionPath: nestedPaths[0] ?? 'none',
    nestedArrayCandidatePaths: nestedPaths.slice(0, 10),
  };
}

@Injectable()
export class GhlVoiceMessageDiscoveryService {
  private readonly logger = new Logger(GhlVoiceMessageDiscoveryService.name);
  private readonly supabase = getSupabaseService();

  async discoverVoicePlaceholderMessageId(params: {
    tenantId: string;
    locationId: string;
    conversationId: string;
    webhookTimestampIso: string;
    placeholderKind: 'AUDIO' | 'VOICE';
  }): Promise<
    | {
        ok: true;
        messageId: string;
        audioMediaUrl?: string;
        detectedCollectionPath: string;
        attachmentUrlFound?: boolean;
        audioMediaUrlShape?: { host: string; pathLen: number } | null;
        debugLatestMessageSamples?: Record<string, unknown>[];
        candidateReason: string;
        candidateCount: number;
      }
    | { ok: false; reason: string; candidateCount?: number }
  > {
    const delayMs = readBoundedInt('GHL_VOICE_DISCOVER_DELAY_MS', 1500, 0, 120_000);
    const maxAttempts = readBoundedInt('GHL_VOICE_DISCOVER_MAX_ATTEMPTS', 2, 1, 6);
    const webhookMs = Date.parse(params.webhookTimestampIso) || Date.now();

    this.logger.log(
      JSON.stringify({
        voiceMessageDiscoveryStarted: true,
        tenantId: params.tenantId,
        conversationIdLen: params.conversationId.trim().length,
        placeholderKind: params.placeholderKind,
        delayMs,
        maxAttempts,
      }),
    );

    await sleep(delayMs);

    const tokenResult = await this.resolveAccessToken(params.tenantId, params.locationId);
    if (!tokenResult.ok) {
      this.logger.warn(
        JSON.stringify({
          voiceMessageDiscoveryFailed: true,
          reason: tokenResult.reason,
          discoveredMessageIdPresent: false,
          candidateCount: 0,
        }),
      );
      return { ok: false, reason: tokenResult.reason, candidateCount: 0 };
    }

    let lastCandidateCount = 0;
    const debugShapesEnabled = process.env['GHL_VOICE_DEBUG_SHAPES'] === 'true';
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (attempt > 1) await sleep(delayMs);
      const listResult = await this.tryListMessages({
        baseUrl: ghlApiBase(),
        token: tokenResult.token,
        conversationId: params.conversationId,
      });

      if (!listResult.ok) {
        this.logger.warn(
          JSON.stringify({
            voiceMessageDiscoveryAttempt: true,
            attempt,
            httpStatus: listResult.httpStatus,
            candidateCount: 0,
          }),
        );
        if (attempt === maxAttempts) {
          this.logger.warn(
            JSON.stringify({
              voiceMessageDiscoveryFailed: true,
              reason: listResult.reason,
              discoveredMessageIdPresent: false,
              candidateCount: 0,
            }),
          );
          return { ok: false, reason: listResult.reason, candidateCount: 0 };
        }
        continue;
      }

      const top = asRecord(listResult.json) ?? {};
      const messagesNode = top['messages'];
      const extracted = extractMessagesArray(listResult.json);
      const rows = extracted.rows;
      const inboundCount = rows.filter((r) => inboundLikeDirectionSource(directionSourceOf(r))).length;
      const candidates = rows
        .map((r) => candidateFromRow(r))
        .filter((c): c is RankedCandidate => Boolean(c));
      lastCandidateCount = candidates.length;

      const directUrlPresentInCandidates = candidates.some((c) => Boolean(c.audioMediaUrl));
      const shouldLogLatestSamples =
        debugShapesEnabled || !directUrlPresentInCandidates || lastCandidateCount === 0;

      this.logger.log(
        JSON.stringify({
          voiceMessageDiscoveryAttempt: true,
          attempt,
          responseTopLevelKeys: Object.keys(top).slice(0, 30),
          messagesNodeType: messagesNode == null ? 'null' : Array.isArray(messagesNode) ? 'array' : typeof messagesNode,
          messagesNodeKeys: asRecord(messagesNode) ? Object.keys(asRecord(messagesNode)!).slice(0, 20) : [],
          messagesNodeArrayLength: Array.isArray(messagesNode) ? messagesNode.length : undefined,
          nestedArrayCandidatePaths: extracted.nestedArrayCandidatePaths.slice(0, 10),
          detectedCollectionPath: extracted.detectedCollectionPath,
          rawItemCount: rows.length,
          candidateCount: lastCandidateCount,
          directAudioMediaUrlPresent: directUrlPresentInCandidates,
          ...(shouldLogLatestSamples
            ? { latestMessageSamples: rows.slice(0, 5).map((r, i) => safeMessageSample(r, i)) }
            : {}),
        }),
      );

      if (lastCandidateCount === 0 && inboundCount > 0) {
        this.logger.warn(
          JSON.stringify({
            voiceMessageDiscoveryNoAudioCandidateButRecentInbound: true,
            recentInboundCount: inboundCount,
          }),
        );
      }

      candidates.sort((a, b) => compareCandidates(a, b, webhookMs));
      const best = candidates[0] ?? null;
      if (best) {
        const id = resolveMessageRowId(best.row);
        const direct = best.audioMediaUrl;
        const bodyKind = classifyGhlAudioPlaceholderBody(extractBody(best.row));
        const winExtract = extractGhlMessageAudioMediaUrl(best.row, bodyKind);
        if (direct) {
          this.logger.log(
            JSON.stringify({
              voiceMessageDiscoveryDirectMediaUrlFound: true,
              audioMediaUrlShape: safeUrlShape(direct),
              messageIdPresent: Boolean(id),
              candidateReason: best.reason,
              attachmentUrlFound: winExtract.attachmentUrlFound,
            }),
          );
        }
        this.logger.log(
          JSON.stringify({
            voiceMessageDiscoverySucceeded: true,
            discoveredMessageIdPresent: Boolean(id),
            directAudioMediaUrlPresent: Boolean(direct),
            candidateReason: best.reason,
            attachmentUrlFound: direct ? winExtract.attachmentUrlFound : false,
            ...(winExtract.audioMediaUrlShape ? { audioMediaUrlShape: winExtract.audioMediaUrlShape } : {}),
            detectedCollectionPath: extracted.detectedCollectionPath,
            candidateCount: lastCandidateCount,
          }),
        );
        if (id || direct) {
          const debugLatestMessageSamples =
            direct ? rows.slice(0, 5).map((r, i) => safeMessageSample(r, i)) : undefined;
          return {
            ok: true,
            messageId: id ?? '',
            audioMediaUrl: direct ?? undefined,
            detectedCollectionPath: extracted.detectedCollectionPath,
            attachmentUrlFound: direct ? winExtract.attachmentUrlFound : false,
            audioMediaUrlShape: direct ? winExtract.audioMediaUrlShape : null,
            debugLatestMessageSamples,
            candidateReason: best.reason,
            candidateCount: lastCandidateCount,
          };
        }
      }

      if (attempt === maxAttempts) {
        const reason = rows.length > 0 ? 'audio_media_url_not_found' : 'message_id_not_found';
        this.logger.warn(
          JSON.stringify({
            voiceMessageDiscoveryFailed: true,
            reason,
            discoveredMessageIdPresent: false,
            candidateCount: lastCandidateCount,
          }),
        );
        return { ok: false, reason, candidateCount: lastCandidateCount };
      }
    }

    return { ok: false, reason: 'message_id_not_found', candidateCount: lastCandidateCount };
  }

  /** Discover inbound photo URL from GHL message history when webhooks omit attachments. */
  async discoverInboundImageMediaUrl(params: {
    tenantId: string;
    locationId: string;
    /** Real GHL conversation id — optional when preferredMessageId is set. */
    conversationId?: string;
    webhookTimestampIso: string;
    preferredMessageId?: string;
  }): Promise<
    | { ok: true; imageMediaUrl: string; messageId?: string; candidateCount: number }
    | { ok: false; reason: string; candidateCount?: number }
  > {
    const delayMs = readBoundedInt('GHL_IMAGE_DISCOVER_DELAY_MS', 1500, 0, 120_000);
    const maxAttempts = readBoundedInt('GHL_IMAGE_DISCOVER_MAX_ATTEMPTS', 2, 1, 6);
    const webhookMs = Date.parse(params.webhookTimestampIso) || Date.now();
    const preferredId = params.preferredMessageId?.trim();
    const conversationId = params.conversationId?.trim() ?? '';

    this.logger.log(
      JSON.stringify({
        imageMessageDiscoveryStarted: true,
        tenantId: params.tenantId,
        conversationIdLen: conversationId.length,
        delayMs,
        maxAttempts,
        preferredMessageIdPresent: Boolean(preferredId),
      }),
    );

    await sleep(delayMs);

    const tokenResult = await this.resolveAccessToken(params.tenantId, params.locationId);
    if (!tokenResult.ok) {
      return { ok: false, reason: tokenResult.reason, candidateCount: 0 };
    }

    if (preferredId) {
      const row = await this.tryFetchMessageById({
        baseUrl: ghlApiBase(),
        token: tokenResult.token,
        messageId: preferredId,
      });
      if (row) {
        const url = extractGhlMessageImageMediaUrlFromRow(row);
        if (url) {
          return { ok: true, imageMediaUrl: url, messageId: preferredId, candidateCount: 1 };
        }
      }
    }

    if (!conversationId) {
      return { ok: false, reason: 'no_conversation_id', candidateCount: 0 };
    }

    let lastCandidateCount = 0;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (attempt > 1) await sleep(delayMs);
      const listResult = await this.tryListMessages({
        baseUrl: ghlApiBase(),
        token: tokenResult.token,
        conversationId,
      });
      if (!listResult.ok) {
        if (attempt === maxAttempts) {
          return { ok: false, reason: listResult.reason, candidateCount: 0 };
        }
        continue;
      }

      const extracted = extractMessagesArray(listResult.json);
      const rows = extracted.rows;

      if (preferredId) {
        const match = rows.find(r => resolveMessageRowId(r) === preferredId);
        if (match) {
          const url = extractGhlMessageImageMediaUrlFromRow(match);
          if (url) {
            return {
              ok: true,
              imageMediaUrl: url,
              messageId: preferredId,
              candidateCount: 1,
            };
          }
        }
      }

      const candidates = rows
        .map(r => imageCandidateFromRow(r))
        .filter((c): c is ImageRankedCandidate => Boolean(c));
      lastCandidateCount = candidates.length;
      candidates.sort((a, b) => compareImageCandidates(a, b, webhookMs));
      const best = candidates[0];
      if (best) {
        const id = resolveMessageRowId(best.row);
        this.logger.log(
          JSON.stringify({
            imageMessageDiscoverySucceeded: true,
            messageIdPresent: Boolean(id),
            candidateCount: lastCandidateCount,
            detectedCollectionPath: extracted.detectedCollectionPath,
          }),
        );
        return {
          ok: true,
          imageMediaUrl: best.imageMediaUrl,
          messageId: id || undefined,
          candidateCount: lastCandidateCount,
        };
      }

      if (attempt === maxAttempts) {
        return {
          ok: false,
          reason: rows.length > 0 ? 'image_media_url_not_found' : 'message_id_not_found',
          candidateCount: lastCandidateCount,
        };
      }
    }

    return { ok: false, reason: 'image_media_url_not_found', candidateCount: lastCandidateCount };
  }

  private async resolveAccessToken(
    tenantId: string,
    locationId: string,
  ): Promise<{ ok: true; token: string } | { ok: false; reason: string }> {
    const { data } = await this.supabase
      .from('tenant_ghl_connections')
      .select('private_token_encrypted')
      .eq('tenant_id', tenantId)
      .eq('ghl_location_id', locationId)
      .eq('status', 'CONNECTED')
      .single();
    if (!data) return { ok: false, reason: 'no_ghl_credentials' };
    try {
      return { ok: true, token: decrypt(String(data['private_token_encrypted'])) };
    } catch {
      return { ok: false, reason: 'token_decrypt_failed' };
    }
  }

  private async tryFetchMessageById(params: {
    baseUrl: string;
    token: string;
    messageId: string;
  }): Promise<Record<string, unknown> | null> {
    const url = `${params.baseUrl}/conversations/messages/${encodeURIComponent(params.messageId.trim())}`;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), LIST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${params.token}`,
          Version: '2021-07-28',
          Accept: 'application/json',
        },
        signal: ac.signal,
      });
      if (!res.ok) return null;
      const json = (await res.json()) as unknown;
      const root = asRecord(json);
      if (!root) return null;
      const nested = asRecord(root['message']) ?? asRecord(root['data']);
      return nested ?? root;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private async tryListMessages(params: {
    baseUrl: string;
    token: string;
    conversationId: string;
  }): Promise<
    | { ok: true; json: unknown }
    | { ok: false; reason: string; httpStatus?: number }
  > {
    const url = `${params.baseUrl}/conversations/${encodeURIComponent(
      params.conversationId.trim(),
    )}/messages?limit=${MESSAGE_LIMIT}`;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), LIST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${params.token}`,
          Version: '2021-07-28',
          Accept: 'application/json',
        },
        signal: ac.signal,
      });
      if (!res.ok) return { ok: false, reason: `http_${res.status}`, httpStatus: res.status };
      let json: unknown;
      try {
        json = (await res.json()) as unknown;
      } catch {
        return { ok: false, reason: 'invalid_json' };
      }
      return { ok: true, json };
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'fetch_error';
      return { ok: false, reason: msg.includes('aborted') ? 'timeout' : 'fetch_failed' };
    } finally {
      clearTimeout(timer);
    }
  }
}
