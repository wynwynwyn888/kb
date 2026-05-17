/**
 * Staff-facing labels for active human escalation / handover rows.
 */

import { channelFromDerivedConversationKey } from './conversation-identity';
import {
  inferChannelFromGhlContactRecord,
  type NormalizedGhlChannel,
} from './ghl-channel-routing';

export interface HandoverChannelLabelInput {
  dbChannel: string | null | undefined;
  metadata?: Record<string, unknown> | null;
  ghlConversationId?: string | null;
  contact?: Record<string, unknown> | null;
}

const META_CHANNEL_LABELS = new Set(['Facebook Messenger', 'Instagram']);

function labelFromNormalized(norm: NormalizedGhlChannel): string {
  const outbound = norm.outboundChannel.toUpperCase();
  if (outbound === 'FACEBOOK') return 'Facebook Messenger';
  if (outbound === 'INSTAGRAM') return 'Instagram';
  if (norm.identityChannel === 'whatsapp' || outbound === 'SMS') return 'WhatsApp';
  if (norm.dbChannel === 'EMAIL') return 'Email';
  if (norm.dbChannel === 'CHAT') return 'Chat';
  return 'Message';
}

function labelFromIdentityChannel(identity: string): string | null {
  const id = identity.trim().toLowerCase();
  if (id === 'facebook' || id === 'fb' || id === 'messenger') return 'Facebook Messenger';
  if (id === 'instagram' || id === 'ig') return 'Instagram';
  if (id === 'whatsapp' || id === 'wa' || id === 'sms') return 'WhatsApp';
  if (id === 'email') return 'Email';
  return null;
}

export function formatHandoverTypeLabel(type: string | null | undefined): string {
  const t = (type ?? '').trim().toUpperCase();
  if (t === 'REQUEST') return 'Human request';
  if (t === 'TRANSFER') return 'Team transfer';
  return t ? t.charAt(0) + t.slice(1).toLowerCase() : 'Human request';
}

/** Map internal pause notes to client-facing copy. */
export function formatHandoverReasonLabel(note: string | null | undefined): string {
  const raw = (note ?? '').trim();
  if (!raw) return 'Human escalation';
  if (/human_intent:\s*human_handover/i.test(raw)) return 'Human escalation';
  if (/human_handover/i.test(raw)) return 'Human escalation';
  return raw;
}

/**
 * Channel labels for workspace UI.
 * Rule: DB `SMS` is WhatsApp only when the thread is not Facebook/Instagram (GHL often labels all DMs as SMS).
 */
export function formatHandoverChannelLabel(input: HandoverChannelLabelInput): string {
  const meta =
    input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)
      ? input.metadata
      : {};
  const outbound = typeof meta['ghlOutboundChannel'] === 'string' ? meta['ghlOutboundChannel'].trim().toUpperCase() : '';
  const identity =
    typeof meta['channelIdentity'] === 'string' ? meta['channelIdentity'].trim().toLowerCase() : '';

  if (outbound === 'FACEBOOK' || identity === 'facebook') return 'Facebook Messenger';
  if (outbound === 'INSTAGRAM' || identity === 'instagram') return 'Instagram';

  const derivedIdentity = channelFromDerivedConversationKey(input.ghlConversationId);
  if (derivedIdentity) {
    const fromDerived = labelFromIdentityChannel(derivedIdentity);
    if (fromDerived) return fromDerived;
  }

  const fromContact = inferChannelFromGhlContactRecord(input.contact ?? null);
  if (fromContact) return labelFromNormalized(fromContact);

  const ch = (input.dbChannel ?? '').trim().toUpperCase();
  if (ch === 'WHATSAPP') return 'WhatsApp';
  if (ch === 'EMAIL') return 'Email';
  if (ch === 'CHAT') return 'Chat';
  if (ch === 'SMS') return 'WhatsApp';
  return ch || 'Message';
}

export function isMetaMessagingChannelLabel(channelLabel: string): boolean {
  return META_CHANNEL_LABELS.has(channelLabel);
}

export function formatHandoverContactSummary(opts: {
  displayName: string | null | undefined;
  phone: string | null | undefined;
  channelLabel: string;
}): string {
  const name = (opts.displayName ?? '').trim() || 'Unknown contact';
  if (isMetaMessagingChannelLabel(opts.channelLabel)) {
    return name;
  }
  const phone = (opts.phone ?? '').trim();
  if (phone) return `${name} · ${phone}`;
  return name;
}

/** Lowercase channel slug for staff SMS / internal alerts. */
export type InternalAlertChannelSlug = 'whatsapp' | 'facebook' | 'instagram';

export function internalAlertChannelSlugFromLabel(channelLabel: string): InternalAlertChannelSlug {
  if (channelLabel === 'Instagram') return 'instagram';
  if (channelLabel === 'Facebook Messenger') return 'facebook';
  return 'whatsapp';
}

/** Customer + channel lines for internal human-escalation alerts. */
export function formatInternalEscalationCustomerLines(opts: {
  customerName: string;
  phone: string | null | undefined;
  channelSlug: InternalAlertChannelSlug;
}): string {
  const name = opts.customerName.trim() || 'Unknown customer';
  if (opts.channelSlug === 'whatsapp') {
    const phone = (opts.phone ?? '').trim() || 'Unknown phone';
    return `Customer: ${name}\nPhone: ${phone}\nChannel: whatsapp`;
  }
  return `Customer: ${name}\nChannel: ${opts.channelSlug}`;
}
