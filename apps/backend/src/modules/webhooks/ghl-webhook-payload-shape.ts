import type { GhlInboundMessageData, GhlWebhookPayload } from './dto/ghl-webhook.payload';

export type GhlWebhookPayloadShape = 'nested' | 'ghl_workflow_flat';

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function sortedKeys(row: Record<string, unknown>): string[] {
  return Object.keys(row).sort();
}

/** Keys only — safe for logs (no body values, no PII). */
export function summarizeGhlWebhookBodyKeys(body: unknown): string {
  if (!isPlainObject(body)) {
    return 'GHL webhook body keys: top=[non-object]';
  }
  const top = sortedKeys(body);
  const cd = body['customData'];
  const customDataKeys = isPlainObject(cd) ? sortedKeys(cd) : null;
  const d = body['data'];
  const dataKeys = isPlainObject(d) ? sortedKeys(d) : null;
  const c = body['contact'];
  const contactKeys = isPlainObject(c) ? sortedKeys(c) : null;
  const m = body['message'];
  const messageKeys = isPlainObject(m) ? sortedKeys(m) : null;

  const fmt = (keys: string[] | null) => (keys && keys.length > 0 ? keys.join(',') : 'n/a');

  return (
    `GHL webhook body keys: top=[${top.join(',')}], ` +
    `customData=[${fmt(customDataKeys)}], ` +
    `data=[${fmt(dataKeys)}], ` +
    `contact=[${fmt(contactKeys)}], ` +
    `message=[${fmt(messageKeys)}]`
  );
}

function firstString(
  row: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const k of keys) {
    if (!(k in row)) continue;
    const v = row[k];
    if (v === undefined || v === null) continue;
    const s = typeof v === 'string' ? v : String(v);
    if (s.trim() !== '') return s.trim();
  }
  return undefined;
}

/** GHL workflow posts custom fields under `customData` first; then top-level envelope. */
function collectPickSources(r: Record<string, unknown>): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const cd = r['customData'];
  if (isPlainObject(cd)) {
    out.push(cd);
  }
  out.push(r);
  return out;
}

function pickFromSources(
  sources: Record<string, unknown>[],
  keys: string[],
): string | undefined {
  for (const src of sources) {
    const v = firstString(src, keys);
    if (v !== undefined) return v;
  }
  return undefined;
}

function extractMessageBody(
  r: Record<string, unknown>,
  sources: Record<string, unknown>[],
): string | undefined {
  const direct = pickFromSources(sources, ['message', 'data.message']);
  if (direct !== undefined) return direct;
  const msg = r['message'];
  if (isPlainObject(msg)) {
    return firstString(msg, ['body', 'text', 'content', 'message', 'html']);
  }
  return undefined;
}

function extractContactId(
  r: Record<string, unknown>,
  sources: Record<string, unknown>[],
): string | undefined {
  const direct = pickFromSources(sources, [
    'contactId',
    'contactid',
    'ContactId',
    'data.contactId',
  ]);
  if (direct !== undefined) return direct;
  const c = r['contact'];
  if (isPlainObject(c)) {
    return firstString(c, ['id', 'contactId', 'contact_id']);
  }
  return undefined;
}

function extractMessageId(
  r: Record<string, unknown>,
  sources: Record<string, unknown>[],
): string | undefined {
  const direct = pickFromSources(sources, [
    'id',
    'messageId',
    'data.id',
    /** GHL Workflow / customData: stable per execution when native message id is absent */
    'workflowExecutionId',
    'executionId',
    'runId',
    'workflowRunId',
  ]);
  if (direct !== undefined) return direct;
  const msg = r['message'];
  if (isPlainObject(msg)) {
    return firstString(msg, ['id', 'messageId', 'message_id']);
  }
  return undefined;
}

function extractConversationId(
  r: Record<string, unknown>,
  sources: Record<string, unknown>[],
): string | undefined {
  const direct = pickFromSources(sources, [
    'conversationId',
    'conversation_id',
    'data.conversationId',
  ]);
  if (direct !== undefined) return direct;
  const msg = r['message'];
  if (isPlainObject(msg)) {
    return firstString(msg, ['conversationId', 'conversation_id']);
  }
  return undefined;
}

/**
 * GHL workflow custom fields often hard-code `locationId` (easy to typo `l` vs `I`).
 * When the platform includes a nested `location` object, prefer its `id` after scanning the
 * root body first, then other pick sources.
 */
