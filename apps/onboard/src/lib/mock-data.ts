import type { CSSProperties } from 'react';

export interface MockClient {
  clientKey: string;
  displayName: string;
  contactPhone: string;
  contactEmail: string;
  status: 'active' | 'draft' | 'paused' | 'archived';
  industry: string;
}

export interface MockProject {
  projectId: string;
  clientKey: string;
  displayName: string;
  status: 'draft' | 'submitted' | 'in_review' | 'changes_requested' | 'approved' | 'syncing' | 'live';
  completeness: number;
  submittedAt: string | null;
  approvedBy: string | null;
  sections: MockSection[];
  recommendations: MockRecommendation[];
  syncRuns: MockSyncRun[];
  auditEvents: MockAuditEvent[];
}

export interface MockSection {
  name: string;
  label: string;
  status: 'empty' | 'partial' | 'complete' | 'approved' | 'rejected';
  fieldsCompleted: number;
  fieldsTotal: number;
}

export interface MockRecommendation {
  type: string;
  title: string;
  description: string;
  riskLevel: 'low' | 'medium' | 'high';
  status: 'suggested' | 'accepted' | 'rejected' | 'modified';
}

export interface MockSyncRun {
  syncRunId: string;
  targetSystem: 'kb' | 'ghl';
  mode: 'dry_run' | 'apply';
  status: 'pending' | 'dry_run_passed' | 'dry_run_failed' | 'applied' | 'apply_failed';
  triggeredBy: string;
  createdAt: string;
}

export interface MockAuditEvent {
  id: string;
  actorType: 'agent' | 'operator' | 'service';
  action: string;
  resourceType: string;
  createdAt: string;
}

export interface MockAgentSession {
  sessionId: string;
  projectId: string;
  displayName: string;
  clientKey: string;
  status: 'active' | 'paused' | 'completed' | 'expired';
  currentStep: string;
  totalSteps: number;
  completedSteps: number;
  expiresAt: string;
  recentAnswers: { questionKey: string; answerValue: string; confidence: number }[];
}

export const mockClients: MockClient[] = [
  {
    clientKey: 'dapperdogs',
    displayName: 'Dapper Dogs',
    contactPhone: '+6587651234',
    contactEmail: 'james@dapperdogs.sg',
    status: 'active',
    industry: 'Pet Grooming',
  },
  {
    clientKey: 'pawfection',
    displayName: 'Pawfection Grooming',
    contactPhone: '+6598762345',
    contactEmail: 'hello@pawfection.sg',
    status: 'draft',
    industry: 'Pet Grooming',
  },
  {
    clientKey: 'zenyoga',
    displayName: 'Zen Yoga Studio',
    contactPhone: '+6581234567',
    contactEmail: 'info@zenyoga.sg',
    status: 'active',
    industry: 'Wellness',
  },
];

