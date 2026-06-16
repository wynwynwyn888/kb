// GHL API client - focused on connection verification, health check, and outbound messaging
// For Private Integration tokens (not Marketplace OAuth)
//
// IMPORTANT: GHL Private Integration tokens are static bearer tokens.
// They do NOT have OAuth-style refresh. The token is used directly.

import axios from 'axios';
import type { AxiosInstance, AxiosError } from 'axios';

import {
  computeWidgetFreeSlotsQueryRange,
  crmMonthStartEndMsInclusive,
  filterFreeSlotsToUtcWindow,
} from './free-slots-ranges.js';

import {
  parseGhlFreeSlotsResponse,
  isLikelySlotIsoInstant,
  type GhlFreeSlot,
  type GhlFreeSlotsParseResult,
} from './parse-ghl-free-slots-response.js';

export { parseGhlFreeSlotsResponse, isLikelySlotIsoInstant };
export type { GhlFreeSlot, GhlFreeSlotsParseResult };

export interface GhlClientConfig {
  baseUrl: string;
  accessToken: string;
  locationId: string;
}

// GHL API Response types
export interface GhlLocationInfo {
  id: string;
  name: string;
  accountId: string;
  status: string;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null;
}

/** Digits-only for phone equality (E.164 vs local formats). */
export function digitsOnlyPhone(value: string): string {
  return value.replace(/\D/g, '');
}

/** Minimal contact row from search — no tokens. */
export interface GhlContactPhoneLookup {
  id: string;
  name?: string;
  phone?: string;
  email?: string;
}

function extractContactsSearchRows(raw: unknown): Record<string, unknown>[] {
  if (!isRecord(raw)) return [];
  const candidates: unknown[] = [
    raw['contacts'],
    raw['results'],
    isRecord(raw['data']) ? raw['data']['contacts'] : undefined,
    isRecord(raw['data']) ? raw['data']['results'] : undefined,
  ];
  for (const a of candidates) {
    if (Array.isArray(a)) {
      return a.filter((x): x is Record<string, unknown> => isRecord(x));
    }
  }
  return [];
}

function mapSearchRowToLookup(row: Record<string, unknown>): GhlContactPhoneLookup | null {
  const id = typeof row['id'] === 'string' ? row['id'].trim() : '';
  if (!id) return null;
  const fn = typeof row['firstName'] === 'string' ? row['firstName'].trim() : '';
  const ln = typeof row['lastName'] === 'string' ? row['lastName'].trim() : '';
  const combined = [fn, ln].filter(Boolean).join(' ').trim();
  const name = combined || (typeof row['name'] === 'string' ? row['name'].trim() : undefined);
  const phone =
    typeof row['phone'] === 'string'
      ? row['phone'].trim()
      : typeof row['phoneNumber'] === 'string'
        ? row['phoneNumber'].trim()
        : typeof row['primaryPhone'] === 'string'
          ? row['primaryPhone'].trim()
          : undefined;
  const email = typeof row['email'] === 'string' ? row['email'].trim() : undefined;
  return { id, name: name || undefined, phone, email };
}

/** Prefer a row whose phone digits match `targetDigits` when length ≥ 8; else single-result heuristic. */
export function pickContactByPhoneDigits(
  rows: Record<string, unknown>[],
  targetDigits: string,
): GhlContactPhoneLookup | undefined {
  const lookups = rows.map(mapSearchRowToLookup).filter((x): x is GhlContactPhoneLookup => Boolean(x));
  if (targetDigits.length >= 8) {
    for (const L of lookups) {
      const pd = digitsOnlyPhone(L.phone ?? '');
      if (pd && pd === targetDigits) return L;
    }
    return undefined;
  }
  if (lookups.length === 1) return lookups[0];
  return undefined;
}

/** Official GHL (HighLevel) API host per current docs. */
const GHL_API_BASE_DEFAULT = 'https://services.leadconnectorhq.com';

/**
 * `services.gohighlevel.com` does not resolve (ENOTFOUND) — the API lives on leadconnectorhq.com.
 * Maps legacy env values so deployments that copied old examples still work.
 */
export function resolveGhlApiBaseUrl(envValue: string | undefined): string {
  const raw = (envValue ?? '').trim();
  if (!raw) return GHL_API_BASE_DEFAULT;
  const withoutTrailingSlashes = raw.replace(/\/+$/, '');
  try {
    const u = new URL(withoutTrailingSlashes);
    if (u.hostname === 'services.gohighlevel.com') {
      return GHL_API_BASE_DEFAULT;
    }
  } catch {
    return GHL_API_BASE_DEFAULT;
  }
  return withoutTrailingSlashes;
}

/** Trimmed non-empty string id, or null. */
export function normalizeGhlLocationId(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s.length > 0 ? s : null;
}

/**
 * GHL GET /locations/:locationId may return a flat location object, or wrap it
 * (e.g. `{ location: { ... } }`). The sub-account id is often `locationId`, while
 * `id` may be a different internal id — comparing only `response.data.id` caused false
 * "Location ID mismatch" for valid connections.
 */
export function extractGhlLocationPayload(data: unknown): Record<string, unknown> | null {
  if (!isRecord(data)) return null;
  const unwrapKeys = ['location', 'Location', 'data'];
  for (const key of unwrapKeys) {
    const inner = data[key];
    if (
      isRecord(inner) &&
      (inner['locationId'] !== undefined ||
        inner['id'] !== undefined ||
        inner['name'] !== undefined)
    ) {
      return inner;
    }
  }
  return data;
}

/** All string ids on a location payload that might equal the requested sub-account id. */
export function collectGhlSubAccountIds(payload: Record<string, unknown>): string[] {
  const out: string[] = [];
  const add = (v: unknown) => {
    const n = normalizeGhlLocationId(v);
    if (n && !out.includes(n)) out.push(n);
  };
  add(payload['locationId']);
  add(payload['id']);
  return out;
}

export interface GhlHealthResponse {
  success: boolean;
  locationId: string;
  accountId?: string;
  timestamp: string;
}

export interface GhlApiError {
  code: string;
  message: string;
  status: number;
}

// Outbound message types
// CONFIRMED LIVE — GHL Private Integration:
//   POST /conversations/messages
//   SMS confirmed via live browser network capture (2026-04-19)
//
// Channel mapping — all channels MUST be live-verified before use:
//   SMS      — VERIFIED LIVE (live browser capture)
//   WHATSAPP — mapped per GHL "Send a new message" type `WhatsApp` (2026-05; verify per location)
//   FACEBOOK — mapped per GHL type `FB`
//   INSTAGRAM — mapped per GHL type `IG`
//   TIKTOK   — TODO: unverified, do not use
//
// GHL API outbound payload per channel (this client uses one shape for all mapped channels):
//   SMS: { contactId, type: "SMS", message, attachments: [], channel: "sms", fromOneToOneConversation: true, locationId }
//
// WHATSAPP — NOT VERIFIED IN THIS REPO YET (CHANNEL_MAP.WHATSAPP stays null).
// Before enabling: capture a successful Private Integration POST /conversations/messages for WhatsApp
// the same way SMS was verified (browser DevTools or scripted call), and confirm the exact `type` and
// `channel` strings GHL accepts alongside `message`. Public help articles may show newer/alternate
// payload shapes (e.g. nested `content`); do not copy those into this map without matching live proof
// for the same request shape this client sends.

export type OutboundChannel = 'SMS' | 'WHATSAPP' | 'FACEBOOK' | 'INSTAGRAM' | 'TIKTOK';

interface OutboundChannelConfig {
  /** GHL API 'type' field value */
  type: string;
  /** GHL API 'channel' field value (lowercase) */
  channel: string;
  /** GHL API 'fromOneToOneConversation' flag */
  fromOneToOneConversation: boolean;
  /** GHL API 'attachments' array (currently empty for SMS) */
  attachments: unknown[];
}

/**
 * Internal channel map. null = unverified, do not use.
 * Add new verified channels here after live confirmation (see WHATSAPP note above).
 */
const CHANNEL_MAP: Record<OutboundChannel, OutboundChannelConfig | null> = {
  SMS: {
    type: 'SMS',
    channel: 'sms',
    fromOneToOneConversation: true,
    attachments: [],
  },
  WHATSAPP: {
    type: 'WhatsApp',
    channel: 'whatsapp',
    fromOneToOneConversation: true,
    attachments: [],
  },
  FACEBOOK: {
    type: 'FB',
    channel: 'facebook',
    fromOneToOneConversation: true,
    attachments: [],
  },
  INSTAGRAM: {
    type: 'IG',
    channel: 'instagram',
    fromOneToOneConversation: true,
    attachments: [],
  },
  TIKTOK: null,
};

export function isChannelVerified(channel: OutboundChannel): boolean {
  return CHANNEL_MAP[channel] !== null;
}

export function getChannelConfig(channel: OutboundChannel): OutboundChannelConfig | null {
  return CHANNEL_MAP[channel];
}

export interface GhlSendMessageRequest {
  locationId: string;
  contactId: string;
  message: string;
  channel: OutboundChannel;
}

export interface GhlSendMessageResponse {
  id: string;
  conversationId: string;
  status: string;
  timestamp: string;
}

// Contact tagging types
export interface TagContactRequest {
  contactId: string;
  tags: string[];
}

// Booking / appointment types
export interface GhlCalendarSummary {
  id: string;
  name: string;
}

/**
 * `Version` header for HighLevel "Get Calendars" (GET /calendars/).
 * Sub-Account Private Integration token per current docs.
 */