function extractLocationId(
  r: Record<string, unknown>,
  sources: Record<string, unknown>[],
): string | undefined {
  const scanRows: Record<string, unknown>[] = [r];
  for (const s of sources) {
    if (s !== r) scanRows.push(s);
  }
  for (const row of scanRows) {
    const loc = row['location'];
    if (isPlainObject(loc)) {
      const id = firstString(loc, ['id', 'locationId', 'location_id']);
      if (id !== undefined) return id;
    }
  }
  return pickFromSources(sources, [
    'locationId',
    'location_id',
    'LocationId',
    'data.locationId',
  ]);
}

/** Copy attachments / media / HTTP URL fields from workflow-flat sources into canonical `data` for downstream extractors. */
function mergeWorkflowFlatMediaIntoInbound(
  inbound: Record<string, unknown>,
  raw: Record<string, unknown>,
  sources: Record<string, unknown>[],
): void {
  const candidates: Record<string, unknown>[] = [];
  for (const s of sources) candidates.push(s);
  candidates.push(raw);

  for (const src of candidates) {
    const att = src['attachments'];
    if (Array.isArray(att) && att.length > 0 && !inbound['attachments']) {
      inbound['attachments'] = att;
    }
  }
  for (const src of candidates) {
    const med = src['media'];
    if (med != null && typeof med === 'object' && !inbound['media']) {
      inbound['media'] = med;
    }
  }
  const urlKeys = ['mediaUrl', 'fileUrl', 'downloadUrl', 'attachmentUrl', 'url'] as const;
  for (const k of urlKeys) {
    if (inbound[k]) continue;
    for (const src of candidates) {
      const v = src[k];
      if (typeof v === 'string' && /^https?:\/\//i.test(v.trim())) {
        inbound[k] = v.trim();
        break;
      }
    }
  }
}

/**
 * Accepts native nested `GhlWebhookPayload`, GHL Workflow envelope (`customData` + `contact` + `message`),
 * or flat top-level rows (plus optional dotted keys like `data.id`). Produces a canonical nested payload
 * for `WebhooksService.handleGhlWebhook`.
 */
export function coerceGhlWebhookPayload(raw: unknown): {
  payload: GhlWebhookPayload;
  shape: GhlWebhookPayloadShape;
  /** Original flat webhook body (same reference as input) — pass to `WebhooksService` for diagnostics + URL discovery. */
  workflowFlatRaw?: Record<string, unknown>;
} {
  if (!isPlainObject(raw)) {
    throw new Error('Invalid webhook payload: body must be a JSON object');
  }

  const r = raw;
  const sources = collectPickSources(r);

  const rawData = r['data'];
  const hadNestedNonEmptyData =
    isPlainObject(rawData) && Object.keys(rawData).length > 0;
  const shape: GhlWebhookPayloadShape = hadNestedNonEmptyData
    ? 'nested'
    : 'ghl_workflow_flat';

  const inbound: Record<string, unknown> = hadNestedNonEmptyData
    ? { ...(rawData as Record<string, unknown>) }
    : {};

  const pickData = (...keys: string[]) => firstString(inbound, keys);

  const id =
    pickData('id') ??
    extractMessageId(r, sources);
  const conversationId =
    pickData('conversationId') ??
    extractConversationId(r, sources);
  const contactId =
    pickData('contactId') ??
    extractContactId(r, sources);
  const message =
    pickData('message') ?? extractMessageBody(r, sources);
  const messageType =
    pickData('messageType') ??
    pickFromSources(sources, ['messageType', 'data.messageType']);
  const channel =
    pickData('channel') ?? pickFromSources(sources, ['channel', 'data.channel']);

  if (id !== undefined) inbound['id'] = id;
  if (conversationId !== undefined) inbound['conversationId'] = conversationId;
  if (contactId !== undefined) inbound['contactId'] = contactId;
  if (message !== undefined) inbound['message'] = message;
  if (messageType !== undefined) inbound['messageType'] = messageType;
  if (channel !== undefined) inbound['channel'] = channel;

  if (!hadNestedNonEmptyData) {
    mergeWorkflowFlatMediaIntoInbound(inbound, r, sources);
  }

  const locationId = extractLocationId(r, sources);
  const event = pickFromSources(sources, ['event']);
  if (!locationId || !event) {
    throw new Error(
      'Invalid webhook payload: locationId and event are required (top-level or customData)',
    );
  }

  const timestamp =
    pickFromSources(sources, ['timestamp']) ?? new Date().toISOString();

  const versionRaw = pickFromSources(sources, ['version']);
  const payload: GhlWebhookPayload = {
    locationId,
    event,
    timestamp,
    data: inbound as unknown as GhlInboundMessageData,
    ...(versionRaw !== undefined && versionRaw.trim() !== ''
      ? { version: versionRaw.trim() }
      : {}),
  };

  return {
    payload,
    shape,
    ...(hadNestedNonEmptyData ? {} : { workflowFlatRaw: r }),
  };
}
