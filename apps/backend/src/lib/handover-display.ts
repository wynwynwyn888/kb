/**
 * Staff-facing labels for active human escalation / handover rows.
 */

export interface HandoverChannelLabelInput {
  dbChannel: string | null | undefined;
  metadata?: Record<string, unknown> | null;
}

const META_CHANNEL_LABELS = new Set(['Facebook Messenger', 'Instagram']);

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
 * Rule: DB `SMS` is shown as WhatsApp (GHL often labels WhatsApp threads as SMS).
 */
export function formatHandoverChannelLabel(input: HandoverChannelLabelInput): string {
  const ch = (input.dbChannel ?? '').trim().toUpperCase();
  const meta =
    input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)
      ? input.metadata
      : {};
  const outbound = typeof meta['ghlOutboundChannel'] === 'string' ? meta['ghlOutboundChannel'].trim().toUpperCase() : '';
  const identity =
    typeof meta['channelIdentity'] === 'string' ? meta['channelIdentity'].trim().toLowerCase() : '';

  if (outbound === 'FACEBOOK' || identity === 'facebook') return 'Facebook Messenger';
  if (outbound === 'INSTAGRAM' || identity === 'instagram') return 'Instagram';
  if (ch === 'WHATSAPP' || ch === 'SMS') return 'WhatsApp';
  if (ch === 'EMAIL') return 'Email';
  if (ch === 'CHAT') return 'Chat';
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