export const mockProjects: MockProject[] = [
  {
    projectId: 'f8d4c2a0-5e3b-4f2c-9d6e-0a4c3b2f5e8d',
    clientKey: 'dapperdogs',
    displayName: 'Dapper Dogs',
    status: 'in_review',
    completeness: 0.72,
    submittedAt: '2026-06-26T10:30:00Z',
    approvedBy: null,
    sections: [
      { name: 'business_profile', label: 'Business Profile', status: 'approved', fieldsCompleted: 12, fieldsTotal: 12 },
      { name: 'sales_process', label: 'Sales Process', status: 'complete', fieldsCompleted: 8, fieldsTotal: 8 },
      { name: 'faq', label: 'FAQ Items', status: 'partial', fieldsCompleted: 9, fieldsTotal: 15 },
      { name: 'prompt', label: 'Prompt Config', status: 'approved', fieldsCompleted: 10, fieldsTotal: 10 },
      { name: 'handover', label: 'Handover Rules', status: 'empty', fieldsCompleted: 0, fieldsTotal: 5 },
      { name: 'follow_up', label: 'Follow-Up Rules', status: 'empty', fieldsCompleted: 0, fieldsTotal: 4 },
    ],
    recommendations: [
      {
        type: 'booking',
        title: 'Enable automated appointment booking',
        description: 'Clear services with durations. High booking intent in conversations.',
        riskLevel: 'low',
        status: 'suggested',
      },
      {
        type: 'handover',
        title: 'Configure handover for complaints',
        description: 'Pet grooming has occasional dissatisfaction scenarios. Escalate to human when detected.',
        riskLevel: 'medium',
        status: 'suggested',
      },
    ],
    syncRuns: [],
    auditEvents: [
      { id: 'evt-001', actorType: 'agent', action: 'answer.submit', resourceType: 'answer', createdAt: '2026-06-26T10:00:00Z' },
      { id: 'evt-002', actorType: 'agent', action: 'project.submit', resourceType: 'project', createdAt: '2026-06-26T10:30:00Z' },
      { id: 'evt-003', actorType: 'operator', action: 'section.approve', resourceType: 'section', createdAt: '2026-06-26T11:00:00Z' },
    ],
  },
  {
    projectId: 'a1b2c3d4-5e6f-7a8b-9c0d-1e2f3a4b5c6d',
    clientKey: 'pawfection',
    displayName: 'Pawfection Grooming',
    status: 'draft',
    completeness: 0.15,
    submittedAt: null,
    approvedBy: null,
    sections: [
      { name: 'business_profile', label: 'Business Profile', status: 'partial', fieldsCompleted: 3, fieldsTotal: 12 },
      { name: 'sales_process', label: 'Sales Process', status: 'empty', fieldsCompleted: 0, fieldsTotal: 8 },
      { name: 'faq', label: 'FAQ Items', status: 'empty', fieldsCompleted: 0, fieldsTotal: 15 },
      { name: 'prompt', label: 'Prompt Config', status: 'empty', fieldsCompleted: 0, fieldsTotal: 10 },
      { name: 'handover', label: 'Handover Rules', status: 'empty', fieldsCompleted: 0, fieldsTotal: 5 },
      { name: 'follow_up', label: 'Follow-Up Rules', status: 'empty', fieldsCompleted: 0, fieldsTotal: 4 },
    ],
    recommendations: [],
    syncRuns: [],
    auditEvents: [],
  },
  {
    projectId: 'b2c3d4e5-6f7a-8b9c-0d1e-2f3a4b5c6d7e',
    clientKey: 'zenyoga',
    displayName: 'Zen Yoga Studio',
    status: 'approved',
    completeness: 1.0,
    submittedAt: '2026-06-25T14:00:00Z',
    approvedBy: 'wyn-operator',
    sections: [
      { name: 'business_profile', label: 'Business Profile', status: 'approved', fieldsCompleted: 12, fieldsTotal: 12 },
      { name: 'sales_process', label: 'Sales Process', status: 'approved', fieldsCompleted: 8, fieldsTotal: 8 },
      { name: 'faq', label: 'FAQ Items', status: 'approved', fieldsCompleted: 15, fieldsTotal: 15 },
      { name: 'prompt', label: 'Prompt Config', status: 'approved', fieldsCompleted: 10, fieldsTotal: 10 },
      { name: 'handover', label: 'Handover Rules', status: 'approved', fieldsCompleted: 5, fieldsTotal: 5 },
      { name: 'follow_up', label: 'Follow-Up Rules', status: 'approved', fieldsCompleted: 4, fieldsTotal: 4 },
    ],
    recommendations: [
      { type: 'booking', title: 'Enable class booking automation', description: 'Yoga studio with scheduled classes.', riskLevel: 'low', status: 'accepted' },
    ],
    syncRuns: [
      {
        syncRunId: 'f2a3b4c5-6d7e-8f9a-0b1c-2d3e4f5a6b7c',
        targetSystem: 'kb',
        mode: 'dry_run',
        status: 'dry_run_passed',
        triggeredBy: 'wyn-operator',
        createdAt: '2026-06-26T12:00:00Z',
      },
    ],
    auditEvents: [
      { id: 'evt-004', actorType: 'agent', action: 'answer.submit', resourceType: 'answer', createdAt: '2026-06-25T12:00:00Z' },
      { id: 'evt-005', actorType: 'operator', action: 'project.approve', resourceType: 'project', createdAt: '2026-06-25T16:00:00Z' },
    ],
  },
];

export const mockAgentSession: MockAgentSession = {
  sessionId: 'b8c9d0e1-2f3a-4b5c-6d7e-8f9a0b1c2d3e',
  projectId: 'f8d4c2a0-5e3b-4f2c-9d6e-0a4c3b2f5e8d',
  displayName: 'Dapper Dogs',
  clientKey: 'dapperdogs',
  status: 'active',
  currentStep: 'FAQ — Pricing questions',
  totalSteps: 12,
  completedSteps: 7,
  expiresAt: '2026-06-27T10:30:00Z',
  recentAnswers: [
    { questionKey: 'business_name', answerValue: 'Dapper Dogs', confidence: 0.98 },
    { questionKey: 'description', answerValue: 'Premium dog grooming salon in Tiong Bahru, Singapore.', confidence: 0.95 },
    { questionKey: 'services', answerValue: 'Basic Groom (S$45-65), Full Groom (S$80-120), Spa Package (S$150)', confidence: 0.90 },
    { questionKey: 'opening_hours', answerValue: 'Mon-Tue, Thu-Fri 10-7, Sat 9-6, Sun 9-5, Wed closed', confidence: 0.92 },
  ],
};

export const statusPillColors: Record<string, { bg: string; text: string }> = {
  approved: { bg: '#DCFCE7', text: '#16A34A' },
  live: { bg: '#DCFCE7', text: '#16A34A' },
  active: { bg: '#DCFCE7', text: '#16A34A' },
  complete: { bg: '#DCFCE7', text: '#16A34A' },
  applied: { bg: '#DCFCE7', text: '#16A34A' },
  dry_run_passed: { bg: '#DCFCE7', text: '#16A34A' },
  in_review: { bg: '#FEF3C7', text: '#D97706' },
  submitted: { bg: '#FEF3C7', text: '#D97706' },
  partial: { bg: '#FEF3C7', text: '#D97706' },
  pending: { bg: '#FEF3C7', text: '#D97706' },
  changes_requested: { bg: '#FEE2E2', text: '#DC2626' },
  rejected: { bg: '#FEE2E2', text: '#DC2626' },
  failed: { bg: '#FEE2E2', text: '#DC2626' },
  apply_failed: { bg: '#FEE2E2', text: '#DC2626' },
  dry_run_failed: { bg: '#FEE2E2', text: '#DC2626' },
  draft: { bg: '#F1F5F9', text: '#64748B' },
  empty: { bg: '#F1F5F9', text: '#64748B' },
  paused: { bg: '#F1F5F9', text: '#64748B' },
  archived: { bg: '#F1F5F9', text: '#64748B' },
  suggested: { bg: '#F1F5F9', text: '#64748B' },
};
