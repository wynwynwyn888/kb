/**
 * Map GHL inbound webhook fields to our DB `conversations.channel` enum
 * and to `@aisbp/ghl-client` outbound send channel keys.
 *
 * GHL often sends `data.channel: "SMS"` for Facebook Messenger inbound; use
 * `messageType`, meta (`fb` / `ig`), and contact hints before trusting `channel`.
 */
import type { OutboundChannel } from '@aisbp/ghl-client';

/** Values stored on `conversations.channel` (Postgres enum). */
export type ConversationDbChannel = 'WHATSAPP' | 'SMS' | 'CHAT' | 'EMAIL';

export interface NormalizedGhlChannel {
  /** Raw webhook `data.channel` when present. */
  raw: string | null;
  /** Lowercase identity segment for `aisbp:conv:<channel>:...` keys. */
  identityChannel: string;
  dbChannel: ConversationDbChannel;
  outboundChannel: OutboundChannel;
  /** Why we chose this mapping (for logs). */
  source: string;
}

export interface GhlInboundChannelHints {
  channelRaw?: string | null;
  messageTypeRaw?: string | null;
  data?: Record<string, unknown> | null;
  workflowFlatRaw?: Record<string, unknown> | null;
  contactPhone?: string | null;
}

function compact(raw: string | null | undefined): string {
  return (raw ?? '').trim().toLowerCase().replace(/\s+/g, '_');
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function hasFbMeta(row: Record<string, unknown> | null | undefined): boolean {
  if (!row) return false;
  if (row['fb'] != null || row['facebook'] != null) return true;
  const meta = row['meta'];
  if (!isPlainObject(meta)) return false;
  return meta['fb'] != null || meta['facebook'] != null;
}

function hasIgMeta(row: Record<string, unknown> | null | undefined): boolean {
  if (!row) return false;
  if (row['ig'] != null || row['instagram'] != null) return true;
  const meta = row['meta'];
  if (!isPlainObject(meta)) return false;
  return meta['ig'] != null || meta['instagram'] != null;
}

const CHANNEL_HINT_FIELD_KEYS = [
  'channel',
  'source',
  'messageSource',
  'message_source',
  'conversationProvider',
  'conversation_provider',
  'provider',
  'type',
  'attributionSource',
  'attribution_source',
] as const;

function hasNonEmptyId(row: Record<string, unknown>, keys: string[]): boolean {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === 'string' && v.trim()) return true;
    if (typeof v === 'number' && Number.isFinite(v)) return true;
  }
  return false;
}

/** GHL contact rows often expose only one Meta id — use that to disambiguate SMS-labeled DMs. */
function inferFromContactSocialIds(
  data?: Record<string, unknown> | null,
  workflowFlatRaw?: Record<string, unknown> | null,
): NormalizedGhlChannel | null {
  const blocks: Record<string, unknown>[] = [];
  if (isPlainObject(data)) blocks.push(data);
  if (workflowFlatRaw) {
    const contact = workflowFlatRaw['contact'];
    if (isPlainObject(contact)) blocks.push(contact);
    const cd = workflowFlatRaw['customData'];
    if (isPlainObject(cd)) {
      const nested = cd['contact'];
      if (isPlainObject(nested)) blocks.push(nested);
    }
  }

  let hasIg = false;
  let hasFb = false;
  for (const row of blocks) {
    if (hasNonEmptyId(row, ['instagramId', 'instagram_id', 'igId', 'ig_id'])) hasIg = true;
    if (hasNonEmptyId(row, ['facebookId', 'facebook_id', 'fbId', 'fb_id', 'messengerId', 'messenger_id'])) {
      hasFb = true;
    }
  }

  if (hasIg && !hasFb) {
    return {
      raw: null,
      identityChannel: 'instagram',
      dbChannel: 'CHAT',
      outboundChannel: 'INSTAGRAM',
      source: 'contact_instagram_id',
    };
  }
  if (hasFb && !hasIg) {
    return {
      raw: null,
      identityChannel: 'facebook',
      dbChannel: 'CHAT',
      outboundChannel: 'FACEBOOK',
      source: 'contact_facebook_id',
    };
  }
  return null;
}

function collectChannelHintStrings(
  data?: Record<string, unknown> | null,
  workflowFlatRaw?: Record<string, unknown> | null,
): string[] {
  const out: string[] = [];
  const push = (v: string | null | undefined) => {
    if (v?.trim()) out.push(v.trim());
  };

  const scanRow = (row: Record<string, unknown> | null | undefined) => {
    if (!row) return;
    for (const k of CHANNEL_HINT_FIELD_KEYS) {
      push(typeof row[k] === 'string' ? row[k] : null);
    }
    const tags = row['tags'];
    if (Array.isArray(tags)) {
      for (const t of tags) {
        if (typeof t === 'string' && t.trim()) out.push(t.trim());
      }
    }
  };

  scanRow(data ?? null);
  if (!workflowFlatRaw) return out;

  scanRow(workflowFlatRaw);
  const cd = workflowFlatRaw['customData'];
  if (isPlainObject(cd)) scanRow(cd);
  const contact = workflowFlatRaw['contact'];
  if (isPlainObject(contact)) scanRow(contact);
  const message = workflowFlatRaw['message'];
  if (isPlainObject(message)) scanRow(message);

  return out;
}

