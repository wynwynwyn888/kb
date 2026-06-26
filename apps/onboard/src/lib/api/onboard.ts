export function getApiBaseUrl(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}/api/v1`;
  }
  const base = (process.env['BACKEND_URL'] || 'http://127.0.0.1:3001').replace(/\/$/, '');
  return `${base}/api/v1`;
}

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

async function apiRequest<T>(path: string, options: RequestInit & { token?: string } = {}): Promise<T> {
  const { token, ...fetchOptions } = options;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(fetchOptions.headers as Record<string, string>),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const url = `${getApiBaseUrl()}${path}`;
  const res = await fetch(url, { ...fetchOptions, headers });

  if (!res.ok) {
    let body: unknown = null;
    try { body = await res.json(); } catch { /* ignore */ }
    const message = res.status === 403
      ? 'You are signed in but do not have AISBP-Onboard operator access.'
      : `API error ${res.status}`;
    throw new ApiHttpError(res.status, message, body);
  }

  const text = await res.text();
  if (!text) return undefined as unknown as T;
  return JSON.parse(text) as T;
}

import type {
  OnboardClient,
  OnboardProject,
  CreateClientInput,
  UpdateClientInput,
  CreateProjectInput,
  UpdateProjectInput,
  ApprovalEvent,
  SectionStatus,
  ProjectAnalysis,
  AutomationRecommendation,
} from '@/types/onboard';

export function createOnboardApi(token: string) {
  return {
    // Clients
    listClients: () =>
      apiRequest<OnboardClient[]>('/onboard/clients', { token }),

    createClient: (input: CreateClientInput) =>
      apiRequest<OnboardClient>('/onboard/clients', {
        token,
        method: 'POST',
        body: JSON.stringify(input),
      }),

    getClient: (id: string) =>
      apiRequest<OnboardClient>(`/onboard/clients/${id}`, { token }),

    updateClient: (id: string, input: UpdateClientInput) =>
      apiRequest<OnboardClient>(`/onboard/clients/${id}`, {
        token,
        method: 'PATCH',
        body: JSON.stringify(input),
      }),

    // Projects
    listProjects: () =>
      apiRequest<OnboardProject[]>('/onboard/projects', { token }),

    createProject: (input: CreateProjectInput) =>
      apiRequest<OnboardProject>('/onboard/projects', {
        token,
        method: 'POST',
        body: JSON.stringify(input),
      }),

    getProject: (id: string) =>
      apiRequest<OnboardProject>(`/onboard/projects/${id}`, { token }),

    updateProject: (id: string, input: UpdateProjectInput) =>
      apiRequest<OnboardProject>(`/onboard/projects/${id}`, {
        token,
        method: 'PATCH',
        body: JSON.stringify(input),
      }),

    // Approval (PR 6)
    approveSection: (projectId: string, sectionName: string, comment?: string) =>
      apiRequest<{ sectionName: string; status: string; approvedBy: string }>(
        `/onboard/projects/${projectId}/sections/${sectionName}/approve`,
        { token, method: 'POST', body: JSON.stringify({ comment }) },
      ),

    requestChanges: (projectId: string, comment: string, rejectedSections?: string[]) =>
      apiRequest<{ projectId: string; status: string }>(
        `/onboard/projects/${projectId}/request-changes`,
        { token, method: 'POST', body: JSON.stringify({ comment, rejectedSections }) },
      ),

    rejectProject: (projectId: string, comment: string) =>
      apiRequest<{ projectId: string; status: string }>(
        `/onboard/projects/${projectId}/reject`,
        { token, method: 'POST', body: JSON.stringify({ comment }) },
      ),

    approveProject: (projectId: string, comment?: string) =>
      apiRequest<{ projectId: string; status: string; approvedBy: string }>(
        `/onboard/projects/${projectId}/approve`,
        { token, method: 'POST', body: JSON.stringify({ comment }) },
      ),

    getApprovalEvents: (projectId: string) =>
      apiRequest<ApprovalEvent[]>(`/onboard/projects/${projectId}/approval-events`, { token }),

    getAuditEvents: (projectId: string) =>
      apiRequest<ApprovalEvent[]>(`/onboard/projects/${projectId}/audit`, { token }),

    // Analysis & Recommendations (PR 8)
    getProjectAnalysis: (projectId: string) =>
      apiRequest<ProjectAnalysis | null>(`/onboard/projects/${projectId}/analysis`, { token }),

    getProjectRecommendations: (projectId: string) =>
      apiRequest<AutomationRecommendation[]>(`/onboard/projects/${projectId}/recommendations`, { token }),

    // Notifications (PR 11)
    getReviewAlerts: () =>
      apiRequest<Record<string, unknown>>('/onboard/notifications/review-alerts', { token }),

    // GHL Validation / Dry Run (PR 12)
    ghlValidate: (projectId: string) =>
      apiRequest<Record<string, unknown>>(`/onboard/projects/${projectId}/sync/ghl/validate`, { token, method: 'POST' }),

    ghlDryRun: (projectId: string) =>
      apiRequest<Record<string, unknown>>(`/onboard/projects/${projectId}/sync/ghl/dry-run`, { token, method: 'POST' }),

    // Sync (PR 9)
    kbDryRun: (projectId: string, idempotencyKey?: string) =>
      apiRequest<Record<string, unknown>>(`/onboard/projects/${projectId}/sync/kb/dry-run`, {
        token,
        method: 'POST',
        body: JSON.stringify({ idempotencyKey }),
      }),

    getSyncRuns: (projectId: string) =>
      apiRequest<Record<string, unknown>[]>(`/onboard/projects/${projectId}/sync-runs`, { token }),

    // Apply Sync (PR 10)
    kbApply: (projectId: string, syncRunId: string, idempotencyKey: string, confirmApply: boolean, applyScope?: string, operatorNote?: string) =>
      apiRequest<Record<string, unknown>>(`/onboard/projects/${projectId}/sync/kb/apply`, {
        token,
        method: 'POST',
        body: JSON.stringify({ syncRunId, idempotencyKey, confirmApply, applyScope, operatorNote }),
      }),
  };
}

export type OnboardApi = ReturnType<typeof createOnboardApi>;
