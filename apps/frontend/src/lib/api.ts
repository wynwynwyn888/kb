// API client for frontend - communicates with backend API

/**
 * API base for browser `fetch`. Always same-origin `/api/v1` so requests hit the Next `app/api/v1/*` BFF
 * and are proxied to Nest (see `app/api/v1/tenants/route.ts` and `app/api/v1/[[...path]]/route.ts`).
 */
export function getApiBaseUrl(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}/api/v1`;
  }
  const internal = process.env['INTERNAL_API_URL']?.replace(/\/$/, '').trim();
  if (internal) return internal;
  const base = (process.env['BACKEND_DEV_URL'] || process.env['BACKEND_URL'] || 'http://127.0.0.1:3001').replace(
    /\/$/,
    '',
  );
  return `${base}/api/v1`;
}

/** Browser event when API returns 401 — session listener logs out and redirects to login. */
export const API_UNAUTHORIZED_EVENT = 'aisbp:unauthorized';

export class ApiHttpError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = 'ApiHttpError';
    this.status = status;
    this.body = body;
  }
}

export function isApiHttpError(e: unknown): e is ApiHttpError {
  return e instanceof ApiHttpError;
}

interface ApiOptions extends RequestInit {
  token?: string;
  /** Abort the request after this many ms (browser fetch otherwise can hang if the API proxy waits on a dead backend). */
  timeoutMs?: number;
}

/** Combine optional caller `signal` with a timeout so `fetch` always settles. */
function abortSignalForTimeout(timeoutMs: number, existing?: AbortSignal): { signal: AbortSignal; cancel: () => void } {
  const c = new AbortController();
  const tid = setTimeout(() => c.abort(), timeoutMs);
  const cancel = () => {
    clearTimeout(tid);
    if (existing) existing.removeEventListener('abort', onExisting);
  };
  const onExisting = () => {
    clearTimeout(tid);
    c.abort();
  };
  if (existing) {
    if (existing.aborted) {
      clearTimeout(tid);
      c.abort();
      return { signal: c.signal, cancel };
    }
    existing.addEventListener('abort', onExisting);
  }
  return { signal: c.signal, cancel };
}

async function apiRequest<T>(endpoint: string, options: ApiOptions = {}): Promise<T> {
  const { token, timeoutMs, signal: outerSignalRaw, ...fetchOptions } = options;
  const outerSignal = outerSignalRaw ?? undefined;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((fetchOptions.headers as Record<string, string>) || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  let cancelTimeout: (() => void) | undefined;
  let signal: AbortSignal | undefined = outerSignal;
  if (typeof timeoutMs === 'number' && timeoutMs > 0) {
    const w = abortSignalForTimeout(timeoutMs, outerSignal);
    signal = w.signal;
    cancelTimeout = w.cancel;
  }

  let response: Response;
  try {
    response = await fetch(`${getApiBaseUrl()}${endpoint}`, {
      ...fetchOptions,
      // Avoid HTTP cache of authenticated GETs (e.g. agency AI rehydrate after save).
      cache: fetchOptions.cache ?? 'no-store',
      headers,
      signal,
    });
  } finally {
    cancelTimeout?.();
  }

  if (!response.ok) {
    const status = response.status;
    if (status === 401 && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(API_UNAUTHORIZED_EVENT));
    }

    const errorJson = await response.json().catch(() => ({ message: 'Request failed' }));
    let msg = 'Request failed';
    if (typeof errorJson === 'object' && errorJson !== null && 'message' in errorJson) {
      const m = (errorJson as { message?: unknown }).message;
      if (m !== undefined && m !== null && String(m).trim() !== '') msg = String(m);
      else msg = `HTTP ${status}`;
    } else {
      msg = `HTTP ${status}`;
    }
    const hint =
      typeof errorJson === 'object' && errorJson !== null && 'hint' in errorJson
        ? String((errorJson as { hint?: unknown }).hint ?? '').trim()
        : '';
    if (hint) msg = `${msg} ${hint}`;
    throw new ApiHttpError(status, msg, errorJson);
  }

  return response.json() as Promise<T>;
}

/** DELETE / 204 No Content — no response body. */
async function apiRequestNoContent(endpoint: string, options: ApiOptions = {}): Promise<void> {
  const { token, ...fetchOptions } = options;
  const headers: Record<string, string> = {
    ...((fetchOptions.headers as Record<string, string>) || {}),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const response = await fetch(`${getApiBaseUrl()}${endpoint}`, {
    ...fetchOptions,
    headers,
  });
  if (!response.ok) {
    const status = response.status;
    if (status === 401 && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(API_UNAUTHORIZED_EVENT));
    }
    const errorJson = await response.json().catch(() => ({ message: 'Request failed' }));
    let msg = 'Request failed';
    if (typeof errorJson === 'object' && errorJson !== null && 'message' in errorJson) {
      const m = (errorJson as { message?: unknown }).message;
      if (m !== undefined && m !== null && String(m).trim() !== '') msg = String(m);
      else msg = `HTTP ${status}`;
    } else {
      msg = `HTTP ${status}`;
    }
    const hint =
      typeof errorJson === 'object' && errorJson !== null && 'hint' in errorJson
        ? String((errorJson as { hint?: unknown }).hint ?? '').trim()
        : '';
    if (hint) msg = `${msg} ${hint}`;
    throw new ApiHttpError(status, msg, errorJson);
  }
}

// Auth
const AUTH_ME_TIMEOUT_MS = 18_000;

export async function getCurrentUser(token: string, requestOptions?: { timeoutMs?: number }) {
  return apiRequest<{
    id: string;
    email: string;
    profile?: { id: string; fullName?: string; avatarUrl?: string };
    agencyRole?: string;
    tenantRole?: string;
    agencyId?: string;
    tenantId?: string;
  }>('/auth/me', { token, timeoutMs: requestOptions?.timeoutMs ?? AUTH_ME_TIMEOUT_MS });
}

// Agencies
export async function getAgencies(token: string) {
  return apiRequest<Array<{ agencyId: string; role: string }>>('/auth/agencies', { token });
}

export async function getAgencyById(
  token: string,
  agencyId: string,
): Promise<{ id: string; name: string; role?: string; settings?: Record<string, unknown> } | null> {
  return apiRequest(`/agencies/${agencyId}`, { token });
}

// Tenants
export type WorkspaceBotMode = 'off' | 'suggestive' | 'autopilot';

export async function getTenantById(token: string, tenantId: string) {
  return apiRequest<{
    id: string;
    name: string;
    ghlLocationId: string | null;
    status: string;
    agencyId: string;
    botMode: WorkspaceBotMode;
    botEnabled: boolean;
    promptConfig?: {
      id: string;
      name: string;
      temperature: number;
      modelOverride?: string;
      isActive?: boolean;
    } | null;
    quota?: {
      totalQuota: number;
      usedQuota: number;
      remainingQuota: number;
      periodStart: string;
      periodEnd: string;
    } | null;
  }>(`/tenants/${tenantId}`, { token });
}

export async function getTenantsByAgency(token: string, agencyId: string) {
  return apiRequest<Array<{
    id: string;
    name: string;
    ghlLocationId: string | null;
    status: string;
  }>>(`/tenants/agency/${agencyId}`, { token });
}

export async function getMyTenants(token: string) {
  return apiRequest<Array<{
    id: string;
    name: string;
    ghlLocationId: string | null;
    status: string;
  }>>('/tenants/me', { token });
}

export async function createSubaccount(
  token: string,
  body: { agencyId: string; name: string; ghlLocationId?: string | null },
) {
  return apiRequest<{
    id: string;
    name: string;
    ghlLocationId: string | null;
    status: string;
    agencyId: string;
  }>('/tenants', { token, method: 'POST', body: JSON.stringify(body) });
}

export async function updateSubaccountName(token: string, tenantId: string, name: string) {
  return updateWorkspaceSettings(token, tenantId, { name });
}

/**
 * Update workspace name (agency) and/or bot mode (anyone with workspace access).
 */
export async function updateWorkspaceSettings(
  token: string,
  tenantId: string,
  body: { name?: string; botMode?: WorkspaceBotMode },
) {
  if (body.name === undefined && body.botMode === undefined) {
    throw new Error('Provide at least one of: name, botMode');
  }
  return apiRequest<{
    id: string;
    name: string;
    ghlLocationId: string | null;
    status: string;
    agencyId: string;
    botMode: WorkspaceBotMode;
    botEnabled: boolean;
    promptConfig?: {
      id: string;
      name: string;
      temperature: number;
      modelOverride?: string;
      isActive?: boolean;
    } | null;
  }>(`/tenants/${encodeURIComponent(tenantId)}`, {
    token,
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export async function deleteSubaccount(token: string, tenantId: string) {
  const response = await fetch(
    `${getApiBaseUrl()}/tenants/${encodeURIComponent(tenantId)}`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );
  if (!response.ok) {
    const status = response.status;
    const errorJson = await response.json().catch(() => ({ message: 'Request failed' }));
    let msg = 'Request failed';
    if (typeof errorJson === 'object' && errorJson !== null && 'message' in errorJson) {
      const m = (errorJson as { message?: unknown }).message;
      if (m !== undefined && m !== null && String(m).trim() !== '') msg = String(m);
      else msg = `HTTP ${status}`;
    } else {
      msg = `HTTP ${status}`;
    }
    throw new ApiHttpError(status, msg, errorJson);
  }
  const text = (await response.text()).trim();
  if (!text) {
    return { ok: true as const, id: tenantId };
  }
  return JSON.parse(text) as { ok: boolean; id: string };
}

export async function getTenantPrompt(token: string, tenantId: string) {
  return apiRequest<{
    id: string;
    name: string;
    temperature: number;
    modelOverride?: string;
  } | null>(`/tenants/${tenantId}/prompt`, { token });
}

export async function getTenantQuota(token: string, tenantId: string) {
  return apiRequest<{
    totalQuota: number;
    usedQuota: number;
    remainingQuota: number;
    periodStart: string;
    periodEnd: string;
  } | null>(`/tenants/${tenantId}/quota`, { token });
}

// GHL Connection
export interface GhlConnectionStatus {
  connected: boolean;
  status: 'DISCONNECTED' | 'CONNECTED' | 'INVALID' | 'ERROR';
  ghlLocationId: string | null;
  verifiedAt: string | null;
  lastHealthCheckAt: string | null;
  lastError: string | null;
  maskToken?: string;
  metadata?: Record<string, unknown>;
}

export async function getGhlConnection(token: string, tenantId: string): Promise<GhlConnectionStatus> {
  return apiRequest<GhlConnectionStatus>(`/tenants/${tenantId}/ghl/connection`, { token });
}

export async function saveGhlConnection(
  token: string,
  tenantId: string,
  data: { ghlLocationId: string; privateIntegrationToken: string }
): Promise<{ success: boolean; connected: boolean; status: string; maskToken?: string }> {
  return apiRequest<{ success: boolean; connected: boolean; status: string; maskToken?: string }>(
    `/tenants/${tenantId}/ghl/connection`,
    { token, method: 'POST', body: JSON.stringify(data) }
  );
}

export async function verifyGhlConnection(token: string, tenantId: string): Promise<GhlConnectionStatus> {
  return apiRequest<GhlConnectionStatus>(`/tenants/${tenantId}/ghl/verify`, { token, method: 'POST' });
}

export async function checkGhlHealth(token: string, tenantId: string): Promise<{ healthy: boolean; message: string; timestamp: string }> {
  return apiRequest<{ healthy: boolean; message: string; timestamp: string }>(`/tenants/${tenantId}/ghl/health`, { token });
}

export async function deleteGhlConnection(token: string, tenantId: string): Promise<void> {
  await apiRequest<void>(`/tenants/${tenantId}/ghl/connection`, { token, method: 'DELETE' });
}

// Subaccount automation — booking, tagging, follow-up
export type TenantBookingMode = 'COLLECT_DETAILS_ONLY' | 'CHECK_AVAILABILITY' | 'BOOK_AFTER_CONFIRMATION';

export interface CustomBookingField {
  id: string;
  label: string;
  helpText?: string;
  fieldType: string;
  options?: string[];
  required: boolean;
  displayOrder: number;
}

export interface TenantBookingSettings {
  enabled: boolean;
  bookingMode: TenantBookingMode;
  defaultGhlCalendarId: string | null;
  defaultGhlCalendarName: string | null;
  coreFieldsJson: Record<string, { enabled: boolean; required: boolean }>;
  customFieldsJson: CustomBookingField[];
  maxBookingsPerSlot: number;
}

export interface GhlCalendarOption {
  id: string;
  name: string;
}

export interface TenantTaggingSettings {
  automaticTaggingEnabled: boolean;
}

export type TagMatchMode = 'AI' | 'KEYWORD' | 'HYBRID';
export type TagConfidenceThreshold = 'LOW' | 'NORMAL' | 'HIGH';

export interface TenantTagRule {
  id: string;
  tenantId: string;
  enabled: boolean;
  autoApply: boolean;
  ruleName: string;
  ruleDescription: string;
  keywords: string[];
  crmTagId: string | null;
  crmTagName: string;
  matchMode: TagMatchMode;
  confidenceThreshold: TagConfidenceThreshold;
  priority: number;
  createdAt: string;
  updatedAt: string;
}

export interface TagRuleMatchHit {
  ruleId: string;
  ruleName: string;
  crmTagName: string;
  matchMode: TagMatchMode;
  confidence: number;
  confidenceLabel: TagConfidenceThreshold;
  passesThreshold: boolean;
  source: 'keyword' | 'ai';
  why: string;
  /** Present when server supports it; defaults to false in UI if missing. */
  autoApply?: boolean;
}

export interface TagRuleTestMatchResult {
  hits: TagRuleMatchHit[];
  tagsToApply: string[];
}

export interface FollowUpStepSetting {
  stepNumber: number;
  delayAmount: number;
  delayUnit: 'minutes' | 'hours' | 'days';
  mode: 'fixed' | 'ai';
  fixedMessage?: string;
  aiInstruction?: string;
  enabled: boolean;
}

export type FollowUpHoursTimezoneMode = 'BUSINESS' | 'CONTACT';

export interface ActiveHoursDayWindow {
  enabled: boolean;
  start: string;
  end: string;
}

export interface TenantFollowUpSettings {
  enabled: boolean;
  maxFollowUps: number;
  stopOnCustomerReply: boolean;
  stopOnBookingCompleted: boolean;
  stopOnEscalated: boolean;
  stopOnOptOut: boolean;
  businessHoursOnly: boolean;
  activeHoursTimezoneMode: FollowUpHoursTimezoneMode;
  activeHoursWindows: Record<string, ActiveHoursDayWindow>;
  steps: FollowUpStepSetting[];
}

export async function getTenantBookingSettings(token: string, tenantId: string): Promise<TenantBookingSettings> {
  return apiRequest<TenantBookingSettings>(`/tenants/${tenantId}/booking-settings`, { token });
}

export async function patchTenantBookingSettings(
  token: string,
  tenantId: string,
  patch: Partial<{
    enabled: boolean;
    bookingMode: TenantBookingMode;
    defaultGhlCalendarId: string | null;
    defaultGhlCalendarName: string | null;
    coreFieldsJson: Record<string, { enabled: boolean; required: boolean }>;
    customFieldsJson: CustomBookingField[];
    maxBookingsPerSlot: number;
  }>,
): Promise<TenantBookingSettings> {
  return apiRequest<TenantBookingSettings>(`/tenants/${tenantId}/booking-settings`, {
    token,
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function syncTenantCalendars(
  token: string,
  tenantId: string,
): Promise<{ calendars: GhlCalendarOption[]; syncedAt: string; error?: string }> {
  const path = `/tenants/${tenantId}/booking-settings/sync-calendars`;
  if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
    console.debug('[AISBP API] POST', `${getApiBaseUrl()}${path}`);
  }
  return apiRequest(path, { token, method: 'POST' });
}

export interface TenantBookingScheduleDiagnostics {
  calendarReachable: boolean;
  calendarType?: string | null;
  active?: boolean | null;
  teamMembersCount: number;
  openHoursCount: number;
  eventCalendarScheduleFound: boolean;
  userScheduleFound: boolean;
  scheduleRulesCount: number;
  scheduleTimezone?: string | null;
  scheduleAssociatedCalendarIds: string[];
  selectedCalendarInSchedule: boolean;
  warnings: string[];
  warningCodes: string[];
}

export interface TenantBookingRulesDiagnostics {
  slotDuration: number | null;
  slotInterval: number | null;
  appointmentsPerSlot: number | null;
  bufferSummary: string;
  minNoticeSummary: string;
  bookingWindowSummary: string;
  meetingLocationPresent: boolean;
  meetingLocationType: string | null;
  conflictCheckSummary: string;
  formAttached: boolean;
  consentRequired: boolean;
  paymentRequired: boolean;
  servicesIncompleteHint: boolean;
  warnings: string[];
  warningCodes: string[];
}

export interface TenantFreeSlotsProbeVariant {
  variantName: string;
  hostMode: 'leadconnectorBackendWidget' | 'servicesApi';
  rangeMode: 'month' | 'fullLocalDay' | 'selectedToDayEnd';
  sendSeatsPerSlot: boolean;
  version: string;
  timestampUnit: string;
  userParamMode: string;
  timezoneIncluded: boolean;
  requestPath: string;
  startDateValue: string;
  endDateValue: string;
  httpStatus?: number;
  responseShape: string;
  dateKeysReturned: string[];
  slotsReturned: number;
  firstFewSlots: { startTime: string; endTime: string }[];
  errorExcerpt?: string;
}

export interface TenantFreeSlotsProbeResult {
  crmTimezoneUsed: string;
  teamUserIdProbe: string | null;
  productionSpec: {
    apiVersion: string;
    timestampUnit: string;
    includeTimezoneQuery: boolean;
    retryAddsUserAs: string;
    hostMode: string;
    rangeMode: string;
    sendSeatsPerSlot: boolean;
    channel: string;
    source: string;
    widgetRequestUsesBearer: boolean;
  };
  variants: TenantFreeSlotsProbeVariant[];
  anySlotsReturned: boolean;
  allVariantsZero: boolean;
  message?: string;
}

export async function probeTenantBookingFreeSlots(
  token: string,
  tenantId: string,
  body: {
    calendarId: string;
    selectedDate: string;
    selectedTime?: string;
    userId?: string;
    timezone?: string;
  },
): Promise<TenantFreeSlotsProbeResult> {
  return apiRequest(`/tenants/${tenantId}/booking-settings/probe-free-slots`, {
    token,
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function testTenantBookingCalendar(
  token: string,
  tenantId: string,
  body?: { calendarId?: string | null },
): Promise<{
  ok: boolean;
  calendarId: string | null;
  message: string;
  calendars?: GhlCalendarOption[];
  scheduleDiagnostics?: TenantBookingScheduleDiagnostics;
  bookingRulesDiagnostics?: TenantBookingRulesDiagnostics;
}> {
  return apiRequest(`/tenants/${tenantId}/booking-settings/test-calendar`, {
    token,
    method: 'POST',
    body: JSON.stringify(body ?? {}),
  });
}

export async function testTenantBookingSlots(
  token: string,
  tenantId: string,
  body?: {
    selectedDate?: string;
    selectedTime?: string;
    calendarId?: string | null;
    /** Legacy — backend maps to ms range internally */
    startDate?: string;
    endDate?: string;
  },
): Promise<{
  slots: { startTime: string; endTime: string }[];
  calendarId: string | null;
  error?: string;
  emptyWithoutError?: boolean;
  retriedWithUserId?: string | null;
  scheduleDiagnostics?: TenantBookingScheduleDiagnostics;
  bookingRulesDiagnostics?: TenantBookingRulesDiagnostics;
  slotsSourceMessage?: string;
}> {
  return apiRequest(`/tenants/${tenantId}/booking-settings/test-slots`, {
    token,
    method: 'POST',
    body: JSON.stringify(body ?? {}),
  });
}

export async function getTenantTaggingSettings(token: string, tenantId: string): Promise<TenantTaggingSettings> {
  return apiRequest(`/tenants/${tenantId}/tagging-settings`, { token });
}

export async function patchTenantTaggingSettings(
  token: string,
  tenantId: string,
  patch: Partial<{ automaticTaggingEnabled: boolean }>,
): Promise<TenantTaggingSettings> {
  return apiRequest(`/tenants/${tenantId}/tagging-settings`, {
    token,
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function getTenantTagRules(token: string, tenantId: string): Promise<{ rules: TenantTagRule[] }> {
  return apiRequest(`/tenants/${tenantId}/tag-rules`, { token });
}

export async function createTenantTagRule(
  token: string,
  tenantId: string,
  body: Partial<TenantTagRule> & { ruleName: string; ruleDescription: string; crmTagName: string },
): Promise<{ rule: TenantTagRule }> {
  return apiRequest(`/tenants/${tenantId}/tag-rules`, {
    token,
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function patchTenantTagRule(
  token: string,
  tenantId: string,
  ruleId: string,
  patch: Partial<{
    enabled: boolean;
    autoApply: boolean;
    ruleName: string;
    ruleDescription: string;
    keywords?: string[];
    crmTagId: string | null;
    crmTagName: string;
    matchMode: TagMatchMode;
    confidenceThreshold: TagConfidenceThreshold;
    /** Omit — priority is internal only; defaults persist server-side. */
    priority?: number;
  }>,
): Promise<{ rule: TenantTagRule }> {
  return apiRequest(`/tenants/${tenantId}/tag-rules/${ruleId}`, {
    token,
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function deleteTenantTagRule(token: string, tenantId: string, ruleId: string): Promise<{ ok: boolean }> {
  return apiRequest(`/tenants/${tenantId}/tag-rules/${ruleId}`, { token, method: 'DELETE' });
}

export async function syncTenantGhlTags(
  token: string,
  tenantId: string,
): Promise<{ tags: { id?: string; name: string }[]; syncedAt: string; error?: string }> {
  return apiRequest(`/tenants/${tenantId}/tag-rules/sync-tags`, { token, method: 'POST' });
}

export async function createTenantCrmTag(
  token: string,
  tenantId: string,
  body: { name: string },
): Promise<{ tag: { id?: string; name: string }; syncedAt: string }> {
  return apiRequest(`/tenants/${tenantId}/tag-rules/create-tag`, {
    token,
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function deleteTenantCrmTag(
  token: string,
  tenantId: string,
  params: { tagId?: string; tagName?: string },
): Promise<{ ok: boolean }> {
  const q = new URLSearchParams();
  if (params.tagId?.trim()) q.set('tagId', params.tagId.trim());
  if (params.tagName?.trim()) q.set('tagName', params.tagName.trim());
  const qs = q.toString();
  return apiRequest(`/tenants/${tenantId}/tag-rules/delete-tag${qs ? `?${qs}` : ''}`, {
    token,
    method: 'DELETE',
  });
}

export async function testIntentTagOnContact(
  token: string,
  tenantId: string,
  body: { contactId: string; tagName: string },
): Promise<{ success: boolean; message?: string; error?: string }> {
  return apiRequest(`/tenants/${tenantId}/tag-rules/test-tag`, {
    token,
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function testTenantTagRulesMatch(
  token: string,
  tenantId: string,
  body: { message: string; ruleIds?: string[] },
): Promise<TagRuleTestMatchResult> {
  return apiRequest(`/tenants/${tenantId}/tag-rules/test-match`, {
    token,
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function getTenantFollowUpSettings(token: string, tenantId: string): Promise<TenantFollowUpSettings> {
  return apiRequest(`/tenants/${tenantId}/follow-up-settings`, { token });
}

export async function patchTenantFollowUpSettings(
  token: string,
  tenantId: string,
  patch: Partial<TenantFollowUpSettings>,
): Promise<TenantFollowUpSettings> {
  return apiRequest(`/tenants/${tenantId}/follow-up-settings`, {
    token,
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

// Conversations
export async function getConversations(
  token: string,
  tenantId: string,
  opts?: { status?: string; page?: number; pageSize?: number }
) {
  const params = new URLSearchParams({ tenantId });
  if (opts?.status) params.set('status', opts.status);
  if (opts?.page) params.set('page', String(opts.page));
  if (opts?.pageSize) params.set('pageSize', String(opts.pageSize));
  return apiRequest<{ conversations: unknown[]; total: number }>(`/conversations?${params}`, { token });
}

export async function getConversation(token: string, conversationId: string) {
  return apiRequest<unknown>(`/conversations/${conversationId}`, { token });
}

// Automation state
export interface ConversationAutomationState {
  conversationId: string;
  automationState: 'ACTIVE' | 'PAUSED' | 'HANDOVER' | null;
}

export interface ConversationSummary {
  id: string;
  ghlConversationId: string;
  contactId: string;
  channel: string;
  status: string;
  lastMessageAt: string | null;
}

export interface AutomationEvent {
  id: string;
  previousState: string | null;
  newState: string;
  actorId: string | null;
  actorEmail: string | null;
  reason: string | null;
  createdAt: string;
}

export async function getConversationsByAutomationState(
  token: string,
  tenantId: string,
  automationState: 'ACTIVE' | 'PAUSED' | 'HANDOVER'
) {
  const params = new URLSearchParams({ tenantId, automationState });
  return apiRequest<{ conversations: ConversationSummary[]; total: number }>(
    `/conversations?${params}`,
    { token },
  );
}

export async function getConversationAutomationState(
  token: string,
  conversationId: string,
): Promise<ConversationAutomationState> {
  return apiRequest<ConversationAutomationState>(
    `/conversations/${conversationId}/automation-state`,
    { token },
  );
}

export async function setConversationAutomationState(
  token: string,
  conversationId: string,
  state: 'ACTIVE' | 'PAUSED',
  reason?: string,
): Promise<{ conversationId: string; automationState: string }> {
  const body = reason ? { state, reason } : { state };
  return apiRequest<{ conversationId: string; automationState: string }>(
    `/conversations/${conversationId}/automation-state`,
    { token, method: 'PATCH', body: JSON.stringify(body) },
  );
}

export async function getConversationAutomationEvents(
  token: string,
  conversationId: string,
) {
  return apiRequest<{ events: AutomationEvent[] }>(
    `/conversations/${conversationId}/automation-events`,
    { token },
  );
}

export async function getConversationMessages(
  token: string,
  conversationId: string,
  opts?: { limit?: number; before?: string }
) {
  const params = new URLSearchParams();
  if (opts?.limit) params.set('limit', String(opts.limit));
  if (opts?.before) params.set('before', opts.before);
  return apiRequest<unknown[]>(`/conversations/${conversationId}/messages?${params}`, { token });
}

/** Clears bot policy / option memory anchor; keeps DB messages. Queues a short confirmation to the contact. */
export async function resetConversationBotState(
  token: string,
  conversationId: string,
): Promise<{ ok: boolean; memoryResetAt: string; resetVersion: number; clearedKeys: string[] }> {
  return apiRequest(`/conversations/${conversationId}/reset-state`, {
    token,
    method: 'POST',
  });
}

// Handover
export async function getActiveHandovers(token: string, tenantId: string) {
  return apiRequest<unknown[]>(`/handover/active?tenantId=${tenantId}`, { token });
}

export async function resumeHandover(token: string, conversationId: string) {
  return apiRequest<{ success: boolean; conversationId: string }>(
    '/handover/resume',
    { token, method: 'POST', body: JSON.stringify({ conversationId }) }
  );
}

export async function getHandoverHistory(token: string, conversationId: string) {
  return apiRequest<unknown[]>(`/handover/history/${conversationId}`, { token });
}

// Action Intents
export interface ActionIntentsResult {
  intents: unknown[];
  total: number;
}

export async function getActionIntents(
  token: string,
  tenantId: string,
  opts?: { conversationId?: string; status?: string; limit?: number; page?: number }
) {
  const params = new URLSearchParams({ tenantId });
  if (opts?.conversationId) params.set('conversationId', opts.conversationId);
  if (opts?.status) params.set('status', opts.status);
  if (opts?.limit) params.set('limit', String(opts.limit));
  if (opts?.page) params.set('page', String(opts.page));
  return apiRequest<ActionIntentsResult>(`/action-intents?${params}`, { token });
}

// Agency AI Config
export interface AgencyProviderSnapshot {
  defaultModel: string;
  maxTokens?: number;
  temperature?: number;
  hasKey: boolean;
  minimaxGroupId?: string;
  /** API base URL saved for this provider row (no secrets). */
  endpoint?: string | null;
}

export type ActiveAiHealthBadge = 'PASS' | 'FAIL' | 'UNKNOWN';

export interface AiModelHealthSnapshot {
  lastHealthStatus: 'PASS' | 'FAIL';
  lastHealthCheckedAt: string;
  lastHealthLatencyMs: number | null;
  lastHealthErrorSummary: string | null;
  lastHealthModel: string;
  lastHealthProvider: string;
  lastHealthErrorCode?: string;
}

export interface SubaccountBehaviorPolicy {
  temperatureMin: number;
  temperatureMax: number;
  maxTokensMin: number;
  maxTokensMax: number;
  allowModelOverride: boolean;
  allowResponseStyleOverride: boolean;
  allowMaxTokensOverride: boolean;
}

export interface LiveAiCatalogDto {
  providers: Array<{ id: 'OPENAI' | 'MINIMAX'; label: string }>;
  modelsByProvider: Record<'OPENAI' | 'MINIMAX', Array<{ id: string; label: string; tier?: string }>>;
}

export interface AgencyAiConfig {
  provider: string;
  activeProvider?: string;
  /** Default model for the live active provider. */
  activeModel?: string;
  enabled: boolean;
  defaultModel: string;
  maxTokens?: number;
  temperature?: number;
  hasApiKey: boolean;
  keysPresent?: Partial<Record<string, boolean>>;
  providerSnapshots?: Partial<Record<string, AgencyProviderSnapshot>>;
  subaccountBehaviorPolicy?: SubaccountBehaviorPolicy;
  aiModelHealthSnapshot?: AiModelHealthSnapshot | null;
  activeAiHealth: {
    healthBadge: ActiveAiHealthBadge;
    lastHealthCheckedAt: string | null;
    lastHealthLatencyMs: number | null;
    lastHealthErrorSummary: string | null;
  };
  /** Same registry the backend validates against — use for dropdowns (avoids stale client bundles). */
  liveAiCatalog: LiveAiCatalogDto;
}

export async function getAgencyAiConfig(token: string): Promise<AgencyAiConfig> {
  return apiRequest<AgencyAiConfig>('/agency-ai-config', { token });
}

export async function saveAgencyAiConfig(
  token: string,
  data: {
    provider: string;
    apiKey?: string;
    endpoint?: string;
    defaultModel: string;
    temperature?: number;
    maxTokens?: number;
    setAsActive?: boolean;
    minimaxGroupId?: string;
  },
): Promise<AgencyAiConfig> {
  return apiRequest<AgencyAiConfig>('/agency-ai-config', {
    token,
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function postAgencyAiModelHealthTest(
  token: string,
  body: { provider: string; model: string; optionalUseSavedKey?: boolean },
): Promise<{
  status: 'PASS' | 'FAIL';
  provider: string;
  model: string;
  latencyMs: number;
  checkedAt: string;
  errorCode?: string;
  errorSummary?: string;
}> {
  return apiRequest('/agency-ai-config/test', {
    token,
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function setActiveAiProvider(
  token: string,
  provider: string,
): Promise<AgencyAiConfig> {
  return apiRequest<AgencyAiConfig>('/agency-ai-config/active', {
    token,
    method: 'PATCH',
    body: JSON.stringify({ provider }),
  });
}

export async function saveSubaccountBehaviorPolicy(
  token: string,
  policy: SubaccountBehaviorPolicy,
): Promise<SubaccountBehaviorPolicy> {
  return apiRequest<SubaccountBehaviorPolicy>('/agency-ai-config/subaccount-behavior', {
    token,
    method: 'PATCH',
    body: JSON.stringify(policy),
  });
}

/** Real generation test (not live GHL). Uses agency reply policy + subaccount prompt + KB + active provider. */
export async function postSubaccountBotTest(
  token: string,
  tenantId: string,
  body: { message: string; history?: { role: 'user' | 'assistant'; content: string }[] },
) {
  return apiRequest<{
    reply: string | null;
    skipReason?: string;
    usedFallbackProvider?: 'OPENAI';
    activeProvider: string;
    modelUsed: string;
    kbChunksUsed: number;
    /** Support-only diagnostic (shown under Response details, not inline). */
    supportDetail?: string;
  }>(`/tenants/${encodeURIComponent(tenantId)}/bot-test`, { token, method: 'POST', body: JSON.stringify(body) });
}

// Quota (agency)
export async function getQuotaAgencySettings(token: string) {
  return apiRequest<{ agencyId: string; defaultSubaccountQuota: number }>('/quotas/agency/settings', { token });
}

export async function setAgencyDefaultQuota(token: string, defaultSubaccountQuota: number) {
  return apiRequest<{ defaultSubaccountQuota: number }>('/quotas/agency/default', {
    token,
    method: 'POST',
    body: JSON.stringify({ defaultSubaccountQuota }),
  });
}

export async function topupSubaccountQuota(
  token: string,
  body: { tenantId: string; amount: number; note?: string },
) {
  return apiRequest<{
    tenantId: string;
    previousTotal: number;
    newTotal: number;
    delta: number;
  }>('/quotas/agency/topup', { token, method: 'POST', body: JSON.stringify(body) });
}

export type QuotaAuditLogRow = {
  id: string;
  agency_id: string;
  profile_id: string;
  tenant_id: string | null;
  action: string;
  delta: number;
  previous_total: number | null;
  new_total: number | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  actorEmail?: string | null;
  actorName?: string | null;
};

export async function getQuotaAuditLog(token: string, opts?: { tenantId?: string; limit?: number }) {
  const p = new URLSearchParams();
  if (opts?.tenantId) p.set('tenantId', opts.tenantId);
  if (opts?.limit) p.set('limit', String(opts.limit));
  const q = p.toString();
  return apiRequest<QuotaAuditLogRow[]>(`/quotas/agency/audit${q ? `?${q}` : ''}`, { token });
}

// Prompts — tenant configs & agency policies
export interface TenantPromptRow {
  id: string;
  name: string;
  systemPrompt: string;
  temperature: number | null;
  modelOverride: string | null;
  maxTokens: number | null;
  isActive: boolean | null;
}

export async function listTenantPrompts(token: string, tenantId: string): Promise<TenantPromptRow[]> {
  return apiRequest<TenantPromptRow[]>(`/prompts/tenant/${tenantId}`, { token });
}

export async function upsertTenantPrompt(
  token: string,
  dto: {
    tenantId: string;
    name: string;
    systemPrompt: string;
    temperature?: number;
    modelOverride?: string;
    maxTokens?: number;
    isActive?: boolean;
  }
): Promise<TenantPromptRow> {
  return apiRequest<TenantPromptRow>('/prompts/tenant', {
    token,
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

export interface AgencyPolicyRow {
  id: string;
  name: string;
  content: string;
  priority: number | null;
  isDefault: boolean | null;
}

export async function listAgencyPolicies(token: string, agencyId: string): Promise<AgencyPolicyRow[]> {
  return apiRequest<AgencyPolicyRow[]>(`/prompts/policy/${agencyId}`, { token });
}

export async function upsertAgencyPolicy(
  token: string,
  dto: {
    agencyId: string;
    name: string;
    content: string;
    priority?: number;
    isDefault?: boolean;
    /** Update this version in place. Omit to upsert by name (create or replace-by-name). */
    policyId?: string;
  }
): Promise<AgencyPolicyRow> {
  return apiRequest<AgencyPolicyRow>('/prompts/policy', {
    token,
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

export async function deleteAgencyPolicy(
  token: string,
  agencyId: string,
  policyId: string,
): Promise<void> {
  await apiRequestNoContent(
    `/prompts/policy/${encodeURIComponent(agencyId)}/${encodeURIComponent(policyId)}`,
    { token, method: 'DELETE' },
  );
}

// Agency / tenant membership
export interface RosterMember {
  id: string;
  profileId: string | null;
  email?: string | null;
  fullName?: string | null;
  role: string;
}

export async function listAgencyUsers(token: string, agencyId: string): Promise<RosterMember[]> {
  return apiRequest<RosterMember[]>(`/agency-users?agencyId=${encodeURIComponent(agencyId)}`, { token });
}

export async function listTenantUsers(token: string, tenantId: string): Promise<RosterMember[]> {
  return apiRequest<RosterMember[]>(`/tenant-users?tenantId=${encodeURIComponent(tenantId)}`, { token });
}

/** Agency roles (matches backend `AgencyRole`). */
export type AgencyRoleValue = 'OWNER' | 'ADMIN' | 'OPERATOR' | 'MEMBER';

/** Tenant roles (matches backend `TenantRole`). */
export type TenantRoleValue = 'ADMIN' | 'AGENT' | 'VIEWER';

export async function addAgencyMember(
  token: string,
  dto: { agencyId: string; role: AgencyRoleValue; profileId?: string; email?: string },
): Promise<RosterMember & { createdAt?: string }> {
  return apiRequest(`/agency-users`, { token, method: 'POST', body: JSON.stringify(dto) });
}

export async function updateAgencyMemberRole(
  token: string,
  membershipId: string,
  role: AgencyRoleValue,
): Promise<RosterMember> {
  return apiRequest(`/agency-users/${encodeURIComponent(membershipId)}/role`, {
    token,
    method: 'PATCH',
    body: JSON.stringify({ role }),
  });
}

export async function removeAgencyMember(token: string, membershipId: string): Promise<void> {
  await apiRequestNoContent(`/agency-users/${encodeURIComponent(membershipId)}`, {
    token,
    method: 'DELETE',
  });
}

export async function addTenantMember(
  token: string,
  dto: { tenantId: string; profileId: string; role: TenantRoleValue },
): Promise<RosterMember & { createdAt?: string }> {
  return apiRequest(`/tenant-users`, { token, method: 'POST', body: JSON.stringify(dto) });
}

/** Create Supabase Auth user (or reset password) and attach to workspace. Agency staff or tenant ADMIN. */
export async function provisionWorkspaceMemberCredentials(
  token: string,
  dto: {
    tenantId: string;
    email: string;
    password: string;
    fullName?: string | null;
    role: TenantRoleValue;
  },
): Promise<RosterMember & { createdAt?: string }> {
  return apiRequest(`/tenant-users/provision-credentials`, {
    token,
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

export async function updateTenantMemberRole(
  token: string,
  membershipId: string,
  role: TenantRoleValue,
): Promise<RosterMember> {
  return apiRequest(`/tenant-users/${encodeURIComponent(membershipId)}/role`, {
    token,
    method: 'PATCH',
    body: JSON.stringify({ role }),
  });
}

export async function removeTenantMember(token: string, membershipId: string): Promise<void> {
  await apiRequestNoContent(`/tenant-users/${encodeURIComponent(membershipId)}`, {
    token,
    method: 'DELETE',
  });
}

// Knowledge base: list, search, create, delete
export interface KbRichTextDocumentPayload {
  id: string;
  title: string;
  status: string;
  updatedAt: string;
  sizeBytes: number;
  chunkCount: number;
  answerPreview: string;
}

export type KbSearchHit = {
  documentId: string;
  documentTitle: string;
  sectionTitle: string | null;
  snippet: string;
  score: number;
  /** Set when this row came from the best-effort fallback (no strict lexical match). */
  bestEffort?: boolean;
  chunkId: string;
  /** Source/kind of the document — `rich_text`, `faq`, `manual`, MIME, etc. */
  kind?: string | null;
  /** Document updated_at when known (recency tie-breaker). */
  updatedAt?: string | null;
  relevanceLabel?: 'HIGH' | 'MEDIUM' | 'LOW' | 'BEST_EFFORT';
  scorePercent?: number;
};

export type KbSearchResponse = {
  query: string;
  hits: KbSearchHit[];
  totalConsidered: number;
  retrievalMode: string;
};

export interface KbDocumentRow {
  id: string;
  title: string;
  source: string;
  status: string;
  documentKind?: string;
  chunkCount?: number;
  createdAt?: string;
  /** Server `listDocuments` — prefer over createdAt for “last changed” */
  updatedAt?: string;
  mimeType?: string | null;
  sizeBytes?: number | null;
  /** When true, GET .../download may return the original upload */
  originalDownloadable?: boolean;
  /** First chunk preview (FAQ / notes / files) */
  answerPreview?: string;
  faqQuestion?: string;
}

export async function listKbDocuments(
  token: string,
  tenantId: string,
  opts?: { allStatuses?: boolean },
): Promise<KbDocumentRow[]> {
  const q = opts?.allStatuses ? '?all=1' : '';
  return apiRequest<KbDocumentRow[]>(`/kb/documents/${encodeURIComponent(tenantId)}${q}`, { token });
}

export async function createKbFaq(
  token: string,
  dto: { tenantId: string; question: string; answer: string },
): Promise<{ id: string }> {
  return apiRequest('/kb/documents/faq', { token, method: 'POST', body: JSON.stringify(dto) });
}

export async function updateKbFaq(
  token: string,
  documentId: string,
  dto: { tenantId: string; question: string; answer: string },
): Promise<{ ok: boolean }> {
  return apiRequest(`/kb/documents/${encodeURIComponent(documentId)}/faq`, {
    token,
    method: 'PATCH',
    body: JSON.stringify(dto),
  });
}

export async function getKbDocumentChunks(
  token: string,
  tenantId: string,
  documentId: string,
): Promise<Array<{ id: string; content: string; tokenCount?: number; metadata?: Record<string, unknown> }>> {
  const q = new URLSearchParams({ tenantId });
  return apiRequest(`/kb/chunks/${encodeURIComponent(documentId)}?${q}`, { token });
}

/** Authoritative note body for View/Edit (metadata `richTextContent` or chunk fallback). */
export type KbRichNoteSource = {
  id: string;
  title: string;
  content: string;
  updatedAt: string;
  status: string;
  chunkCount: number;
};

export async function getKbRichNoteSource(
  token: string,
  tenantId: string,
  documentId: string,
): Promise<KbRichNoteSource> {
  const q = new URLSearchParams({ tenantId });
  return apiRequest<KbRichNoteSource>(
    `/kb/documents/${encodeURIComponent(documentId)}/rich-source?${q}`,
    { token },
  );
}

export async function createKbRichText(
  token: string,
  dto: { tenantId: string; title: string; content: string },
): Promise<{ id: string }> {
  return apiRequest('/kb/documents/rich', { token, method: 'POST', body: JSON.stringify(dto) });
}

export async function updateKbRichText(
  token: string,
  documentId: string,
  dto: { tenantId: string; title: string; content: string },
): Promise<{ document: KbRichTextDocumentPayload }> {
  return apiRequest(`/kb/documents/${encodeURIComponent(documentId)}/rich`, {
    token,
    method: 'PATCH',
    body: JSON.stringify(dto),
  });
}

/** Same-origin KB download URL (use with Bearer via `downloadKbDocumentOriginal`). */
export function kbDocumentDownloadPath(tenantId: string, documentId: string): string {
  const q = new URLSearchParams({ tenantId });
  return `/kb/documents/${encodeURIComponent(documentId)}/download?${q}`;
}

function parseContentDispositionFilename(header: string | null): string | null {
  if (!header) return null;
  const star = /filename\*=UTF-8''([^;\s]+)/i.exec(header);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].replace(/["']/g, ''));
    } catch {
      return star[1];
    }
  }
  const plain = /filename="([^"]+)"/i.exec(header);
  if (plain?.[1]) return plain[1].trim();
  const plain2 = /filename=([^;\s]+)/i.exec(header);
  if (plain2?.[1]) return plain2[1].replace(/["']/g, '').trim();
  return null;
}

export async function downloadKbDocumentOriginal(
  token: string,
  tenantId: string,
  documentId: string,
  fallbackFilename: string,
): Promise<{ blob: Blob; filename: string }> {
  const path = kbDocumentDownloadPath(tenantId, documentId);
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!response.ok) {
    const status = response.status;
    if (status === 401 && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(API_UNAUTHORIZED_EVENT));
    }
    const errorJson = await response.json().catch(() => ({ message: 'Request failed' }));
    let msg = 'Request failed';
    if (typeof errorJson === 'object' && errorJson !== null && 'message' in errorJson) {
      const m = (errorJson as { message?: unknown }).message;
      if (m !== undefined && m !== null && String(m).trim() !== '') msg = String(m);
      else msg = `HTTP ${status}`;
    } else {
      msg = `HTTP ${status}`;
    }
    throw new ApiHttpError(status, msg, errorJson);
  }
  const blob = await response.blob();
  const fromHeader = parseContentDispositionFilename(response.headers.get('Content-Disposition'));
  const filename = fromHeader || fallbackFilename || 'download';
  return { blob, filename };
}

export async function uploadKbFile(token: string, tenantId: string, file: File): Promise<{ id: string; status: string }> {
  const fd = new FormData();
  fd.set('tenantId', tenantId);
  fd.set('file', file);
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const response = await fetch(`${getApiBaseUrl()}/kb/documents/file`, { method: 'POST', body: fd, headers });
  if (!response.ok) {
    const status = response.status;
    if (status === 401 && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(API_UNAUTHORIZED_EVENT));
    }
    const errorJson = await response.json().catch(() => ({ message: 'Request failed' }));
    let msg = 'Request failed';
    if (typeof errorJson === 'object' && errorJson !== null && 'message' in errorJson) {
      const m = (errorJson as { message?: unknown }).message;
      if (m !== undefined && m !== null && String(m).trim() !== '') msg = String(m);
      else msg = `HTTP ${status}`;
    } else {
      msg = `HTTP ${status}`;
    }
    throw new ApiHttpError(status, msg, errorJson);
  }
  return response.json() as Promise<{ id: string; status: string }>;
}

export async function deleteKbDocument(token: string, tenantId: string, documentId: string): Promise<void> {
  const q = new URLSearchParams({ tenantId });
  await apiRequestNoContent(`/kb/documents/${encodeURIComponent(documentId)}?${q}`, { token, method: 'DELETE' });
}

export async function searchKb(
  token: string,
  dto: { tenantId: string; query: string; topK?: number; conversationId?: string; intentHint?: string },
): Promise<KbSearchResponse> {
  return apiRequest(`/kb/search`, { token, method: 'POST', body: JSON.stringify(dto) });
}

/** AI router probe — matches backend `RoutingResponse` from POST `/ai-router/route`. */
export interface AiRouterRouteResult {
  recommendedModel: string;
  responseMode: string;
  draftReply: unknown;
  handoverRecommended: boolean;
  bookingIntentDetected: boolean;
  tagsSuggested: string[];
  confidence: number;
  reasoning: string;
}

export interface AiRouterRouteProbeBody {
  tenantId: string;
  conversationId: string;
  prompt: string;
  incomingMessageType?: 'text' | 'image' | 'audio' | 'video' | 'unknown';
  channel?: string;
  handoverRecommended?: boolean;
  bookingIntentDetected?: boolean;
}

export async function probeAiRouterRoute(
  token: string,
  body: AiRouterRouteProbeBody,
): Promise<AiRouterRouteResult> {
  return apiRequest<AiRouterRouteResult>('/ai-router/route', {
    token,
    method: 'POST',
    body: JSON.stringify(body),
  });
}