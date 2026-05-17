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

  const fromChannel = normalizeGhlInboundChannel(hints.channelRaw);

  // GHL Workflow InboundMessage often sets channel=SMS for Messenger with no phone on the contact.
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

/** When SMS send fails without a phone, try Meta channels (GHL mislabels Messenger as SMS). */
export function ghlOutboundFallbackChannels(primary: OutboundChannel): OutboundChannel[] {
  if (primary !== 'SMS') return [primary];
  return ['SMS', 'FACEBOOK', 'INSTAGRAM'];
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