function inferFromScatteredChannelHints(
  data?: Record<string, unknown> | null,
  workflowFlatRaw?: Record<string, unknown> | null,
): NormalizedGhlChannel | null {
  let sawIg = false;
  let sawFb = false;

  for (const raw of collectChannelHintStrings(data, workflowFlatRaw)) {
    const s = compact(raw);
    if (!s) continue;
    if (s.includes('instagram') || s === 'ig' || s.includes('type_instagram')) sawIg = true;
    if (
      s.includes('facebook') ||
      s.includes('messenger') ||
      s === 'fb' ||
      s.includes('type_facebook')
    ) {
      sawFb = true;
    }
  }

  if (sawIg && !sawFb) {
    return {
      raw: null,
      identityChannel: 'instagram',
      dbChannel: 'CHAT',
      outboundChannel: 'INSTAGRAM',
      source: 'workflow_channel_hint_ig',
    };
  }
  if (sawFb && !sawIg) {
    return {
      raw: null,
      identityChannel: 'facebook',
      dbChannel: 'CHAT',
      outboundChannel: 'FACEBOOK',
      source: 'workflow_channel_hint_fb',
    };
  }
  return null;
}

function inferFromMessageType(messageTypeRaw: string | null | undefined): NormalizedGhlChannel | null {
  const mt = compact(messageTypeRaw);
  if (!mt) return null;

  if (
    mt.includes('facebook') ||
    mt === 'type_facebook' ||
    mt === 'fb' ||
    mt === '11' ||
    mt.includes('messenger')
  ) {
    return {
      raw: messageTypeRaw?.trim() ?? null,
      identityChannel: 'facebook',
      dbChannel: 'CHAT',
      outboundChannel: 'FACEBOOK',
      source: 'messageType',
    };
  }

  if (mt.includes('instagram') || mt === 'type_instagram' || mt === 'ig' || mt === '18') {
    return {
      raw: messageTypeRaw?.trim() ?? null,
      identityChannel: 'instagram',
      dbChannel: 'CHAT',
      outboundChannel: 'INSTAGRAM',
      source: 'messageType',
    };
  }

  if (mt.includes('whatsapp') || mt === 'type_whatsapp') {
    return {
      raw: messageTypeRaw?.trim() ?? null,
      identityChannel: 'whatsapp',
      dbChannel: 'WHATSAPP',
      outboundChannel: 'SMS',
      source: 'messageType',
    };
  }

  return null;
}

function inferFromPayloadMeta(
  data?: Record<string, unknown> | null,
  workflowFlatRaw?: Record<string, unknown> | null,
): NormalizedGhlChannel | null {
  if (hasIgMeta(data) || hasIgMeta(workflowFlatRaw)) {
    return {
      raw: null,
      identityChannel: 'instagram',
      dbChannel: 'CHAT',
      outboundChannel: 'INSTAGRAM',
      source: 'payload_meta_ig',
    };
  }
  if (hasFbMeta(data) || hasFbMeta(workflowFlatRaw)) {
    return {
      raw: null,
      identityChannel: 'facebook',
      dbChannel: 'CHAT',
      outboundChannel: 'FACEBOOK',
      source: 'payload_meta_fb',
    };
  }
  return null;
}

/**
 * Normalize GHL / workflow inbound channel labels from `data.channel` alone.
 */