export const GHL_CALENDARS_LIST_API_VERSION = '2023-02-21';

/** API `Version` header values used when probing free-slots compatibility. */
export const GHL_FREE_SLOTS_PROBE_API_VERSIONS = ['2023-02-21', '2021-07-28', '2021-04-15'] as const;

/** Public booking widget network capture uses this host (not `services.leadconnectorhq.com`). */
export const GHL_WIDGET_BACKEND_BASE_URL = 'https://backend.leadconnectorhq.com';

export type GhlFreeSlotsTimestampUnit = 'ms' | 's';
export type GhlFreeSlotsUserParamMode = 'none' | 'userId' | 'userIds';

/** Env `GHL_FREE_SLOTS_HOST_MODE` */
export type GhlFreeSlotsHostMode = 'widget_backend' | 'services_api';
/** Env `GHL_FREE_SLOTS_RANGE_MODE` — when host is widget_backend, controls the wide HTTP query window. */
export type GhlFreeSlotsRangeMode = 'month' | 'day' | 'selected_to_day_end';

export type GhlFreeSlotsProbeHostMode = 'leadconnectorBackendWidget' | 'servicesApi';
export type GhlFreeSlotsProbeRangeMode = 'month' | 'fullLocalDay' | 'selectedToDayEnd';

export interface GhlFreeSlotsProductionSpec {
  apiVersion: string;
  timestampUnit: GhlFreeSlotsTimestampUnit;
  includeTimezoneQuery: boolean;
  /** How to attach staff id on retry when the first free-slots call returns zero slots. */
  retryAddsUserAs: 'userId' | 'userIds';
  hostMode: GhlFreeSlotsHostMode;
  /** Wide query window for widget-backend host; ignored for services_api (caller supplies ms range). */
  rangeMode: GhlFreeSlotsRangeMode;
  sendSeatsPerSlot: boolean;
  channel: string;
  source: string;
  /** When host is widget_backend, optionally send the Private Integration bearer (never logged). */
  widgetRequestUsesBearer: boolean;
}

export function formatFreeSlotsTimestamp(ms: number, unit: GhlFreeSlotsTimestampUnit): string {
  const floored = Math.floor(ms);
  return unit === 's' ? String(Math.floor(floored / 1000)) : String(floored);
}

/**
 * Production free-slots query shape — defaults: `services_api` + `day` + Version `2023-02-21` + `ms` + timezone + `sendSeatsPerSlot` false + `userId` retry.
 * Override via env when your GHL account needs a different shape (use Automation → Advanced diagnostics probe to compare).
 * - `GHL_FREE_SLOTS_API_VERSION` — default `2023-02-21` (Version header / services path)
 * - `GHL_FREE_SLOTS_TIMESTAMP_UNIT` — `ms` or `s` (seconds) — services API only
 * - `GHL_FREE_SLOTS_INCLUDE_TIMEZONE` — `true` / `false` (omit `timezone` query param when false) — services API
 * - `GHL_FREE_SLOTS_RETRY_USER_PARAM` — `userId` or `userIds` (staff retry query key) — services API
 * - `GHL_FREE_SLOTS_HOST_MODE` — `services_api` (default) | `widget_backend` (fallback / wide-window diagnostic only)
 * - `GHL_FREE_SLOTS_RANGE_MODE` — `month` | `day` | `selected_to_day_end` (widget_backend query window only; default `day`)
 * - `GHL_FREE_SLOTS_SEND_SEATS_PER_SLOT` — `true` / `false` (default `false`)
 * - `GHL_FREE_SLOTS_CHANNEL` — default `APP`
 * - `GHL_FREE_SLOTS_SOURCE` — default `WEB_USER`
 * - `GHL_FREE_SLOTS_WIDGET_USE_BEARER` — `true` / `false` (default `false`) — attach PI bearer on widget host only
 */
export function resolveGhlFreeSlotsProductionSpec(): GhlFreeSlotsProductionSpec {
  const apiVersion = (process.env['GHL_FREE_SLOTS_API_VERSION'] ?? '').trim() || GHL_CALENDARS_LIST_API_VERSION;
  const unitRaw = (process.env['GHL_FREE_SLOTS_TIMESTAMP_UNIT'] ?? 'ms').trim().toLowerCase();
  const timestampUnit: GhlFreeSlotsTimestampUnit =
    unitRaw === 's' || unitRaw === 'sec' || unitRaw === 'seconds' ? 's' : 'ms';
  const tzRaw = (process.env['GHL_FREE_SLOTS_INCLUDE_TIMEZONE'] ?? 'true').trim().toLowerCase();
  const includeTimezoneQuery = !(tzRaw === 'false' || tzRaw === '0' || tzRaw === 'no');
  const retryRaw = (process.env['GHL_FREE_SLOTS_RETRY_USER_PARAM'] ?? 'userId').trim().toLowerCase();
  const retryAddsUserAs: 'userId' | 'userIds' =
    retryRaw === 'userids' || retryRaw === 'user_ids' ? 'userIds' : 'userId';

  const hostRaw = (process.env['GHL_FREE_SLOTS_HOST_MODE'] ?? 'services_api').trim().toLowerCase().replace(/-/g, '_');
  const hostMode: GhlFreeSlotsHostMode =
    hostRaw === 'widget_backend' || hostRaw === 'widget' || hostRaw === 'leadconnector_backend'
      ? 'widget_backend'
      : 'services_api';

  const rangeRaw = (process.env['GHL_FREE_SLOTS_RANGE_MODE'] ?? 'day').trim().toLowerCase().replace(/-/g, '_');
  let rangeMode: GhlFreeSlotsRangeMode = 'day';
  if (rangeRaw === 'month') rangeMode = 'month';
  else if (rangeRaw === 'selected_to_day_end') rangeMode = 'selected_to_day_end';

  const seatsRaw = (process.env['GHL_FREE_SLOTS_SEND_SEATS_PER_SLOT'] ?? 'false').trim().toLowerCase();
  const sendSeatsPerSlot = seatsRaw === 'true' || seatsRaw === '1' || seatsRaw === 'yes';

  const channel = (process.env['GHL_FREE_SLOTS_CHANNEL'] ?? 'APP').trim() || 'APP';
  const source = (process.env['GHL_FREE_SLOTS_SOURCE'] ?? 'WEB_USER').trim() || 'WEB_USER';

  const bearerRaw = (process.env['GHL_FREE_SLOTS_WIDGET_USE_BEARER'] ?? 'false').trim().toLowerCase();
  const widgetRequestUsesBearer = bearerRaw === 'true' || bearerRaw === '1' || bearerRaw === 'yes';

  return {
    apiVersion,
    timestampUnit,
    includeTimezoneQuery,
    retryAddsUserAs,
    hostMode,
    rangeMode,
    sendSeatsPerSlot,
    channel,
    source,
    widgetRequestUsesBearer,
  };
}

export interface GhlFreeSlotsVariantExecution {
  slots: GhlFreeSlot[];
  dateKeys: string[];
  shapeSummary: string;
  rawResponseShape?: string;
  rawIsoStringCount?: number;
  parsedSlotsReturned?: number;
  error?: string;
  httpStatus?: number;
  responseBodyExcerpt?: string;
  requestPath: string;
  requestQuery: Record<string, string>;
  hostMode?: GhlFreeSlotsProbeHostMode;
  probeRangeMode?: GhlFreeSlotsProbeRangeMode;
  sendSeatsPerSlot?: boolean;
  /** Version header sent on the wire (diagnostics). */
  versionHeader?: string;
  channelHeader?: string;
  sourceHeader?: string;
  /** When slots were narrowed to the caller window after a wide widget query. */
  filteredToRequestWindow?: boolean;
  /** Human-facing note for booking UI (no secrets). */
  availabilityNote?: string;
}

export interface ListCalendarsResult {
  calendars: GhlCalendarSummary[];
  error?: string;
  httpStatus?: number;
  responseBodyExcerpt?: string;
  /** Relative path e.g. `/calendars/` */
  requestPath?: string;
}

/**
 * Normalize GET /calendars/ JSON (array, `{ calendars }`, `{ data }`, nested shapes).
 */
export function normalizeGhlCalendarListResponse(raw: unknown): GhlCalendarSummary[] {
  const rows = extractCalendarListRows(raw);
  if (!rows) return [];
  const calendars: GhlCalendarSummary[] = [];
  for (const x of rows) {
    if (!isRecord(x)) continue;
    const id =
      typeof x['id'] === 'string'
        ? x['id']
        : typeof x['_id'] === 'string'
          ? x['_id']
          : '';
    const name =
      typeof x['name'] === 'string'
        ? x['name']
        : typeof x['title'] === 'string'
          ? x['title']
          : '';
    if (id) calendars.push({ id, name: name || id });
  }
  return calendars;
}

function extractCalendarListRows(raw: unknown): unknown[] | null {
  if (Array.isArray(raw)) return raw;
  if (!isRecord(raw)) return null;
  for (const key of ['calendars', 'items', 'results', 'result'] as const) {
    const v = raw[key];
    if (Array.isArray(v)) return v;
  }
  const data = raw['data'];
  if (Array.isArray(data)) return data;
  if (isRecord(data)) {
    for (const key of ['calendars', 'items', 'results'] as const) {
      const v = data[key];
      if (Array.isArray(v)) return v;
    }
  }
  return null;
}

