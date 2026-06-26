import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { getSupabaseService } from '../../lib/supabase';
import { randomUUID } from 'node:crypto';
import { maskPhone, formatDisplayLabel, formatShortId } from './utils/identifiers';
import { OnboardAuditService } from './utils/audit';

export interface OnboardClientSummary {
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
  createdAt: Date;
  updatedAt: Date;
}

export interface OnboardProjectSummary {
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
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class OnboardService {
  constructor(private readonly audit: OnboardAuditService) {}

  // ==========================================================================
  // CLIENTS
  // ==========================================================================

  async listClients(): Promise<OnboardClientSummary[]> {
    const supabase = getSupabaseService();
    const { data, error } = await supabase
      .from('onboard_clients')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) return [];
    return (data || []).map(row => this.toClientSummary(row));
  }

  async getClient(clientId: string): Promise<OnboardClientSummary | null> {
    const supabase = getSupabaseService();
    const { data, error } = await supabase
      .from('onboard_clients')
      .select('*')
      .eq('id', clientId)
      .single();

    if (error || !data) return null;
    return this.toClientSummary(data);
  }

  async getClientByKey(clientKey: string): Promise<OnboardClientSummary | null> {
    const supabase = getSupabaseService();
    const { data, error } = await supabase
      .from('onboard_clients')
      .select('*')
      .eq('client_key', clientKey)
      .single();

    if (error || !data) return null;
    return this.toClientSummary(data);
  }

  async createClient(
    input: {
      clientKey: string;
      displayName: string;
      contactName?: string;
      contactPhone?: string;
      contactEmail?: string;
      whatsappPhone?: string;
      industry?: string;
      websiteUrl?: string;
      timezone?: string;
    },
    actorId: string,
  ): Promise<OnboardClientSummary> {
    const supabase = getSupabaseService();
    const id = randomUUID();

    const { error } = await supabase.from('onboard_clients').insert({
      id,
      client_key: input.clientKey,
      display_name: input.displayName,
      contact_name: input.contactName ?? null,
      contact_phone: input.contactPhone ?? null,
      contact_email: input.contactEmail ?? null,
      whatsapp_phone: input.whatsappPhone ?? null,
      industry: input.industry ?? null,
      website_url: input.websiteUrl ?? null,
      timezone: input.timezone ?? 'Asia/Singapore',
      status: 'DRAFT',
    });

    if (error) {
      if (error.message?.includes('unique') || error.code === '23505') {
        throw new BadRequestException(`Client key "${input.clientKey}" already exists`);
      }
      throw new BadRequestException(`Failed to create client: ${error.message}`);
    }

    const client = await this.getClient(id);
    if (!client) throw new BadRequestException('Failed to retrieve created client');

    this.audit.log({
      actorId,
      actorType: 'OPERATOR',
      action: 'client.create',
      resourceType: 'onboard_client',
      resourceId: id,
      changes: { clientKey: input.clientKey, displayName: input.displayName },
    });

    return client;
  }

  async updateClient(
    clientId: string,
    input: {
      displayName?: string;
      contactName?: string;
      contactPhone?: string;
      contactEmail?: string;
      whatsappPhone?: string;
      industry?: string;
      websiteUrl?: string;
      timezone?: string;
    },
    actorId: string,
  ): Promise<OnboardClientSummary> {
    const supabase = getSupabaseService();
    const existing = await this.getClient(clientId);
    if (!existing) throw new NotFoundException('Client not found');

    const updates: Record<string, unknown> = {};
    if (input.displayName !== undefined) updates['display_name'] = input.displayName;
    if (input.contactName !== undefined) updates['contact_name'] = input.contactName || null;
    if (input.contactPhone !== undefined) updates['contact_phone'] = input.contactPhone || null;
    if (input.contactEmail !== undefined) updates['contact_email'] = input.contactEmail || null;
    if (input.whatsappPhone !== undefined) updates['whatsapp_phone'] = input.whatsappPhone || null;
    if (input.industry !== undefined) updates['industry'] = input.industry || null;
    if (input.websiteUrl !== undefined) updates['website_url'] = input.websiteUrl || null;
    if (input.timezone !== undefined) updates['timezone'] = input.timezone || null;

    if (Object.keys(updates).length === 0) {
      return existing;
    }

    const { error } = await supabase
      .from('onboard_clients')
      .update(updates)
      .eq('id', clientId);

    if (error) throw new BadRequestException(`Failed to update client: ${error.message}`);

    const updated = await this.getClient(clientId);
    if (!updated) throw new BadRequestException('Failed to retrieve updated client');

    this.audit.log({
      actorId,
      actorType: 'OPERATOR',
      action: 'client.update',
      resourceType: 'onboard_client',
      resourceId: clientId,
      changes: { updatedFields: Object.keys(updates) },
    });

    return updated;
  }

  // ==========================================================================
  // PROJECTS
  // ==========================================================================

