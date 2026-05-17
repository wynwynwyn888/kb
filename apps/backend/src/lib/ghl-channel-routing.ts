/**
 * Map GHL inbound `data.channel` strings to our DB `conversations.channel` enum
 * and to `@aisbp/ghl-client` outbound send channel keys.
 */
import type { OutboundChannel } from '@aisbp/ghl-client';

/** Values stored on `conversations.channel` (Postgres enum). */
export type ConversationDbChannel = 'WHATSAPP' | 'SMS' | 'CHAT' | 'EMAIL';

export interface NormalizedGhlChannel {
  /** Raw webhook value when present. */
  raw: string | null;
  /** Lowercase identity segment for `aisbp:conv:<channel>:...` keys. */
  identityChannel: string;
  dbChannel: ConversationDbChannel;
  outboundChannel: OutboundChannel;
}

function compact(raw: string | null | undefined): string {
  return (raw ?? '').trim().toLowerCase().replace(/\s+/g, '_');
}

/**
 * Normalize GHL / workflow inbound channel labels.
 * When unknown, defaults to SMS outbound (phone channels) and WHATSAPP db label for legacy rows.
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
      // This integration has been live-verified with the SMS-shaped GHL body for WhatsApp threads.
      outboundChannel: 'SMS',
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
    };
  }

  if (s === 'sms' || s === 'text' || s === 'type_sms' || s.includes('sms')) {
    return {
      raw: rawTrimmed,
      identityChannel: 'sms',
      dbChannel: 'SMS',
      outboundChannel: 'SMS',
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
    };
  }

  return {
    raw: rawTrimmed,
    identityChannel: s.slice(0, 32) || 'unknown',
    dbChannel: 'CHAT',
    outboundChannel: 'SMS',
  };
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
