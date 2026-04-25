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
}

async function apiRequest<T>(endpoint: string, options: ApiOptions = {}): Promise<T> {
  const { token, ...fetchOptions } = options;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((fetchOptions.headers as Record<string, string>) || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${getApiBaseUrl()}${endpoint}`, {
    ...fetchOptions,
    // Avoid HTTP cache of authenticated GETs (e.g. agency AI rehydrate after save).
    cache: fetchOptions.cache ?? 'no-store',
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
export async function getCurrentUser(token: string) {
  return apiRequest<{
    id: string;
    email: string;
    profile?: { id: string; fullName?: string; avatarUrl?: string };
    agencyRole?: string;
    tenantRole?: string;
    agencyId?: string;
    tenantId?: string;
  }>('/auth/me', { token });
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
export async function getTenantById(token: string, tenantId: string) {
  return apiRequest<{
    id: string;
    name: string;
    ghlLocationId: string | null;
    status: string;
    agencyId: string;
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
  return apiRequest<{
    id: string;
    name: string;
    ghlLocationId: string | null;
    status: string;
    agencyId: string;
  }>(`/tenants/${encodeURIComponent(tenantId)}`, {
    token,
    method: 'PATCH',
    body: JSON.stringify({ name }),
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
}

export async function getAgencyAiConfig(token: string): Promise<AgencyAiConfig> {
  return apiRequest<AgencyAiConfig>('/agency-ai-config', { token });
}

export async function saveAgencyAiConfig(
  token: string,
  data: {
    provider: string;
    apiKey?: string;
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
export interface KbDocumentRow {
  id: string;
  title: string;
  source: string;
  status: string;
  documentKind?: string;
  chunkCount?: number;
  createdAt?: string;
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

export async function createKbRichText(
  token: string,
  dto: { tenantId: string; title: string; content: string },
): Promise<{ id: string }> {
  return apiRequest('/kb/documents/rich', { token, method: 'POST', body: JSON.stringify(dto) });
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
  dto: { tenantId: string; query: string; topK?: number; conversationId?: string }
): Promise<{ chunks: unknown[]; totalConsidered?: number }> {
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