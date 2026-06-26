export interface OnboardClient {
  id: string;
  clientKey: string;
  displayName: string;
  displayLabel: string;
  contactName: string | null;
  contactPhone: string | null;
  contactPhoneMasked: string | null;
  contactEmail: string | null;
  whatsappPhone: string | null;
  industry: string | null;
  websiteUrl: string | null;
  timezone: string | null;
  status: string;
  projectCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface OnboardProject {
  id: string;
  onboardClientId: string;
  clientKey: string;
  displayName: string;
  displayLabel: string;
  status: string;
  currentPhase: string;
  version: number;
  submittedAt: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateClientInput {
  clientKey: string;
  displayName: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  whatsappPhone?: string;
  industry?: string;
  websiteUrl?: string;
  timezone?: string;
}

export interface UpdateClientInput {
  displayName?: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  whatsappPhone?: string;
  industry?: string;
  websiteUrl?: string;
  timezone?: string;
}

export interface CreateProjectInput {
  onboardClientId: string;
}

export interface UpdateProjectInput {
  displayName?: string;
}