/** Safe subset of GET /calendars/:id for debugging / UI (no tokens). */
export interface GhlCalendarDetailSummary {
  name?: string;
  calendarType?: string;
  /** Legacy alias when API uses `type` only */
  typeRaw?: string;
  isActive?: boolean;
  status?: string;
  slotDuration?: number;
  slotInterval?: number;
  /** Capacity / bookings allowed per slot */
  appointmentsPerSlot?: number;
  preBufferMinutes?: number;
  postBufferMinutes?: number;
  minSchedulingNoticeMinutes?: number;
  /** Normalized YYYY-MM-DD when parseable */
  bookingWindowStartYmd?: string | null;
  bookingWindowEndYmd?: string | null;
  meetingLocationType?: string | null;
  /** True when any primary location field is non-empty (no raw address in summary). */
  meetingLocationPresent?: boolean;
  /** External / Google-style busy conflict checks when inferable */
  conflictCheckEnabled?: boolean;
  googleConflictChecking?: boolean;
  formIdPresent?: boolean;
  consentRequired?: boolean;
  paymentRequired?: boolean;
  /** True when services array exists and is empty, or explicit incomplete flag — safe heuristic only */
  servicesIncompleteHint?: boolean;
  teamMemberCount?: number;
  teamMemberUserIds?: string[];
  openHoursCount?: number;
}

function readFiniteNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    const n = parseFloat(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function readPositiveInt(v: unknown): number | undefined {
  const n = readFiniteNumber(v);
  if (n === undefined || n < 0) return undefined;
  return Math.round(n);
}

/** First line of ISO or YYYY-MM-DD prefix for comparisons (UTC date from ISO date part). */
function normalizeBookingYmd(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  const s = v.trim();
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (iso) return iso[1]!;
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function mergeNestedCalendarFields(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...o };
  const nested = o['bookingSettings'] ?? o['calendarSettings'] ?? o['booking'];
  if (isRecord(nested)) {
    for (const [k, v] of Object.entries(nested)) {
      if (out[k] === undefined) out[k] = v;
    }
  }
  return out;
}

function extractCalendarDetailSummary(raw: Record<string, unknown>): GhlCalendarDetailSummary {
  const o = mergeNestedCalendarFields(raw);
  const name = typeof o['name'] === 'string' ? o['name'] : undefined;
  const calendarType =
    typeof o['calendarType'] === 'string'
      ? o['calendarType']
      : typeof o['type'] === 'string'
        ? o['type']
        : undefined;
  const typeRaw = typeof o['type'] === 'string' ? o['type'] : undefined;
  const isActive = typeof o['isActive'] === 'boolean' ? o['isActive'] : undefined;
  const status = typeof o['status'] === 'string' ? o['status'] : undefined;

  let slotDuration: number | undefined;
  const slotDurRaw = readFiniteNumber(o['slotDuration']);
  if (slotDurRaw !== undefined) slotDuration = Math.round(slotDurRaw);

  const slotInterval =
    readPositiveInt(o['slotInterval']) ??
    readPositiveInt(o['interval']) ??
    readPositiveInt(o['slotSpacing']) ??
    readPositiveInt(o['minutesPerSlot']);

  const appointmentsPerSlot =
    readPositiveInt(o['appointmentPerSlot']) ??
    readPositiveInt(o['appointmentsPerSlot']) ??
    readPositiveInt(o['maxBookingsPerSlot']) ??
    readPositiveInt(o['appointments_per_slot']);

  let preBufferMinutes: number | undefined;
  let postBufferMinutes: number | undefined;
  const buf = o['buffer'];
  if (isRecord(buf)) {
    preBufferMinutes =
      readPositiveInt(buf['preBuffer']) ??
      readPositiveInt(buf['pre']) ??
      readPositiveInt(buf['before']) ??
      readPositiveInt(buf['preBufferTime']);
    postBufferMinutes =
      readPositiveInt(buf['postBuffer']) ??
      readPositiveInt(buf['post']) ??
      readPositiveInt(buf['after']) ??
      readPositiveInt(buf['postBufferTime']);
  }
  preBufferMinutes =
    preBufferMinutes ??
    readPositiveInt(o['preBuffer']) ??
    readPositiveInt(o['preBufferTime']) ??
    readPositiveInt(o['bufferBefore']);
  postBufferMinutes =
    postBufferMinutes ??
    readPositiveInt(o['postBuffer']) ??
    readPositiveInt(o['postBufferTime']) ??
    readPositiveInt(o['bufferAfter']);

  let minSchedulingNoticeMinutes: number | undefined;
  minSchedulingNoticeMinutes =
    readPositiveInt(o['minimumSchedulingNotice']) ??
    readPositiveInt(o['minSchedulingNotice']) ??
    readPositiveInt(o['minimumSchedulingNoticeInMinutes']) ??
    readPositiveInt(o['minNotice']);
  const noticeObj = o['schedulingNotice'];
  if (isRecord(noticeObj)) {
    minSchedulingNoticeMinutes =
      minSchedulingNoticeMinutes ??
      readPositiveInt(noticeObj['minimum']) ??
      readPositiveInt(noticeObj['minutes']) ??
      readPositiveInt(noticeObj['value']);
  }

  let bookingWindowStartYmd: string | null =
    normalizeBookingYmd(o['bookingStartDate']) ??
    normalizeBookingYmd(o['startDate']) ??
    null;
  let bookingWindowEndYmd: string | null =
    normalizeBookingYmd(o['bookingEndDate']) ??
    normalizeBookingYmd(o['endDate']) ??
    null;

  const dr =
    (isRecord(o['dateRange']) ? o['dateRange'] : null) ??
    (isRecord(o['availabilityDateRange']) ? o['availabilityDateRange'] : null) ??
    (isRecord(o['bookingWindow']) ? o['bookingWindow'] : null);
  if (isRecord(dr)) {
    bookingWindowStartYmd =
      bookingWindowStartYmd ??
      normalizeBookingYmd(dr['startDate']) ??
      normalizeBookingYmd(dr['start']) ??
      normalizeBookingYmd(dr['from']);
    bookingWindowEndYmd =
      bookingWindowEndYmd ??
      normalizeBookingYmd(dr['endDate']) ??
      normalizeBookingYmd(dr['end']) ??
      normalizeBookingYmd(dr['to']);
  }

  const meetingLocationType =
    typeof o['meetingLocationType'] === 'string'
      ? o['meetingLocationType']
      : typeof o['locationType'] === 'string'
        ? o['locationType']
        : null;

  const locCandidates = [
    o['meetingLocation'],
    o['location'],
    o['address'],
    o['customLocation'],
    o['physicalLocation'],
  ];
  let locLen = 0;
  for (const c of locCandidates) {
    if (typeof c === 'string' && c.trim()) {
      locLen += c.trim().length;
      break;
    }
  }
  const meetingLocationPresent = locLen > 0;

  let conflictCheckEnabled = false;
  let googleConflictChecking = false;
  if (typeof o['lookForConflicts'] === 'boolean') conflictCheckEnabled = o['lookForConflicts'];
  if (typeof o['checkForConflicts'] === 'boolean') conflictCheckEnabled = conflictCheckEnabled || o['checkForConflicts'];
  if (typeof o['enableConflictChecking'] === 'boolean')
    conflictCheckEnabled = conflictCheckEnabled || o['enableConflictChecking'];
  const gc = o['googleCalendar'];
  if (isRecord(gc)) {
    if (typeof gc['lookForConflicts'] === 'boolean') conflictCheckEnabled = conflictCheckEnabled || gc['lookForConflicts'];
    if (typeof gc['checkForConflicts'] === 'boolean') conflictCheckEnabled = conflictCheckEnabled || gc['checkForConflicts'];
    if (typeof gc['enableBusyCheck'] === 'boolean') googleConflictChecking = gc['enableBusyCheck'];
    if (typeof gc['syncCalendars'] === 'boolean') googleConflictChecking = googleConflictChecking || gc['syncCalendars'];
  }
  if (typeof o['googleConflictCheck'] === 'boolean') googleConflictChecking = googleConflictChecking || o['googleConflictCheck'];

  const formIdPresent =
    (typeof o['formId'] === 'string' && o['formId'].trim().length > 0) ||
    (typeof o['form_id'] === 'string' && o['form_id'].trim().length > 0);

  let consentRequired = false;
  if (typeof o['isConsentRequired'] === 'boolean') consentRequired = o['isConsentRequired'];
  if (typeof o['consentRequired'] === 'boolean') consentRequired = consentRequired || o['consentRequired'];
  const consentId = o['consentTemplateId'] ?? o['consentId'];
  if (typeof consentId === 'string' && consentId.trim()) consentRequired = true;

  let paymentRequired = false;
  if (typeof o['isPaymentEnabled'] === 'boolean') paymentRequired = o['isPaymentEnabled'];
  if (typeof o['requirePayment'] === 'boolean') paymentRequired = paymentRequired || o['requirePayment'];
  if (typeof o['paymentEnabled'] === 'boolean') paymentRequired = paymentRequired || o['paymentEnabled'];

  let servicesIncompleteHint = false;
  const services = o['services'];
  if (Array.isArray(services) && services.length === 0) servicesIncompleteHint = true;
  if (typeof o['shouldSelectService'] === 'boolean' && o['shouldSelectService'] && Array.isArray(services) && services.length === 0)
    servicesIncompleteHint = true;

  const teamMemberUserIds: string[] = [];
  const tm = o['teamMembers'] ?? o['users'] ?? o['userIds'];
  if (Array.isArray(tm)) {
    for (const u of tm) {
      if (typeof u === 'string' && u.trim()) teamMemberUserIds.push(u.trim());
      else if (isRecord(u)) {
        const id = u['userId'] ?? u['id'] ?? u['_id'];
        if (typeof id === 'string' && id.trim()) teamMemberUserIds.push(id.trim());
      }
    }
  }

  let openHoursCount: number | undefined;
  const oh = o['openHours'] ?? o['availability'] ?? o['weeklyHours'] ?? o['businessHours'];
  if (Array.isArray(oh)) openHoursCount = oh.length;
  else if (isRecord(oh)) openHoursCount = Object.keys(oh).length;

  return {
    name,
    calendarType,
    typeRaw,
    isActive,
    status,
    slotDuration,
    slotInterval,
    appointmentsPerSlot,
    preBufferMinutes,
    postBufferMinutes,
    minSchedulingNoticeMinutes,
    bookingWindowStartYmd,
    bookingWindowEndYmd,
    meetingLocationType,
    meetingLocationPresent,
    conflictCheckEnabled,
    googleConflictChecking,
    formIdPresent,
    consentRequired,
    paymentRequired,
    servicesIncompleteHint,
    teamMemberCount: teamMemberUserIds.length,
    teamMemberUserIds,
    openHoursCount,
  };
}

export function formatGhlCalendarDetailSummary(s: GhlCalendarDetailSummary): string {
  const parts: string[] = [];
  if (s.name) parts.push(`Name: ${s.name}`);
  if (s.calendarType) parts.push(`Type: ${s.calendarType}`);
  if (s.isActive !== undefined) parts.push(`Active: ${s.isActive ? 'yes' : 'no'}`);
  if (s.status) parts.push(`Status: ${s.status}`);
  if (s.slotDuration !== undefined) parts.push(`Slot duration (min): ${s.slotDuration}`);
  if (s.slotInterval !== undefined) parts.push(`Slot interval (min): ${s.slotInterval}`);
  if (s.appointmentsPerSlot !== undefined) parts.push(`Appointments/slot: ${s.appointmentsPerSlot}`);
  if (s.preBufferMinutes !== undefined || s.postBufferMinutes !== undefined) {
    parts.push(`Buffer (min): ${s.preBufferMinutes ?? '—'} / ${s.postBufferMinutes ?? '—'}`);
  }
  if (s.minSchedulingNoticeMinutes !== undefined) parts.push(`Min notice (min): ${s.minSchedulingNoticeMinutes}`);
  if (s.bookingWindowStartYmd || s.bookingWindowEndYmd) {
    parts.push(`Booking window: ${s.bookingWindowStartYmd ?? '—'} → ${s.bookingWindowEndYmd ?? '—'}`);
  }
  if (s.teamMemberCount !== undefined) parts.push(`Team members: ${s.teamMemberCount}`);
  if (s.openHoursCount !== undefined) parts.push(`Open hours entries: ${s.openHoursCount}`);
  return parts.join(' · ');
}

/** Normalized availability schedule fields for diagnostics (no secrets). */
export interface GhlAvailabilityScheduleDiagnostics {
  scheduleId?: string;
  timezone?: string;
  rulesCount: number;
  associatedCalendarIds: string[];
}

function collectAssociatedCalendarIdsFromSchedule(o: Record<string, unknown>): string[] {
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'string' && v.trim()) {
      out.push(v.trim());
      return;
    }
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
      return;
    }
    if (isRecord(v)) {
      const id = v['calendarId'] ?? v['id'] ?? v['_id'];
      if (typeof id === 'string' && id.trim()) out.push(id.trim());
    }
  };
  walk(o['calendarIds']);
  walk(o['calendars']);
  walk(o['associatedCalendarIds']);
  walk(o['assignedCalendarIds']);
  return [...new Set(out)];
}

