// API client for frontend - communicates with backend API

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

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

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...fetchOptions,
    headers,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message || `HTTP ${response.status}`);
  }

  return response.json();
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

// Tenants
export async function getTenantById(token: string, tenantId: string) {
  return apiRequest<{
    id: string;
    name: string;
    ghlLocationId: string;
    status: string;
    agencyId: string;
    promptConfig?: {
      id: string;
      name: string;
      temperature: number;
      modelOverride?: string;
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
    ghlLocationId: string;
    status: string;
  }>>(`/tenants/agency/${agencyId}`, { token });
}

export async function getMyTenants(token: string) {
  return apiRequest<Array<{
    id: string;
    name: string;
    ghlLocationId: string;
    status: string;
  }>>('/tenants/me', { token });
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