  async listProjects(): Promise<OnboardProjectSummary[]> {
    const supabase = getSupabaseService();
    const { data: projects, error } = await supabase
      .from('onboarding_projects')
      .select('*, onboard_clients!inner(client_key, display_name)')
      .order('created_at', { ascending: false });

    if (error) return [];
    return (projects || []).map(row => this.toProjectSummary(row));
  }

  async listProjectsByClient(clientId: string): Promise<OnboardProjectSummary[]> {
    const supabase = getSupabaseService();
    const { data, error } = await supabase
      .from('onboarding_projects')
      .select('*, onboard_clients!inner(client_key, display_name)')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false });

    if (error) return [];
    return (data || []).map((row: Record<string, unknown>) => this.toProjectSummary(row));
  }

  async getProject(projectId: string): Promise<OnboardProjectSummary | null> {
    const supabase = getSupabaseService();
    const { data, error } = await supabase
      .from('onboarding_projects')
      .select('*, onboard_clients!inner(client_key, display_name)')
      .eq('id', projectId)
      .single();

    if (error || !data) return null;
    return this.toProjectSummary(data);
  }

  async createProject(
    onboardClientId: string,
    actorId: string,
  ): Promise<OnboardProjectSummary> {
    const supabase = getSupabaseService();

    const client = await this.getClient(onboardClientId);
    if (!client) throw new NotFoundException('Client not found');

    const id = randomUUID();
    const { error } = await supabase.from('onboarding_projects').insert({
      id,
      client_id: onboardClientId,
      status: 'DRAFT',
      current_phase: 'INTAKE',
      version: 1,
    });

    if (error) throw new BadRequestException(`Failed to create project: ${error.message}`);

    const project = await this.getProject(id);
    if (!project) throw new BadRequestException('Failed to retrieve created project');

    this.audit.log({
      projectId: id,
      actorId,
      actorType: 'OPERATOR',
      action: 'project.create',
      resourceType: 'onboarding_project',
      resourceId: id,
      changes: { onboardClientId, clientKey: client.clientKey },
    });

    return project;
  }

  async updateProject(
    projectId: string,
    input: { displayName?: string },
    actorId: string,
  ): Promise<OnboardProjectSummary> {
    const existing = await this.getProject(projectId);
    if (!existing) throw new NotFoundException('Project not found');

    // PR 4 foundation: only displayName update is supported (metadata only)
    // Status changes, approval, and sync are for future PRs.
    // For now, if a displayName change is needed, it goes through the client update.

    this.audit.log({
      projectId,
      actorId,
      actorType: 'OPERATOR',
      action: 'project.update',
      resourceType: 'onboarding_project',
      resourceId: projectId,
      changes: { note: 'PR 4 foundation — metadata-only update, no status changes' },
    });

    return existing;
  }

  // ==========================================================================
  // PRIVATE HELPERS
  // ==========================================================================

  private toClientSummary(row: Record<string, unknown>): OnboardClientSummary {
    const clientKey = String(row['client_key'] ?? '');
    const displayName = String(row['display_name'] ?? '');
    const phone = row['contact_phone'] ? String(row['contact_phone']) : null;

    return {
      id: String(row['id'] ?? ''),
      clientKey,
      displayName,
      displayLabel: formatDisplayLabel(displayName, clientKey),
      contactName: row['contact_name'] ? String(row['contact_name']) : null,
      contactPhone: phone,
      contactPhoneMasked: maskPhone(phone),
      contactEmail: row['contact_email'] ? String(row['contact_email']) : null,
      whatsappPhone: row['whatsapp_phone'] ? String(row['whatsapp_phone']) : null,
      industry: row['industry'] ? String(row['industry']) : null,
      websiteUrl: row['website_url'] ? String(row['website_url']) : null,
      timezone: row['timezone'] ? String(row['timezone']) : null,
      status: String(row['status'] ?? 'DRAFT'),
      projectCount: 0,
      createdAt: new Date(String(row['created_at'] ?? Date.now())),
      updatedAt: new Date(String(row['updated_at'] ?? Date.now())),
    };
  }

  private toProjectSummary(row: Record<string, unknown>): OnboardProjectSummary {
    const clientRow = (row['onboard_clients'] ?? {}) as Record<string, unknown> | null;
    const clientKey = clientRow?.['client_key'] ? String(clientRow['client_key']) : '';
    const displayName = clientRow?.['display_name'] ? String(clientRow['display_name']) : '';

    return {
      id: String(row['id'] ?? ''),
      onboardClientId: String(row['client_id'] ?? ''),
      clientKey,
      displayName,
      displayLabel: formatDisplayLabel(displayName, clientKey),
      status: String(row['status'] ?? 'DRAFT'),
      currentPhase: String(row['current_phase'] ?? 'INTAKE'),
      version: Number(row['version'] ?? 1),
      submittedAt: row['submitted_at'] ? String(row['submitted_at']) : null,
      approvedAt: row['approved_at'] ? String(row['approved_at']) : null,
      approvedBy: row['approved_by'] ? String(row['approved_by']) : null,
      createdAt: new Date(String(row['created_at'] ?? Date.now())),
      updatedAt: new Date(String(row['updated_at'] ?? Date.now())),
    };
  }
}