/**
 * Extract schedule timezone, rules count, and calendar associations from GET schedule / search row bodies.
 */
export function extractScheduleDiagnosticsFromPayload(raw: unknown): GhlAvailabilityScheduleDiagnostics | null {
  if (!isRecord(raw)) return null;
  const sch = isRecord(raw['schedule']) ? (raw['schedule'] as Record<string, unknown>) : raw;
  if (!sch || Object.keys(sch).length === 0) return null;
  const scheduleId =
    typeof sch['id'] === 'string' ? sch['id'] : typeof sch['_id'] === 'string' ? sch['_id'] : undefined;
  const timezone = typeof sch['timezone'] === 'string' ? sch['timezone'] : undefined;
  const rules = sch['rules'];
  const rulesCount = Array.isArray(rules) ? rules.length : 0;
  const associatedCalendarIds = collectAssociatedCalendarIdsFromSchedule(sch);
  return { scheduleId, timezone, rulesCount, associatedCalendarIds };
}

function normalizeScheduleSearchRows(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) return raw.filter(isRecord) as Record<string, unknown>[];
  if (!isRecord(raw)) return [];
  for (const key of ['schedules', 'data', 'items', 'results'] as const) {
    const v = raw[key];
    if (Array.isArray(v)) return v.filter(isRecord) as Record<string, unknown>[];
  }
  return [];
}

export interface GhlTagSummary {
  id?: string;
  name: string;
}

export interface BookSlotRequest {
  locationId: string;
  calendarId: string;
  contactId: string;
  startTime: string;
  endTime: string;
  title?: string;
  timezone?: string;
  appointmentStatus?: string;
  /** Customer-visible notes on the appointment (GHL accepts on create). */
  notes?: string;
}

// GHL Client class for connection verification and outbound messaging
export class GhlClient {
  private client: AxiosInstance;
  private locationId: string;
  private accessToken: string;