export function normalizeGhlInboundChannel(raw: string | null | undefined): NormalizedGhlChannel {
  const rawTrimmed = typeof raw === 'string' && raw.trim() ? raw.trim() : null;
  const s = compact(rawTrimmed);

  if (!s) {
    return {
      raw: rawTrimmed,
      identityChannel: 'whatsapp',
      dbChannel: 'WHATSAPP',
      outboundChannel: 'SMS',
      source: 'default_empty',
    };
  }

  if (
    s === 'whatsapp' ||
    s === 'wa' ||
    s === 'type_whatsapp' ||
    s.includes('whatsapp')
  ) {
    return {
      raw: rawTrimmed,
      identityChannel: 'whatsapp',
      dbChannel: 'WHATSAPP',
      outboundChannel: 'SMS',
      source: 'channel_field',
    };
  }

  if (
    s === 'facebook' ||
    s === 'fb' ||
    s === 'messenger' ||
    s === 'type_facebook' ||
    s.includes('facebook') ||
    s.includes('messenger')
  ) {
    return {
      raw: rawTrimmed,
      identityChannel: 'facebook',
      dbChannel: 'CHAT',
      outboundChannel: 'FACEBOOK',
      source: 'channel_field',
    };
  }

  if (
    s === 'instagram' ||
    s === 'ig' ||
    s === 'type_instagram' ||
    s.includes('instagram')
  ) {
    return {
      raw: rawTrimmed,
      identityChannel: 'instagram',
      dbChannel: 'CHAT',
      outboundChannel: 'INSTAGRAM',
      source: 'channel_field',
    };
  }

  if (s === 'sms' || s === 'text' || s === 'type_sms' || s.includes('sms')) {
    return {
      raw: rawTrimmed,
      identityChannel: 'sms',
      dbChannel: 'SMS',
      outboundChannel: 'SMS',
      source: 'channel_field',
    };
  }

  if (
    s === 'email' ||
    s === 'type_email' ||
    s.includes('email')
  ) {
    return {
      raw: rawTrimmed,
      identityChannel: 'email',
      dbChannel: 'EMAIL',
      outboundChannel: 'SMS',
      source: 'channel_field',
    };
  }

  if (
    s === 'live_chat' ||
    s === 'livechat' ||
    s === 'webchat' ||
    s === 'chat' ||
    s === 'type_live_chat' ||
    s === 'type_webchat'
  ) {
    return {
      raw: rawTrimmed,
      identityChannel: 'chat',
      dbChannel: 'CHAT',
      outboundChannel: 'SMS',
      source: 'channel_field',
    };
  }

  return {
    raw: rawTrimmed,
    identityChannel: s.slice(0, 32) || 'unknown',
    dbChannel: 'CHAT',
    outboundChannel: 'SMS',
    source: 'channel_field_unknown',
  };
}

/**
 * Resolve inbound channel using messageType, meta, and channel field (in that priority).
 */
export function resolveGhlInboundChannel(hints: GhlInboundChannelHints): NormalizedGhlChannel {
  const fromMt = inferFromMessageType(hints.messageTypeRaw);
  if (fromMt) return fromMt;

  const fromMeta = inferFromPayloadMeta(hints.data, hints.workflowFlatRaw);
  if (fromMeta) return fromMeta;

  const fromSocialIds = inferFromContactSocialIds(hints.data, hints.workflowFlatRaw);
  if (fromSocialIds) return fromSocialIds;

  const fromScattered = inferFromScatteredChannelHints(hints.data, hints.workflowFlatRaw);
  if (fromScattered) return fromScattered;

  const fromChannel = normalizeGhlInboundChannel(hints.channelRaw);

  // GHL Workflow InboundMessage often sets channel=SMS for Meta DMs with no phone on the contact.
  const phone = (hints.contactPhone ?? '').trim();
  if (fromChannel.outboundChannel === 'SMS' && !phone && compact(hints.channelRaw) === 'sms') {
    return {
      raw: hints.channelRaw?.trim() ?? null,
      identityChannel: 'facebook',
      dbChannel: 'CHAT',
      outboundChannel: 'FACEBOOK',
      source: 'sms_channel_no_phone',
    };
  }

  return fromChannel;
}

export function isGhlMissingPhoneSendError(error: string | null | undefined): boolean {
  return /missing phone/i.test(error ?? '');
}

/** GHL returns when the contact lacks the Meta id for the attempted send channel. */
export function isGhlMissingMetaChannelIdError(error: string | null | undefined): boolean {
  return /no facebook id|no instagram id/i.test(error ?? '');
}

export function isGhlOutboundChannelRetryable(error: string | null | undefined): boolean {
  return isGhlMissingPhoneSendError(error) || isGhlMissingMetaChannelIdError(error);
}

/** When SMS send fails without a phone, try Meta channels (GHL mislabels Messenger as SMS). */
export function ghlOutboundFallbackChannels(primary: OutboundChannel): OutboundChannel[] {
  if (primary === 'SMS') return ['SMS', 'FACEBOOK', 'INSTAGRAM'];
  if (primary === 'FACEBOOK') return ['FACEBOOK', 'INSTAGRAM'];
  if (primary === 'INSTAGRAM') return ['INSTAGRAM', 'FACEBOOK'];
  return [primary];
}

export function outboundChannelFromDbChannel(dbChannel: string | null | undefined): OutboundChannel {
  const u = (dbChannel ?? '').trim().toUpperCase();
  if (u === 'WHATSAPP') return 'SMS';
  if (u === 'SMS') return 'SMS';
  if (u === 'CHAT') return 'FACEBOOK';
  if (u === 'EMAIL') return 'SMS';
  return 'SMS';
}

export function resolveOutboundChannelForSend(opts: {
  dbChannel: string | null | undefined;
  metadata: Record<string, unknown> | null | undefined;
}): OutboundChannel {
  const meta = opts.metadata?.['ghlOutboundChannel'];
  if (typeof meta === 'string' && meta.trim()) {
    const m = meta.trim().toUpperCase();
    if (m === 'WHATSAPP' || m === 'SMS' || m === 'FACEBOOK' || m === 'INSTAGRAM' || m === 'TIKTOK') {
      return m as OutboundChannel;
    }
  }
  return outboundChannelFromDbChannel(opts.dbChannel);
}