  constructor(config: GhlClientConfig) {
    this.locationId = config.locationId;
    this.accessToken = config.accessToken;
    this.client = axios.create({
      baseURL: config.baseUrl || 'https://services.leadconnectorhq.com',
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        'Content-Type': 'application/json',
        'Version': '2021-07-28',
      },
      timeout: 10000,
    });
  }

  /**
   * Verify the access token is valid for the given location
   *
   * IMPORTANT - Endpoint Assumptions:
   * This implementation assumes the endpoint is:
   *   GET /locations/{locationId}
   *
   * This assumption needs to be verified against actual GHL Private Integration API.
   * Different GHL API versions or integration types may use different endpoints.
   *
   * TODO: Verify exact endpoint with live GHL Private Integration
   * TODO: Test with actual Private Integration token (not test/sandbox)
   * TODO: Determine if this endpoint requires specific OAuth scope vs PI token scope
   */
  async verifyConnection(): Promise<{ valid: boolean; location?: GhlLocationInfo; error?: string }> {
    try {
      // Endpoint: GET /locations/{locationId} — see extractGhlLocationPayload for response shapes.
      const response = await this.client.get<unknown>(`/locations/${this.locationId}`);

      const requested = normalizeGhlLocationId(this.locationId);
      if (!requested) {
        return { valid: false, error: 'Location ID is required' };
      }

      const payload = extractGhlLocationPayload(response.data);
      if (!payload) {
        return { valid: false, error: 'Location ID mismatch' };
      }

      const idsOnPayload = collectGhlSubAccountIds(payload);
      if (!idsOnPayload.includes(requested)) {
        return { valid: false, error: 'Location ID mismatch' };
      }

      const name = typeof payload['name'] === 'string' ? payload['name'] : '';
      const accountId =
        typeof payload['accountId'] === 'string'
          ? payload['accountId']
          : typeof payload['companyId'] === 'string'
            ? payload['companyId']
            : '';
      const status = typeof payload['status'] === 'string' ? payload['status'] : '';

      return {
        valid: true,
        location: {
          id: requested,
          name,
          accountId,
          status,
        },
      };
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Perform health check on the connection
   * Delegates to verifyConnection - may expand later
   */
  async healthCheck(): Promise<GhlHealthResponse> {
    const result = await this.verifyConnection();

    return {
      success: result.valid,
      locationId: this.locationId,
      accountId: result.location?.accountId,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get location details for display purposes
   * Safe to call - only returns non-secret metadata
   */
  async getLocationInfo(): Promise<GhlLocationInfo | null> {
    try {
      const response = await this.client.get<unknown>(`/locations/${this.locationId}`);
      const requested = normalizeGhlLocationId(this.locationId);
      const payload = extractGhlLocationPayload(response.data);
      if (!requested || !payload || !collectGhlSubAccountIds(payload).includes(requested)) {
        return null;
      }
      const name = typeof payload['name'] === 'string' ? payload['name'] : '';
      const accountId =
        typeof payload['accountId'] === 'string'
          ? payload['accountId']
          : typeof payload['companyId'] === 'string'
            ? payload['companyId']
            : '';
      const status = typeof payload['status'] === 'string' ? payload['status'] : '';
      return { id: requested, name, accountId, status };
    } catch {
      return null;
    }
  }

/**
 * Send an outbound message through GHL.
 *
 * CONFIRMED LIVE — SMS via GHL Private Integration (2026-04-19):
 *   POST /conversations/messages
 *   SMS Request: { contactId, type: "SMS", message, attachments: [], channel: "sms", fromOneToOneConversation: true, locationId }
 *   SMS Response: HTTP 201 — exact field names not yet confirmed; messageId may be "id" or "messageId"
 *   Failure: HTTP 4xx with GHL error body { message? }
 *
 * Other channels (WHATSAPP, FACEBOOK, etc.) are unverified — will return an explicit error.
 */
  async sendMessage(request: GhlSendMessageRequest): Promise<{ success: boolean; messageId?: string; conversationId?: string; error?: string }> {
    const config = getChannelConfig(request.channel);
    if (!config) {
      const supported = Object.keys(CHANNEL_MAP).filter(k => CHANNEL_MAP[k as OutboundChannel] !== null);
      return { success: false, error: `Channel ${request.channel} is not yet verified. Supported: ${supported.join(', ') || 'none'}` };
    }

    try {
      const body = {
        contactId: request.contactId,
        type: config.type,
        message: request.message,
        attachments: config.attachments,
        channel: config.channel,
        fromOneToOneConversation: config.fromOneToOneConversation,
        locationId: request.locationId,
      };
      const response = await this.client.post<{ id?: string; messageId?: string; conversationId: string; status: string; timestamp: string }>(
        '/conversations/messages',
        body,
      );
      if (process.env['NODE_ENV'] !== 'production') {
        this.logger.debug(
          `[SEND_VERIFY] POST /conversations/messages [${request.channel}] — HTTP ${response.status}, messageId=${response.data?.messageId ?? response.data?.id ?? 'unset'}, conversationId=${response.data?.conversationId}`,
        );
      }
      return {
        success: true,
        messageId: response.data?.messageId ?? response.data?.id,
        conversationId: response.data?.conversationId,
      };
    } catch (error) {
      return this.handleSendError(error);
    }
  }

  private logger = {
    debug: (msg: string) => {
      if (process.env['NODE_ENV'] !== 'production') console.debug(msg);
    },
    warn: (msg: string) => {
      if (process.env['NODE_ENV'] !== 'production') console.warn(msg);
    },
  };

  private extractGhlErrorMessage(error: unknown): string | null {
    if (axios.isAxiosError(error)) {
      const data = error.response?.data;
      if (!data) return null;
      if (typeof data === 'string') return data.slice(0, 300);
      if (typeof data === 'object' && data !== null) {
        const obj = data as Record<string, unknown>;
        const msg = obj['message'] ?? obj['error'] ?? obj['code'];
        if (typeof msg === 'string') return msg.slice(0, 300);
      }
    }
    return null;
  }

  private handleSendError(error: unknown): { success: boolean; error: string } {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const ghlMessage = this.extractGhlErrorMessage(error);
      if (process.env['NODE_ENV'] !== 'production') {
        this.logger.debug(`[SEND_VERIFY] POST /conversations/messages — HTTP ${status ?? 'unknown'}, ghlMessage=${ghlMessage ?? 'none'}`);
      }
      if (status === 401) return { success: false, error: 'Invalid or expired token' };
      if (status === 403) return { success: false, error: 'Insufficient permissions for this location' };
      if (status === 404) return { success: false, error: 'Conversation or location not found' };
      if (status === 429) return { success: false, error: 'Rate limited by GHL API' };
      if (status === 422) {
        // 422 Unprocessable Entity — body validation failed
        // Extract structured field first, then fall back to raw body excerpt
        const ghlBody = this.extractGhlErrorMessage(error);
        const rawBody = error.response?.data;
        let bodyExcerpt = ghlBody;
        if (!bodyExcerpt && rawBody !== undefined) {
          // Fall back to raw response body as string (first 500 chars)
          bodyExcerpt = typeof rawBody === 'string'
            ? rawBody.slice(0, 500)
            : JSON.stringify(rawBody).slice(0, 500);
        }
        const note = bodyExcerpt ?? `HTTP ${status}`;
        return { success: false, error: note };
      }
      return { success: false, error: ghlMessage || error.message || 'Send failed' };
    }
    return { success: false, error: 'Unknown error during send' };
  }

  // ---------------------------------------------------------------------------
  // Contact tagging
  // ---------------------------------------------------------------------------

  /**
   * Add tags to a contact.
   *
   * VERIFIED LIVE — GHL Private Integration:
   *   POST https://services.leadconnectorhq.com/contacts/{contactId}/tags
   *   Body: { "tags": ["tag1", "tag2"] }
   *   Success: HTTP 201 (empty body)
   *   Failure: HTTP 4xx with GHL error body
   */
  async tagContact(request: TagContactRequest): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await this.client.post(`/contacts/${request.contactId}/tags`, {
        tags: request.tags,
      });
      if (process.env['NODE_ENV'] !== 'production') {
        console.debug(
          `[TAG_VERIFY] POST /contacts/${request.contactId}/tags — HTTP ${response.status}, tagCount=${request.tags.length}`,
        );
      }
      return { success: true };
    } catch (error) {
      return this.handleTagError(error, request.contactId);
    }
  }

  private handleTagError(error: unknown, contactId?: string): { success: boolean; error: string } {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const reason = process.env['NODE_ENV'] !== 'production'
        ? `[TAG_VERIFY] POST /contacts/${contactId ?? '?'}/tags — HTTP ${status}`
        : undefined;
      if (status === 401) {
        return { success: false, error: 'Invalid or expired token' };
      }
      if (status === 403) {
        return { success: false, error: 'Insufficient permissions for this location' };
      }
      if (status === 404) {
        return { success: false, error: 'Contact not found' };
      }
      if (status === 429) {
        return { success: false, error: 'Rate limited by GHL API' };
      }
      // Log non-standard errors in dev only — no raw tokens/payloads
      if (process.env['NODE_ENV'] !== 'production' && reason) {
        console.debug(`${reason}, error=${error.message || 'unknown'}`);
      }
      return { success: false, error: error.message || 'Tag operation failed' };
    }
    return { success: false, error: 'Unknown error during tag operation' };
  }

  // ---------------------------------------------------------------------------
  // Booking / Calendar
  // ---------------------------------------------------------------------------

  /**
   * Book an appointment slot on a GHL calendar.
   *
   * CONFIRMED LIVE — GHL Private Integration:
   *   POST https://services.leadconnectorhq.com/calendars/events/appointments
   *   Body: { locationId, calendarId, contactId, startTime, endTime, title?, timezone?, appointmentStatus? }
   *   Success: HTTP 201 with appointment JSON { id, ... }
   *   Failure: HTTP 4xx with GHL error body { message: "..." }
   */
  async bookSlot(request: BookSlotRequest): Promise<{ success: boolean; appointmentId?: string; error?: string }> {
    try {
      const response = await this.client.post('/calendars/events/appointments', {
        locationId: request.locationId,
        calendarId: request.calendarId,
        contactId: request.contactId,
        startTime: request.startTime,
        endTime: request.endTime,
        title: request.title,
        timezone: request.timezone,
        appointmentStatus: request.appointmentStatus,
        ...(request.notes?.trim() ? { notes: request.notes.trim() } : {}),
      });
      if (process.env['NODE_ENV'] !== 'production') {
        console.debug(
          `[BOOK_VERIFY] POST /calendars/events/appointments — HTTP ${response.status}, appointmentId=${response.data?.id ?? 'unknown'}`,
        );
      }
      return { success: true, appointmentId: response.data?.id };
    } catch (error) {
      return this.handleBookingError(error);
    }
  }

  private handleBookingError(error: unknown): { success: boolean; error: string } {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      if (process.env['NODE_ENV'] !== 'production') {
        console.debug(`[BOOK_VERIFY] POST /calendars/events/appointments — HTTP ${status ?? 'unknown'}`);
      }
      // Try to extract structured GHL error from response body
      const ghlMessage = this.extractGhlErrorMessage(error);
      if (status === 401) return { success: false, error: 'Invalid or expired token' };
      if (status === 403) return { success: false, error: 'Insufficient permissions for this location' };
      if (status === 404) return { success: false, error: 'Contact, calendar, or location not found' };
      if (status === 429) return { success: false, error: 'Rate limited by GHL API' };
      return { success: false, error: ghlMessage || error.message || 'Booking failed' };
    }
    return { success: false, error: 'Unknown error during booking' };
  }

  /**
   * Search for an existing contact in a location by phone (POST /contacts/search).
   * Returns a minimal row when a digit match is found (or a single search hit for short numbers).
   */
  async findContactByPhone(
    locationId: string,
    phone: string,
  ): Promise<{ success: boolean; contact?: GhlContactPhoneLookup; error?: string }> {
    const loc = locationId.trim();
    const q = phone.trim();
    if (!loc || !q) return { success: false, error: 'locationId and phone required' };
    const targetDigits = digitsOnlyPhone(q);
    try {
      const response = await this.client.post<unknown>('/contacts/search', {
        locationId: loc,
        query: q,
        pageLimit: 20,
      });
      const rows = extractContactsSearchRows(response.data);
      const picked = pickContactByPhoneDigits(rows, targetDigits);
      if (picked) return { success: true, contact: picked };
      return { success: true, contact: undefined };
    } catch (error) {
      return { success: false, error: this.extractGhlErrorMessage(error) ?? 'findContactByPhone failed' };
    }
  }

  /**
   * Fetch a contact by id (Private Integration — endpoint shape may vary; failures are non-fatal for callers).
   */
  async getContact(contactId: string): Promise<{ success: boolean; contact?: Record<string, unknown>; error?: string }> {
    const id = contactId.trim();
    if (!id) return { success: false, error: 'contactId required' };
    try {
      const response = await this.client.get<unknown>(`/contacts/${encodeURIComponent(id)}`);
      const raw = response.data;
      let c: Record<string, unknown> | undefined;
      if (isRecord(raw) && isRecord(raw['contact'])) c = raw['contact'] as Record<string, unknown>;
      else if (isRecord(raw)) c = raw;
      return { success: true, contact: c };
    } catch (error) {
      return { success: false, error: this.extractGhlErrorMessage(error) ?? 'getContact failed' };
    }
  }

  /**
   * Update an existing contact (partial updates — omit keys you do not want to change).
   * Best-effort: callers should catch/log and not fail primary flows.
   */
  async updateContact(
    contactId: string,
    payload: Record<string, unknown>,
  ): Promise<{ success: boolean; error?: string }> {
    const id = contactId.trim();
    if (!id) return { success: false, error: 'contactId required' };
    try {
      await this.client.put(`/contacts/${encodeURIComponent(id)}`, payload);
      return { success: true };
    } catch (error) {
      return { success: false, error: this.extractGhlErrorMessage(error) ?? 'updateContact failed' };
    }
  }

  /**
   * Create a contact in the current location.
   */
  async createContact(payload: Record<string, unknown>): Promise<{ success: boolean; contactId?: string; error?: string }> {
    try {
      const response = await this.client.post<unknown>('/contacts/', {
        locationId: this.locationId,
        ...payload,
      });
      const raw = response.data;
      let cid: string | undefined;
      if (isRecord(raw)) {
        if (typeof raw['id'] === 'string') cid = raw['id'];
        else if (isRecord(raw['contact']) && typeof raw['contact']['id'] === 'string') {
          cid = raw['contact']['id'] as string;
        }
      }
      return { success: true, contactId: cid };
    } catch (error) {
      return { success: false, error: this.extractGhlErrorMessage(error) ?? 'createContact failed' };
    }
  }

  /**
   * Append an internal note on a contact (best-effort; API path may differ by GHL version).
   */
  async addContactNote(contactId: string, body: string): Promise<{ success: boolean; error?: string }> {
    const id = contactId.trim();
    const text = body.trim();
    if (!id) return { success: false, error: 'contactId required' };
    if (!text) return { success: false, error: 'empty note' };
    try {
      await this.client.post(`/contacts/${encodeURIComponent(id)}/notes`, { body: text });
      return { success: true };
    } catch (error) {
      return { success: false, error: this.extractGhlErrorMessage(error) ?? 'addContactNote failed' };
    }
  }

  /**
   * Update appointment notes after create (best-effort; endpoint may 404 on some API versions).
   */
  async updateAppointmentNotes(
    appointmentId: string,
    notes: string,
  ): Promise<{ success: boolean; error?: string }> {
    const aid = appointmentId.trim();
    const n = notes.trim();
    if (!aid) return { success: false, error: 'appointmentId required' };
    if (!n) return { success: false, error: 'empty notes' };
    try {
      await this.client.put(`/calendars/events/appointments/${encodeURIComponent(aid)}`, { notes: n });
      return { success: true };
    } catch (error) {
      return { success: false, error: this.extractGhlErrorMessage(error) ?? 'updateAppointmentNotes failed' };
    }
  }

  /**
   * Cancel a calendar appointment/event by id.
   * GHL: DELETE /calendars/events/{eventId} with empty JSON body.
   */
  async cancelCalendarEvent(eventId: string): Promise<{ success: boolean; error?: string }> {
    const id = eventId.trim();
    if (!id) return { success: false, error: 'eventId required' };
    try {
      await this.client.delete(`/calendars/events/${encodeURIComponent(id)}`, { data: {} });
      return { success: true };
    } catch (error) {
      if (axios.isAxiosError(error) && (error.response?.status === 404 || error.response?.status === 400)) {
        try {
          await this.client.delete(`/calendars/events/appointments/${encodeURIComponent(id)}`, { data: {} });
          return { success: true };
        } catch (error2) {
          return {
            success: false,
            error: this.extractGhlErrorMessage(error2) ?? 'cancelCalendarEvent failed',
          };
        }
      }
      return { success: false, error: this.extractGhlErrorMessage(error) ?? 'cancelCalendarEvent failed' };
    }
  }

  /**
   * List calendars for the location.
   * HighLevel: `GET /calendars/?locationId=...` with `Version: 2023-02-21`, `Accept: application/json`.
   */
  async listCalendars(): Promise<ListCalendarsResult> {
    const requestPath = '/calendars/';
    const baseURL = String(this.client.defaults.baseURL ?? '').replace(/\/$/, '');
    const apiVersion = GHL_CALENDARS_LIST_API_VERSION;

    if (process.env['NODE_ENV'] !== 'production') {
      const outboundUrlNoToken = `${baseURL}${requestPath}?locationId=${encodeURIComponent(this.locationId)}`;
      console.debug(
        `[GHL] calendar list outbound (no token): GET ${outboundUrlNoToken} Version=${apiVersion}`,
      );
    }

    try {
      const response = await this.client.get<unknown>(requestPath, {
        params: { locationId: this.locationId },
        headers: {
          Version: GHL_CALENDARS_LIST_API_VERSION,
          Accept: 'application/json',
        },
      });
      const calendars = normalizeGhlCalendarListResponse(response.data);
      return { calendars, requestPath };
    } catch (error) {
      let httpStatus: number | undefined;
      let responseBodyExcerpt: string | undefined;
      const msg =
        this.extractGhlErrorMessage(error) ?? (error instanceof Error ? error.message : 'listCalendars failed');
      if (axios.isAxiosError(error)) {
        httpStatus = error.response?.status;
        const d = error.response?.data;
        if (d !== undefined) {
          responseBodyExcerpt = typeof d === 'string' ? d.slice(0, 500) : JSON.stringify(d).slice(0, 500);
        }
        if (process.env['NODE_ENV'] !== 'production') {
          console.debug(
            `[GHL] listCalendars error path=${requestPath} status=${httpStatus ?? '?'} excerpt=${(responseBodyExcerpt ?? '').slice(0, 200)}`,
          );
        }
      }
      return {
        calendars: [],
        error: msg,
        httpStatus,
        responseBodyExcerpt,
        requestPath,
      };
    }
  }

  /**
   * Single calendar detail (team members, slot duration, etc.).
   * HighLevel: `GET /calendars/:calendarId` with `Version: 2023-02-21`.
   */
  async getCalendar(calendarId: string): Promise<{
    summary?: GhlCalendarDetailSummary;
    error?: string;
    httpStatus?: number;
    responseBodyExcerpt?: string;
    requestPath?: string;
  }> {
    const requestPath = `/calendars/${encodeURIComponent(calendarId)}`;
    try {
      const response = await this.client.get<unknown>(requestPath, {
        headers: {
          Version: GHL_CALENDARS_LIST_API_VERSION,
          Accept: 'application/json',
        },
      });
      const raw = response.data;
      let payload: Record<string, unknown> | null = null;
      if (isRecord(raw) && isRecord(raw['calendar'])) {
        payload = raw['calendar'] as Record<string, unknown>;
      } else if (isRecord(raw)) {
        payload = raw;
      }
      if (!payload) {
        return { summary: undefined, requestPath, httpStatus: response.status };
      }
      return {
        summary: extractCalendarDetailSummary(payload),
        requestPath,
        httpStatus: response.status,
      };
    } catch (error) {
      let httpStatus: number | undefined;
      let responseBodyExcerpt: string | undefined;
      const msg =
        this.extractGhlErrorMessage(error) ?? (error instanceof Error ? error.message : 'getCalendar failed');
      if (axios.isAxiosError(error)) {
        httpStatus = error.response?.status;
        const d = error.response?.data;
        if (d !== undefined) {
          responseBodyExcerpt = typeof d === 'string' ? d.slice(0, 500) : JSON.stringify(d).slice(0, 500);
        }
      }
      return { error: msg, httpStatus, responseBodyExcerpt, requestPath };
    }
  }

  /**
   * Search user availability schedules (location / optional calendar / optional user).
   * HighLevel: `GET /calendars/schedules/search` with `Version: 2023-02-21`.
   * Note: Official docs may mark `userId` as required; pass a team user id when possible.
   */
  async searchAvailabilitySchedules(params: {
    locationId: string;
    calendarId?: string;
    userId?: string;
    skip?: number;
    limit?: number;
  }): Promise<{
    schedules: GhlAvailabilityScheduleDiagnostics[];
    error?: string;
    httpStatus?: number;
    requestPath: string;
  }> {
    const requestPath = '/calendars/schedules/search';
    const query: Record<string, string | number> = {
      locationId: params.locationId.trim(),
      skip: params.skip ?? 0,
      limit: Math.min(500, Math.max(1, params.limit ?? 50)),
    };
    if (params.calendarId?.trim()) query['calendarId'] = params.calendarId.trim();
    if (params.userId?.trim()) query['userId'] = params.userId.trim();

    try {
      const response = await this.client.get<unknown>(requestPath, {
        params: query,
        headers: {
          Version: GHL_CALENDARS_LIST_API_VERSION,
          Accept: 'application/json',
        },
      });
      const rows = normalizeScheduleSearchRows(response.data);
      const schedules: GhlAvailabilityScheduleDiagnostics[] = [];
      for (const row of rows) {
        const d = extractScheduleDiagnosticsFromPayload(row);
        if (d) schedules.push(d);
      }
      return { schedules, httpStatus: response.status, requestPath };
    } catch (error) {
      let httpStatus: number | undefined;
      let msg =
        this.extractGhlErrorMessage(error) ?? (error instanceof Error ? error.message : 'searchAvailabilitySchedules failed');
      if (axios.isAxiosError(error)) {
        httpStatus = error.response?.status;
      }
      return { schedules: [], error: msg, httpStatus, requestPath };
    }
  }

  /** Alias aligned with GHL docs wording (`listAvailabilitySchedules`). */
  async listAvailabilitySchedules(
    locationId: string,
    calendarId?: string,
    userId?: string,
  ): Promise<{
    schedules: GhlAvailabilityScheduleDiagnostics[];
    error?: string;
    httpStatus?: number;
    requestPath: string;
  }> {
    return this.searchAvailabilitySchedules({ locationId, calendarId, userId });
  }

  /**
   * Event-calendar availability schedule for a specific calendar.
   * HighLevel: `GET /calendars/schedules/event-calendar/:calendarId`
   */
  async getEventCalendarSchedule(calendarId: string): Promise<{
    found: boolean;
    diagnostics?: GhlAvailabilityScheduleDiagnostics;
    error?: string;
    httpStatus?: number;
    requestPath: string;
  }> {
    const requestPath = `/calendars/schedules/event-calendar/${encodeURIComponent(calendarId)}`;
    try {
      const response = await this.client.get<unknown>(requestPath, {
        headers: {
          Version: GHL_CALENDARS_LIST_API_VERSION,
          Accept: 'application/json',
        },
      });
      const diagnostics = extractScheduleDiagnosticsFromPayload(response.data) ?? undefined;
      const found = response.status === 200 && diagnostics !== undefined;
      return { found, diagnostics, httpStatus: response.status, requestPath };
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return { found: false, httpStatus: 404, requestPath };
      }
      let httpStatus: number | undefined;
      const msg =
        this.extractGhlErrorMessage(error) ?? (error instanceof Error ? error.message : 'getEventCalendarSchedule failed');
      if (axios.isAxiosError(error)) {
        httpStatus = error.response?.status;
      }
      return { found: false, error: msg, httpStatus, requestPath };
    }
  }

  /**
   * Single availability schedule by id (rules, timezone, calendar associations).
   * HighLevel: `GET /calendars/schedules/:id` (locationId query per docs).
   */
  async getAvailabilitySchedule(
    scheduleId: string,
    locationId: string,
  ): Promise<{
    diagnostics?: GhlAvailabilityScheduleDiagnostics;
    error?: string;
    httpStatus?: number;
    requestPath: string;
  }> {
    const requestPath = `/calendars/schedules/${encodeURIComponent(scheduleId)}`;
    try {
      const response = await this.client.get<unknown>(requestPath, {
        params: { locationId: locationId.trim() },
        headers: {
          Version: GHL_CALENDARS_LIST_API_VERSION,
          Accept: 'application/json',
        },
      });
      const diagnostics = extractScheduleDiagnosticsFromPayload(response.data) ?? undefined;
      return { diagnostics, httpStatus: response.status, requestPath };
    } catch (error) {
      let httpStatus: number | undefined;
      const msg =
        this.extractGhlErrorMessage(error) ?? (error instanceof Error ? error.message : 'getAvailabilitySchedule failed');
      if (axios.isAxiosError(error)) {
        httpStatus = error.response?.status;
      }
      return { error: msg, httpStatus, requestPath };
    }
  }

  /**
   * `backend.leadconnectorhq.com` widget-style free-slots (browser capture). No cookies; optional bearer only when `useBearer`.
   */
  async executeLeadConnectorWidgetFreeSlots(opts: {
    calendarId: string;
    startDateMs: number;
    endDateMs: number;
    timezone: string;
    sendSeatsPerSlot: boolean;
    versionHeader: string;
    channelHeader: string;
    sourceHeader: string;
    useBearer: boolean;
    probeRangeMode: GhlFreeSlotsProbeRangeMode;
    slotDurationMinutes?: number | null;
  }): Promise<GhlFreeSlotsVariantExecution> {
    const requestPath = `/calendars/${encodeURIComponent(opts.calendarId)}/free-slots`;
    const query: Record<string, string> = {
      startDate: String(Math.floor(opts.startDateMs)),
      endDate: String(Math.floor(opts.endDateMs)),
      timezone: opts.timezone.trim(),
      sendSeatsPerSlot: opts.sendSeatsPerSlot ? 'true' : 'false',
    };

    const headers: Record<string, string> = {
      Version: opts.versionHeader.trim(),
      Channel: opts.channelHeader.trim(),
      Source: opts.sourceHeader.trim(),
      Accept: '*/*',
      Timezone: opts.timezone.trim(),
    };
    if (opts.useBearer && this.accessToken.trim()) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    const inst = axios.create({
      baseURL: GHL_WIDGET_BACKEND_BASE_URL,
      headers,
      timeout: 25000,
      withCredentials: false,
    });

    try {
      const response = await inst.get<unknown>(requestPath, { params: query });
      const parsed = parseGhlFreeSlotsResponse(response.data, {
        slotDurationMinutes: opts.slotDurationMinutes,
      });
      return {
        slots: parsed.slots,
        dateKeys: parsed.dateKeys,
        shapeSummary: parsed.shapeSummary,
        rawResponseShape: parsed.rawResponseShape,
        rawIsoStringCount: parsed.rawIsoStringCount,
        parsedSlotsReturned: parsed.slots.length,
        httpStatus: response.status,
        requestPath,
        requestQuery: query,
        hostMode: 'leadconnectorBackendWidget',
        probeRangeMode: opts.probeRangeMode,
        sendSeatsPerSlot: opts.sendSeatsPerSlot,
        versionHeader: opts.versionHeader.trim(),
        channelHeader: opts.channelHeader.trim(),
        sourceHeader: opts.sourceHeader.trim(),
      };
    } catch (error) {
      let httpStatus: number | undefined;
      let responseBodyExcerpt: string | undefined;
      if (axios.isAxiosError(error)) {
        httpStatus = error.response?.status;
        const d = error.response?.data;
        if (d !== undefined) {
          responseBodyExcerpt = typeof d === 'string' ? d.slice(0, 500) : JSON.stringify(d).slice(0, 500);
        }
      }
      const msg = this.extractGhlErrorMessage(error) ?? (error instanceof Error ? error.message : 'widget free-slots failed');
      return {
        slots: [],
        dateKeys: [],
        shapeSummary: 'requestError',
        rawResponseShape: 'requestError',
        rawIsoStringCount: 0,
        parsedSlotsReturned: 0,
        error: msg,
        httpStatus,
        responseBodyExcerpt,
        requestPath,
        requestQuery: query,
        hostMode: 'leadconnectorBackendWidget',
        probeRangeMode: opts.probeRangeMode,
        sendSeatsPerSlot: opts.sendSeatsPerSlot,
        versionHeader: opts.versionHeader.trim(),
        channelHeader: opts.channelHeader.trim(),
        sourceHeader: opts.sourceHeader.trim(),
      };
    }
  }

  /**
   * Diagnostic: widget-compatible **full selected month** in CRM timezone (Chrome network capture shape).
   */
  async executeWidgetCompatibleMonthRangeProbe(params: {
    calendarId: string;
    selectedDateYmd: string;
    crmTimezone: string;
    usePrivateIntegrationBearer?: boolean;
    slotDurationMinutes?: number | null;
  }): Promise<GhlFreeSlotsVariantExecution> {
    const { startMs, endMs } = crmMonthStartEndMsInclusive(params.crmTimezone, params.selectedDateYmd);
    return this.executeLeadConnectorWidgetFreeSlots({
      calendarId: params.calendarId,
      startDateMs: startMs,
      endDateMs: endMs,
      timezone: params.crmTimezone,
      sendSeatsPerSlot: false,
      versionHeader: '2021-04-15',
      channelHeader: 'APP',
      sourceHeader: 'WEB_USER',
      useBearer: params.usePrivateIntegrationBearer ?? false,
      probeRangeMode: 'month',
      slotDurationMinutes: params.slotDurationMinutes,
    });
  }

  /**
   * Execute one free-slots GET with an explicit request variant (probe / advanced).
   * `startDate` / `endDate` are formatted per `timestampUnit` (ms vs seconds since epoch).
   */
  async executeFreeSlotsVariant(params: {
    calendarId: string;
    startDateMs: number;
    endDateMs: number;
    timezone?: string;
    teamUserId?: string | null;
    apiVersion: string;
    timestampUnit: GhlFreeSlotsTimestampUnit;
    userParamMode: GhlFreeSlotsUserParamMode;
    includeTimezone: boolean;
    variantMeta?: { probeRangeMode?: GhlFreeSlotsProbeRangeMode };
  }): Promise<GhlFreeSlotsVariantExecution> {
    const requestPath = `/calendars/${encodeURIComponent(params.calendarId)}/free-slots`;
    const query: Record<string, string> = {
      startDate: formatFreeSlotsTimestamp(params.startDateMs, params.timestampUnit),
      endDate: formatFreeSlotsTimestamp(params.endDateMs, params.timestampUnit),
    };
    const tz = params.timezone?.trim();
    if (params.includeTimezone && tz) query['timezone'] = tz;
    const uid = params.teamUserId?.trim();
    if (params.userParamMode === 'userId' && uid) query['userId'] = uid;
    if (params.userParamMode === 'userIds' && uid) query['userIds'] = uid;

    const versionHeader = params.apiVersion.trim() || GHL_CALENDARS_LIST_API_VERSION;
    const baseMeta = {
      hostMode: 'servicesApi' as const,
      probeRangeMode: params.variantMeta?.probeRangeMode,
      sendSeatsPerSlot: false,
      versionHeader,
    };

    try {
      const response = await this.client.get<unknown>(requestPath, {
        params: query,
        headers: {
          Version: versionHeader,
          Accept: 'application/json',
        },
      });
      const parsed = parseGhlFreeSlotsResponse(response.data);
      return {
        slots: parsed.slots,
        dateKeys: parsed.dateKeys,
        shapeSummary: parsed.shapeSummary,
        rawResponseShape: parsed.rawResponseShape,
        rawIsoStringCount: parsed.rawIsoStringCount,
        parsedSlotsReturned: parsed.slots.length,
        httpStatus: response.status,
        requestPath,
        requestQuery: query,
        ...baseMeta,
      };
    } catch (error) {
      let httpStatus: number | undefined;
      let responseBodyExcerpt: string | undefined;
      if (axios.isAxiosError(error)) {
        httpStatus = error.response?.status;
        const d = error.response?.data;
        if (d !== undefined) {
          responseBodyExcerpt = typeof d === 'string' ? d.slice(0, 500) : JSON.stringify(d).slice(0, 500);
        }
      }
      const msg = this.extractGhlErrorMessage(error) ?? (error instanceof Error ? error.message : 'getFreeSlots failed');
      return {
        slots: [],
        dateKeys: [],
        shapeSummary: 'requestError',
        rawResponseShape: 'requestError',
        rawIsoStringCount: 0,
        parsedSlotsReturned: 0,
        error: msg,
        httpStatus,
        responseBodyExcerpt,
        requestPath,
        requestQuery: query,
        ...baseMeta,
      };
    }
  }

  /**
   * Fetch free bookable slots for a calendar in a time range (production defaults).
   *
   * Shape is controlled by `resolveGhlFreeSlotsProductionSpec()` / env vars.
   * GHL expects `startDate` and `endDate` as Unix timestamps (typically **milliseconds**; some accounts need **seconds** — use probe + env).
   */
  async getFreeSlots(params: {
    calendarId: string;
    startDateMs: number;
    endDateMs: number;
    timezone?: string;
    userId?: string;
  }): Promise<GhlFreeSlotsVariantExecution> {
    const prod = resolveGhlFreeSlotsProductionSpec();
    const tzFull = (params.timezone ?? '').trim();

    if (prod.hostMode === 'widget_backend') {
      if (!tzFull) {
        return {
          slots: [],
          dateKeys: [],
          shapeSummary: 'noTimezone',
          error: 'timezone is required for widget_backend free-slots',
          requestPath: `/calendars/${encodeURIComponent(params.calendarId)}/free-slots`,
          requestQuery: {},
          hostMode: 'leadconnectorBackendWidget',
          sendSeatsPerSlot: prod.sendSeatsPerSlot,
          versionHeader: prod.apiVersion,
          channelHeader: prod.channel,
          sourceHeader: prod.source,
        };
      }
      const { queryStartMs, queryEndMs } = computeWidgetFreeSlotsQueryRange(
        prod.rangeMode,
        tzFull,
        params.startDateMs,
      );
      const probeRangeMode: GhlFreeSlotsProbeRangeMode =
        prod.rangeMode === 'month' ? 'month' : prod.rangeMode === 'day' ? 'fullLocalDay' : 'selectedToDayEnd';
      const raw = await this.executeLeadConnectorWidgetFreeSlots({
        calendarId: params.calendarId,
        startDateMs: queryStartMs,
        endDateMs: queryEndMs,
        timezone: tzFull,
        sendSeatsPerSlot: prod.sendSeatsPerSlot,
        versionHeader: prod.apiVersion,
        channelHeader: prod.channel,
        sourceHeader: prod.source,
        useBearer: prod.widgetRequestUsesBearer,
        probeRangeMode,
      });
      if (raw.error) return raw;
      const filtered = filterFreeSlotsToUtcWindow(raw.slots, params.startDateMs, params.endDateMs);
      const availabilityNote =
        prod.rangeMode === 'month' && filtered.length > 0
          ? 'CRM returned slots using widget-compatible month range.'
          : undefined;
      return {
        ...raw,
        slots: filtered,
        filteredToRequestWindow: prod.rangeMode === 'month' || filtered.length !== raw.slots.length,
        availabilityNote,
      };
    }

    const hasUser = Boolean(params.userId?.trim());
    const userParamMode: GhlFreeSlotsUserParamMode = hasUser
      ? prod.retryAddsUserAs === 'userIds'
        ? 'userIds'
        : 'userId'
      : 'none';
    const tz = prod.includeTimezoneQuery ? tzFull || undefined : undefined;
    return this.executeFreeSlotsVariant({
      calendarId: params.calendarId,
      startDateMs: params.startDateMs,
      endDateMs: params.endDateMs,
      timezone: tz,
      teamUserId: params.userId ?? null,
      apiVersion: prod.apiVersion,
      timestampUnit: prod.timestampUnit,
      userParamMode,
      includeTimezone: prod.includeTimezoneQuery,
    });
  }

  /**
   * List tags available for the location (for dropdowns / validation).
   *
   * NOT YET LIVE-VERIFIED — common pattern: `GET /locations/:locationId/tags`.
   */
  async listTags(): Promise<{ tags: GhlTagSummary[]; error?: string }> {
    try {
      const response = await this.client.get<unknown>(`/locations/${encodeURIComponent(this.locationId)}/tags`);
      const raw = response.data;
      const tags: GhlTagSummary[] = [];
      const pushTag = (o: Record<string, unknown>) => {
        const name = typeof o['name'] === 'string' ? o['name'] : '';
        const id = typeof o['id'] === 'string' ? o['id'] : undefined;
        if (name) tags.push({ id, name });
      };
      if (Array.isArray(raw)) {
        for (const x of raw) {
          if (isRecord(x)) pushTag(x);
        }
      } else if (isRecord(raw)) {
        const list = raw['tags'] ?? raw['data'];
        if (Array.isArray(list)) {
          for (const x of list) {
            if (isRecord(x)) pushTag(x);
          }
        }
      }
      return { tags };
    } catch (error) {
      const msg = this.extractGhlErrorMessage(error) ?? (error instanceof Error ? error.message : 'listTags failed');
      return { tags: [], error: msg };
    }
  }

  /**
   * Create a tag on the location (if API permits).
   *
   * NOT YET LIVE-VERIFIED — typical: `POST /locations/:locationId/tags` with `{ name }`.
   */
  async createTag(name: string): Promise<{ success: boolean; tag?: GhlTagSummary; error?: string }> {
    const trimmed = name.trim();
    if (!trimmed) return { success: false, error: 'Tag name is required' };
    try {
      const response = await this.client.post<unknown>(
        `/locations/${encodeURIComponent(this.locationId)}/tags`,
        { name: trimmed },
      );
      const raw = response.data;
      if (isRecord(raw)) {
        const n = typeof raw['name'] === 'string' ? raw['name'] : trimmed;
        const id = typeof raw['id'] === 'string' ? raw['id'] : undefined;
        return { success: true, tag: { id, name: n } };
      }
      return { success: true, tag: { name: trimmed } };
    } catch (error) {
      const msg = this.extractGhlErrorMessage(error) ?? (error instanceof Error ? error.message : 'createTag failed');
      return { success: false, error: msg };
    }
  }

  /**
   * Delete a tag from the location.
   *
   * Typical: `DELETE /locations/:locationId/tags/:tagId` — verify against your GHL API version.
   */
  async deleteTag(tagId: string): Promise<{ success: boolean; error?: string; notSupported?: boolean }> {
    const id = tagId.trim();
    if (!id) return { success: false, error: 'Tag id is required' };
    try {
      await this.client.delete(`/locations/${encodeURIComponent(this.locationId)}/tags/${encodeURIComponent(id)}`);
      return { success: true };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const msg = this.extractGhlErrorMessage(error) ?? (error instanceof Error ? error.message : 'deleteTag failed');
        if (status === 405) {
          return { success: false, error: msg, notSupported: true };
        }
        if (status === 404) {
          const low = msg.toLowerCase();
          if (low.includes('cannot') && low.includes('delete')) {
            return { success: false, error: msg, notSupported: true };
          }
        }
        return { success: false, error: msg };
      }
      return { success: false, error: 'Unknown error during delete tag' };
    }
  }

  /**
   * Normalize error for safe handling
   */
  private handleError(error: unknown): { valid: boolean; error: string } {
    if (axios.isAxiosError(error)) {
      if (error.response?.status === 401) {
        return { valid: false, error: 'Invalid or expired token' };
      }
      if (error.response?.status === 403) {
        return { valid: false, error: 'Insufficient permissions for this location' };
      }
      if (error.response?.status === 404) {
        return { valid: false, error: 'Location not found' };
      }
      return { valid: false, error: error.message || 'API request failed' };
    }
    return { valid: false, error: 'Unknown error occurred' };
  }

  /**
   * Get masked token for logging
   * Never log actual tokens - this is for debugging/monitoring only
   */
  getMaskedToken(): string {
    if (!this.locationId || this.locationId.length <= 8) {
      return '****';
    }
    return this.locationId.substring(0, 4) + '...' + this.locationId.substring(this.locationId.length - 4);
  }
}

// Factory function to create client
export function createGhlClient(
  accessToken: string,
  locationId: string
): GhlClient {
  return new GhlClient({
    baseUrl: resolveGhlApiBaseUrl(process.env['GHL_API_BASE_URL']),
    accessToken,
    locationId,
  });
}

// Re-export GhlConnectionStatus from Prisma for use in backend services
export type GhlConnectionStatus = 'DISCONNECTED' | 'CONNECTED' | 'INVALID' | 'ERROR';

// Safe error factory
export function createGhlApiError(code: string, message: string, status: number): GhlApiError {
  return { code, message, status };
}

// Export types for use in other packages
// (Types are already exported via their inline interface declarations above)




