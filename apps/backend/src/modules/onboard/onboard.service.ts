import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { getSupabaseService } from '../../lib/supabase';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { maskPhone, formatDisplayLabel, formatShortId } from './utils/identifiers';
import { OnboardAuditService } from './utils/audit';
import {
  VALID_SECTION_NAMES,
  isValidSection,
  SECTION_TABLE_MAP,
  ALLOWED_APPROVAL_TRANSITIONS,
  ALLOWED_PROJECT_TRANSITIONS,
  REQUIRED_SECTIONS_FOR_APPROVAL,
  type SectionName,
} from './utils/approval';
import { mapOnboardToKbPlan } from './kb-sync/onboard-kb-sync.mapper';
import { TenantsService } from '../tenants/tenants.service';
import { BotProfilesService } from '../prompts/bot-profiles.service';
import { KbService } from '../kb/kb.service';

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
  constructor(
    private readonly audit: OnboardAuditService,
    private readonly tenantsService: TenantsService,
    private readonly botProfilesService: BotProfilesService,
    private readonly kbService: KbService,
  ) {}

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
  // REVIEW / APPROVAL (PR 6)
  // ==========================================================================

  async getSectionStatus(projectId: string, sectionName: string): Promise<string> {
    if (!isValidSection(sectionName)) {
      throw new BadRequestException(`Invalid section: ${sectionName}. Valid: ${VALID_SECTION_NAMES.join(', ')}`);
    }
    const project = await this.getProject(projectId);
    if (!project) throw new NotFoundException('Project not found');

    const supabase = getSupabaseService();
    const table = SECTION_TABLE_MAP[sectionName as SectionName];

    const { data } = await supabase.from(table).select('section_status').eq('project_id', projectId).maybeSingle();
    return data?.['section_status'] ?? 'EMPTY';
  }

  async approveSection(
    projectId: string,
    sectionName: string,
    actorId: string,
    comment?: string,
  ): Promise<{ sectionName: string; status: string; approvedBy: string }> {
    if (!isValidSection(sectionName)) {
      throw new BadRequestException(`Invalid section: ${sectionName}`);
    }

    const project = await this.getProject(projectId);
    if (!project) throw new NotFoundException('Project not found');

    const currentStatus = await this.getSectionStatus(projectId, sectionName);
    const allowed = ALLOWED_APPROVAL_TRANSITIONS[currentStatus];
    if (!allowed || !allowed.includes('APPROVED')) {
      throw new BadRequestException(
        `Cannot approve section "${sectionName}" with status "${currentStatus}". Section must be COMPLETE.`,
      );
    }

    const supabase = getSupabaseService();
    const table = SECTION_TABLE_MAP[sectionName as SectionName];

    const { error } = await supabase.from(table).update({ section_status: 'APPROVED' }).eq('project_id', projectId);
    if (error) throw new BadRequestException(`Failed to approve section: ${error.message}`);

    this.audit.log({
      projectId,
      actorId,
      actorType: 'OPERATOR',
      action: 'section.approve',
      resourceType: 'section',
      resourceId: `${projectId}:${sectionName}`,
      changes: { sectionName, previousStatus: currentStatus, newStatus: 'APPROVED', comment },
    });

    // Write approval_event
    await supabase.from('approval_events').insert({
      id: randomUUID(),
      project_id: projectId,
      actor_id: actorId,
      actor_type: 'OPERATOR',
      action: 'APPROVE_SECTION',
      target_type: 'SECTION',
      target_id: sectionName,
      comment: comment ?? null,
      previous_status: currentStatus,
      new_status: 'APPROVED',
    });

    return { sectionName, status: 'APPROVED', approvedBy: actorId };
  }

  async requestChanges(
    projectId: string,
    actorId: string,
    comment: string,
    rejectedSections?: string[],
  ): Promise<{ projectId: string; status: string }> {
    const project = await this.getProject(projectId);
    if (!project) throw new NotFoundException('Project not found');

    const currentStatus = project.status;
    const allowed = ALLOWED_PROJECT_TRANSITIONS[currentStatus] || [];
    if (!allowed.includes('CHANGES_REQUESTED')) {
      throw new BadRequestException(
        `Cannot request changes on project with status "${currentStatus}". Current status does not allow changes.`,
      );
    }

    const supabase = getSupabaseService();
    const prevStatus = currentStatus;

    // Update project status
    const { error: projError } = await supabase
      .from('onboarding_projects')
      .update({ status: 'CHANGES_REQUESTED', version: project.version + 1 })
      .eq('id', projectId);

    if (projError) throw new BadRequestException(`Failed to update project: ${projError.message}`);

    // If specific sections are rejected, update their status too
    if (rejectedSections && rejectedSections.length > 0) {
      for (const sectionName of rejectedSections) {
        if (isValidSection(sectionName)) {
          const table = SECTION_TABLE_MAP[sectionName as SectionName];
          await supabase.from(table).update({ section_status: 'REJECTED' }).eq('project_id', projectId);

          await supabase.from('approval_events').insert({
            id: randomUUID(),
            project_id: projectId,
            actor_id: actorId,
            actor_type: 'OPERATOR',
            action: 'REJECT_SECTION',
            target_type: 'SECTION',
            target_id: sectionName,
            comment,
            previous_status: null,
            new_status: 'REJECTED',
          });
        }
      }
    }

    this.audit.log({
      projectId,
      actorId,
      actorType: 'OPERATOR',
      action: 'project.request_changes',
      resourceType: 'onboarding_project',
      resourceId: projectId,
      changes: { previousStatus: prevStatus, newStatus: 'CHANGES_REQUESTED', comment, rejectedSections },
    });

    await supabase.from('approval_events').insert({
      id: randomUUID(),
      project_id: projectId,
      actor_id: actorId,
      actor_type: 'OPERATOR',
      action: 'REQUEST_CHANGES',
      target_type: 'PROJECT',
      target_id: projectId,
      comment,
      previous_status: prevStatus,
      new_status: 'CHANGES_REQUESTED',
    });

    return { projectId, status: 'CHANGES_REQUESTED' };
  }

  async rejectProject(
    projectId: string,
    actorId: string,
    comment: string,
  ): Promise<{ projectId: string; status: string }> {
    const project = await this.getProject(projectId);
    if (!project) throw new NotFoundException('Project not found');

    const prevStatus = project.status;
    const allowed = ALLOWED_PROJECT_TRANSITIONS[prevStatus] || [];
    if (!allowed.includes('REJECTED')) {
      throw new BadRequestException(`Cannot reject project with status "${prevStatus}".`);
    }

    const supabase = getSupabaseService();
    const { error } = await supabase
      .from('onboarding_projects')
      .update({ status: 'REJECTED' })
      .eq('id', projectId);

    if (error) throw new BadRequestException(`Failed to reject project: ${error.message}`);

    this.audit.log({
      projectId,
      actorId,
      actorType: 'OPERATOR',
      action: 'project.reject',
      resourceType: 'onboarding_project',
      resourceId: projectId,
      changes: { previousStatus: prevStatus, newStatus: 'REJECTED', comment },
    });

    await supabase.from('approval_events').insert({
      id: randomUUID(),
      project_id: projectId,
      actor_id: actorId,
      actor_type: 'OPERATOR',
      action: 'REJECT_PROJECT',
      target_type: 'PROJECT',
      target_id: projectId,
      comment,
      previous_status: prevStatus,
      new_status: 'REJECTED',
    });

    return { projectId, status: 'REJECTED' };
  }

  async approveProject(
    projectId: string,
    actorId: string,
    comment?: string,
  ): Promise<{ projectId: string; status: string; approvedBy: string }> {
    const project = await this.getProject(projectId);
    if (!project) throw new NotFoundException('Project not found');

    const prevStatus = project.status;
    const allowed = ALLOWED_PROJECT_TRANSITIONS[prevStatus] || [];
    if (!allowed.includes('APPROVED')) {
      throw new BadRequestException(`Cannot approve project with status "${prevStatus}".`);
    }

    // Check required sections
    for (const sectionName of REQUIRED_SECTIONS_FOR_APPROVAL) {
      const status = await this.getSectionStatus(projectId, sectionName);
      if (status !== 'APPROVED') {
        throw new BadRequestException(
          `Required section "${sectionName}" is not approved (current status: ${status}). Approve all required sections first.`,
        );
      }
    }

    const supabase = getSupabaseService();
    const now = new Date().toISOString();

    const { error } = await supabase
      .from('onboarding_projects')
      .update({
        status: 'APPROVED',
        approved_at: now,
        approved_by: actorId,
      })
      .eq('id', projectId);

    if (error) throw new BadRequestException(`Failed to approve project: ${error.message}`);

    this.audit.log({
      projectId,
      actorId,
      actorType: 'OPERATOR',
      action: 'project.approve',
      resourceType: 'onboarding_project',
      resourceId: projectId,
      changes: { previousStatus: prevStatus, newStatus: 'APPROVED', comment },
    });

    await supabase.from('approval_events').insert({
      id: randomUUID(),
      project_id: projectId,
      actor_id: actorId,
      actor_type: 'OPERATOR',
      action: 'APPROVE_PROJECT',
      target_type: 'PROJECT',
      target_id: projectId,
      comment: comment ?? null,
      previous_status: prevStatus,
      new_status: 'APPROVED',
    });

    return { projectId, status: 'APPROVED', approvedBy: actorId };
  }

  async getApprovalEvents(projectId: string): Promise<Record<string, unknown>[]> {
    const supabase = getSupabaseService();
    const { data } = await supabase
      .from('approval_events')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });

    return (data || []) as Record<string, unknown>[];
  }

  async getAuditEvents(projectId: string): Promise<Record<string, unknown>[]> {
    const supabase = getSupabaseService();
    const { data } = await supabase
      .from('audit_events')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });

    return (data || []) as Record<string, unknown>[];
  }

  // ==========================================================================
  // AGENT INTAKE (PR 7)
  // Agent can ONLY draft. Cannot approve, cannot sync, cannot mutate production.
  // ==========================================================================

  async agentCreateSession(
    projectId: string,
    agentType: string,
    agentId: string,
  ): Promise<Record<string, unknown>> {
    const project = await this.getProject(projectId);
    if (!project) throw new NotFoundException('Project not found');

    const supabase = getSupabaseService();

    // Check for existing active session
    const { data: existing } = await supabase
      .from('agent_interview_sessions')
      .select('*')
      .eq('project_id', projectId)
      .eq('status', 'ACTIVE')
      .maybeSingle();

    if (existing) {
      return {
        sessionId: existing['id'],
        projectId,
        status: existing['status'],
        currentStep: existing['current_step'] ?? null,
        totalSteps: existing['total_steps'] ?? null,
        completedSteps: existing['total_steps'] ? Math.round((existing['total_steps'] - (existing['total_steps'] - 0)) * 0) : 0,
      };
    }

    const id = randomUUID();
    const { error } = await supabase.from('agent_interview_sessions').insert({
      id,
      project_id: projectId,
      agent_type: agentType,
      status: 'ACTIVE',
      total_steps: 12,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });

    if (error) throw new BadRequestException(`Failed to create session: ${error.message}`);

    this.audit.log({
      projectId,
      actorId: agentId,
      actorType: 'AGENT',
      action: 'session.create',
      resourceType: 'agent_interview_session',
      resourceId: id,
      changes: { agentType },
    });

    return {
      sessionId: id,
      projectId,
      status: 'ACTIVE',
      currentStep: 'business_name',
      totalSteps: 12,
    };
  }

  async agentGetSession(sessionId: string): Promise<Record<string, unknown> | null> {
    const supabase = getSupabaseService();
    const { data, error } = await supabase
      .from('agent_interview_sessions')
      .select('*')
      .eq('id', sessionId)
      .single();

    if (error || !data) return null;

    // Count completed answers
    const { count } = await supabase
      .from('agent_interview_answers')
      .select('*', { count: 'exact', head: true })
      .eq('session_id', sessionId);

    return {
      sessionId: data['id'],
      projectId: data['project_id'],
      status: data['status'],
      currentStep: data['current_step'] ?? null,
      totalSteps: data['total_steps'] ?? 12,
      completedSteps: count ?? 0,
      expiresAt: data['expires_at'] ?? null,
    };
  }

  async agentSubmitAnswers(
    sessionId: string,
    answers: Array<{
      section: string;
      questionKey: string;
      questionLabel?: string;
      answerValue: unknown;
      confidence?: number;
      source?: string;
    }>,
    agentId: string,
    idempotencyKey?: string,
  ): Promise<{ accepted: number; rejected: number; answers: { id: string; section: string; questionKey: string; status: string }[] }> {
    const supabase = getSupabaseService();

    // Validate session exists
    const { data: session, error: sessionError } = await supabase
      .from('agent_interview_sessions')
      .select('*')
      .eq('id', sessionId)
      .single();

    if (sessionError || !session) throw new NotFoundException('Session not found');
    if (session['status'] !== 'ACTIVE') throw new BadRequestException(`Session is ${session['status']}`);

    const projectId = session['project_id'];
    const results: { id: string; section: string; questionKey: string; status: string }[] = [];
    let accepted = 0;
    let rejected = 0;

    for (const answer of answers) {
      const id = randomUUID();

      // Check idempotency: same project + section + questionKey = update existing
      const { data: existing } = await supabase
        .from('agent_interview_answers')
        .select('id')
        .eq('project_id', projectId)
        .eq('section', answer.section)
        .eq('question_key', answer.questionKey)
        .maybeSingle();

      if (existing) {
        // Update existing answer
        const { error: updateError } = await supabase
          .from('agent_interview_answers')
          .update({
            answer_value: answer.answerValue,
            confidence: answer.confidence ?? null,
            source: answer.source ?? 'AGENT',
            question_label: answer.questionLabel ?? null,
          })
          .eq('id', existing['id']);

        if (updateError) {
          rejected++;
          continue;
        }
        results.push({ id: existing['id'], section: answer.section, questionKey: answer.questionKey, status: 'updated' });
        accepted++;
      } else {
        // Insert new answer
        const { error: insertError } = await supabase
          .from('agent_interview_answers')
          .insert({
            id,
            session_id: sessionId,
            project_id: projectId,
            section: answer.section,
            question_key: answer.questionKey,
            question_label: answer.questionLabel ?? null,
            answer_value: answer.answerValue,
            confidence: answer.confidence ?? null,
            source: answer.source ?? 'AGENT',
            idempotency_key: idempotencyKey ?? null,
          });

        if (insertError) {
          if (insertError.code === '23505') {
            // Duplicate key — try upsert-style skip
            rejected++;
            continue;
          }
          rejected++;
          continue;
        }
        results.push({ id, section: answer.section, questionKey: answer.questionKey, status: 'stored' });
        accepted++;
      }

      // Update session current_step
      await supabase
        .from('agent_interview_sessions')
        .update({ current_step: answer.section + '_' + answer.questionKey })
        .eq('id', sessionId);
    }

    this.audit.log({
      projectId,
      actorId: agentId,
      actorType: 'AGENT',
      action: 'answer.submit',
      resourceType: 'agent_interview_answer',
      resourceId: sessionId,
      changes: { accepted, rejected, sections: answers.map(a => a.section) },
    });

    return { accepted, rejected, answers: results };
  }

  async agentGetMissingFields(
    projectId: string,
  ): Promise<{ projectId: string; completeness: number; sections: { name: string; status: string; fieldsCompleted: number; fieldsTotal: number }[] }> {
    const ALL_SECTIONS = ['business_profile', 'sales_process', 'faq', 'prompt', 'handover', 'follow_up'];
    const supabase = getSupabaseService();

    const sections = [];
    let totalFields = 0;
    let completedFields = 0;

    for (const sectionName of ALL_SECTIONS) {
      // Count answers for this section
      const { count } = await supabase
        .from('agent_interview_answers')
        .select('*', { count: 'exact', head: true })
        .eq('project_id', projectId)
        .eq('section', sectionName);

      const fieldsCompleted = count ?? 0;
      const estimatedTotal = sectionName === 'faq' ? 15 : sectionName === 'business_profile' ? 12 : sectionName === 'prompt' ? 10 : 5;
      const status = fieldsCompleted === 0 ? 'EMPTY' : fieldsCompleted >= estimatedTotal ? 'COMPLETE' : 'PARTIAL';

      sections.push({ name: sectionName, status, fieldsCompleted, fieldsTotal: estimatedTotal });
      totalFields += estimatedTotal;
      completedFields += fieldsCompleted;
    }

    const completeness = totalFields > 0 ? Math.round((completedFields / totalFields) * 100) / 100 : 0;

    return { projectId, completeness, sections };
  }

  async agentRequestReview(
    projectId: string,
    agentId: string,
  ): Promise<{ projectId: string; status: string; submittedAt: string }> {
    const project = await this.getProject(projectId);
    if (!project) throw new NotFoundException('Project not found');

    const prevStatus = project.status;
    const allowed = ['DRAFT', 'CHANGES_REQUESTED'];
    if (!allowed.includes(prevStatus)) {
      throw new BadRequestException(`Cannot request review for project with status "${prevStatus}". Project is already in review or approved.`);
    }

    const supabase = getSupabaseService();
    const now = new Date().toISOString();

    const { error } = await supabase
      .from('onboarding_projects')
      .update({
        status: 'SUBMITTED',
        submitted_at: now,
        version: project.version + 1,
      })
      .eq('id', projectId);

    if (error) throw new BadRequestException(`Failed to submit for review: ${error.message}`);

    this.audit.log({
      projectId,
      actorId: agentId,
      actorType: 'AGENT',
      action: 'project.request_review',
      resourceType: 'onboarding_project',
      resourceId: projectId,
      changes: { previousStatus: prevStatus, newStatus: 'SUBMITTED' },
    });

    return { projectId, status: 'SUBMITTED', submittedAt: now };
  }

  async agentSubmitAnalysis(
    projectId: string,
    analysis: {
      summary: string;
      currentSalesWorkflow?: string;
      leadSources?: string[];
      qualificationProcess?: string;
      bookingProcess?: string;
      followUpProcess?: string;
      handoverProcess?: string;
      painPoints?: string[];
      conversionRisks?: string[];
      recommendedFocus?: string;
      confidence?: number;
      idempotencyKey?: string;
      recommendations?: Array<{
        title: string;
        description: string;
        type: string;
        riskLevel: string;
        businessValue?: string;
        suggestedTrigger?: string;
        suggestedAction?: string;
      }>;
    },
    agentId: string,
  ): Promise<{ analysisStored: boolean; recommendationsStored: number; recommendationIds: string[]; idempotent?: boolean }> {
    const project = await this.getProject(projectId);
    if (!project) throw new NotFoundException('Project not found');

    const supabase = getSupabaseService();

    // Upsert sales_process_maps with analysis data
    const { data: existingMap } = await supabase
      .from('sales_process_maps')
      .select('id')
      .eq('project_id', projectId)
      .maybeSingle();

    if (existingMap) {
      await supabase
        .from('sales_process_maps')
        .update({
          lead_sources: analysis.leadSources ?? [],
          conversation_goal: mapConversationGoal(analysis.recommendedFocus),
          primary_cta: analysis.recommendedFocus ?? null,
          conflicting_workflows: analysis.painPoints ?? [],
          section_status: 'COMPLETE',
        })
        .eq('id', existingMap['id']);
    } else {
      await supabase.from('sales_process_maps').insert({
        id: randomUUID(),
        project_id: projectId,
        lead_sources: analysis.leadSources ?? [],
        conversation_goal: mapConversationGoal(analysis.recommendedFocus),
        primary_cta: analysis.recommendedFocus ?? null,
        conflicting_workflows: analysis.painPoints ?? [],
        section_status: 'COMPLETE',
      });
    }

    // Idempotency: check if this analysis was already submitted
    if (analysis.idempotencyKey) {
      const { data: existingAudit } = await supabase
        .from('audit_events')
        .select('id')
        .eq('project_id', projectId)
        .eq('action', 'analysis.submit')
        .eq('correlation_id', analysis.idempotencyKey)
        .maybeSingle();

      if (existingAudit) {
        // Return existing recommendations for this project
        const { data: existingRecs } = await supabase
          .from('automation_recommendations')
          .select('id')
          .eq('project_id', projectId)
          .eq('source', 'AI_ANALYSIS')
          .eq('status', 'SUGGESTED');

        return {
          analysisStored: false,
          recommendationsStored: existingRecs?.length ?? 0,
          recommendationIds: (existingRecs || []).map((r: Record<string, unknown>) => String(r['id'] ?? '')),
          idempotent: true,
        };
      }
    }

    // Replace draft AI-generated recommendations: delete existing SUGGESTED
    // AI_ANALYSIS recommendations, preserve operator-modified/approved/rejected ones.
    await supabase
      .from('automation_recommendations')
      .delete()
      .eq('project_id', projectId)
      .eq('source', 'AI_ANALYSIS')
      .eq('status', 'SUGGESTED');

    // Store new recommendations
    const recommendationIds: string[] = [];
    if (analysis.recommendations && analysis.recommendations.length > 0) {
      for (const rec of analysis.recommendations) {
        const recId = randomUUID();
        const recType = mapRecommendationType(rec.type);
        const recRisk = mapRiskLevel(rec.riskLevel);

        await supabase.from('automation_recommendations').insert({
          id: recId,
          project_id: projectId,
          title: rec.title,
          description: rec.description,
          recommendation_type: recType,
          risk_level: recRisk,
          suggested_config: {
            businessValue: rec.businessValue,
            suggestedTrigger: rec.suggestedTrigger,
            suggestedAction: rec.suggestedAction,
          },
          status: 'SUGGESTED',
          source: 'AI_ANALYSIS',
        });
        recommendationIds.push(recId);
      }
    }

    this.audit.log({
      projectId,
      actorId: agentId,
      actorType: 'AGENT',
      action: 'analysis.submit',
      resourceType: 'sales_process_map',
      resourceId: projectId,
      changes: {
        summary: analysis.summary,
        leadSources: analysis.leadSources,
        recommendationCount: analysis.recommendations?.length ?? 0,
        confidence: analysis.confidence,
      },
      correlationId: analysis.idempotencyKey ?? undefined,
    });

    return {
      analysisStored: true,
      recommendationsStored: recommendationIds.length,
      recommendationIds,
    };
  }

  async getProjectAnalysis(projectId: string): Promise<Record<string, unknown> | null> {
    const supabase = getSupabaseService();
    const { data } = await supabase
      .from('sales_process_maps')
      .select('*')
      .eq('project_id', projectId)
      .maybeSingle();

    if (!data) return null;
    return {
      id: data['id'],
      leadSources: data['lead_sources'] ?? [],
      conversationGoal: data['conversation_goal'] ?? null,
      primaryCta: data['primary_cta'] ?? null,
      conflictingWorkflows: data['conflicting_workflows'] ?? [],
      sectionStatus: data['section_status'] ?? 'EMPTY',
    };
  }

  async getProjectRecommendations(projectId: string): Promise<Record<string, unknown>[]> {
    const supabase = getSupabaseService();
    const { data } = await supabase
      .from('automation_recommendations')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });

    return (data || []).map((r: Record<string, unknown>) => ({
      id: r['id'],
      title: r['title'],
      description: r['description'],
      recommendationType: r['recommendation_type'],
      riskLevel: r['risk_level'],
      suggestedConfig: r['suggested_config'] ?? {},
      status: r['status'],
      source: r['source'],
      createdAt: r['created_at'],
    }));
  }

  // ==========================================================================
  // KB SYNC DRY RUN (PR 9)
  // Dry run only — no KB mutation, no tenant creation, no messages.
  // ==========================================================================

  async kbDryRun(
    projectId: string,
    actorId: string,
    idempotencyKey?: string,
  ): Promise<Record<string, unknown>> {
    const project = await this.getProject(projectId);
    if (!project) throw new NotFoundException('Project not found');

    if (project.status !== 'APPROVED') {
      throw new BadRequestException(
        `Project must be APPROVED for dry-run. Current status: ${project.status}.`,
      );
    }

    const supabase = getSupabaseService();
    const now = new Date().toISOString();

    // Gather fresh source data
    const client = await this.getClient(project.onboardClientId);

    const { data: bizProfile } = await supabase
      .from('business_profiles')
      .select('*')
      .eq('project_id', projectId)
      .maybeSingle();

    const { data: salesMap } = await supabase
      .from('sales_process_maps')
      .select('*')
      .eq('project_id', projectId)
      .maybeSingle();

    const { data: faqItems } = await supabase
      .from('faq_items')
      .select('*')
      .eq('project_id', projectId)
      .eq('status', 'APPROVED');

    const { data: promptCfg } = await supabase
      .from('prompt_configs')
      .select('*')
      .eq('project_id', projectId)
      .maybeSingle();

    const { data: handover } = await supabase
      .from('handover_rules')
      .select('*')
      .eq('project_id', projectId)
      .maybeSingle();

    const { data: followUp } = await supabase
      .from('follow_up_rules')
      .select('*')
      .eq('project_id', projectId)
      .maybeSingle();

    const { data: recs } = await supabase
      .from('automation_recommendations')
      .select('*')
      .eq('project_id', projectId)
      .eq('status', 'SUGGESTED');

    // Build stable source snapshot — full sanitized content that would
    // materially change the KB dry-run payload if modified.
    // Excludes: secrets, full phones, volatile timestamps, actorId, syncRunId.
    const sourceSnapshot = {
      schemaVersion: 'kb-dry-run-v1',
      projectId,
      onboardClientId: project.onboardClientId,
      clientKey: client?.clientKey ?? null,
      displayName: client?.displayName ?? null,
      clientStatus: client?.status ?? null,
      projectStatus: project.status,
      projectVersion: project.version,
      // Business profile — full content
      businessProfile: bizProfile ? {
        businessName: bizProfile['business_name'],
        description: bizProfile['description'] ?? null,
        services: bizProfile['services'] ?? [],
        products: bizProfile['products'] ?? [],
        pricingPolicy: bizProfile['pricing_policy'] ?? null,
        depositPolicy: bizProfile['deposit_policy'] ?? null,
        openingHours: bizProfile['opening_hours'] ?? {},
        targetCustomer: bizProfile['target_customer'] ?? null,
        serviceArea: bizProfile['service_area'] ?? null,
        forbiddenTopics: bizProfile['forbidden_topics'] ?? [],
        forbiddenClaims: bizProfile['forbidden_claims'] ?? [],
        sectionStatus: bizProfile['section_status'],
      } : null,
      // Sales process — full content
      salesProcess: salesMap ? {
        leadSources: salesMap['lead_sources'] ?? [],
        conversationGoal: salesMap['conversation_goal'],
        primaryCta: salesMap['primary_cta'] ?? null,
        bookingLink: salesMap['booking_link'] ?? null,
        leadFieldsToCollect: salesMap['lead_fields_to_collect'] ?? [],
        maxQuestionsBeforeBooking: salesMap['max_questions_before_booking'],
        channelPreference: salesMap['channel_preference'],
        pipelineName: salesMap['pipeline_name'] ?? null,
        pipelineStages: salesMap['pipeline_stages'] ?? [],
        conflictingWorkflows: salesMap['conflicting_workflows'] ?? [],
        sectionStatus: salesMap['section_status'],
      } : null,
      // FAQ items — full content (questions + answers), sorted by order
      faqItems: (faqItems || []).map((f: Record<string, unknown>) => ({
        category: f['category'],
        question: f['question'],
        answer: f['answer'],
        sortOrder: f['sort_order'],
        status: f['status'],
      })).sort((a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0)),
      // Prompt config — full content
      promptConfig: promptCfg ? {
        persona: promptCfg['persona'],
        toneOfVoice: promptCfg['tone_of_voice'],
        conversationGoals: promptCfg['conversation_goals'] ?? [],
        businessNotes: promptCfg['business_notes'] ?? null,
        language: promptCfg['language'] ?? null,
        useSinglish: promptCfg['use_singlish'],
        maxReplyLength: promptCfg['max_reply_length'],
        exampleGoodReply: promptCfg['example_good_reply'] ?? null,
        exampleBadReply: promptCfg['example_bad_reply'] ?? null,
        greetings: promptCfg['greetings'] ?? [],
        signOffs: promptCfg['sign_offs'] ?? [],
        sectionStatus: promptCfg['section_status'],
      } : null,
      // Handover rules — full content
      handoverRules: handover ? {
        handoverContactName: handover['handover_contact_name'] ?? null,
        handoverMethod: handover['handover_method'],
        handoverAvailability: handover['handover_availability'] ?? null,
        emergencyContact: handover['emergency_contact'] ?? null,
        triggers: handover['triggers'] ?? [],
        sectionStatus: handover['section_status'],
      } : null,
      // Follow-up rules — full content
      followUpRules: followUp ? {
        enabled: followUp['enabled'],
        goal: followUp['goal'] ?? null,
        tone: followUp['tone'] ?? null,
        cadenceHours: followUp['cadence_hours'],
        stopConditions: followUp['stop_conditions'] ?? [],
        doNotMessageRules: followUp['do_not_message_rules'] ?? [],
        dormantReactivation: followUp['dormant_reactivation'],
        sectionStatus: followUp['section_status'],
      } : null,
      // Recommendations — full content (titles, descriptions, config), sorted by title
      recommendations: (recs || []).map((r: Record<string, unknown>) => ({
        title: r['title'],
        description: r['description'],
        recommendationType: r['recommendation_type'],
        riskLevel: r['risk_level'],
        suggestedConfig: r['suggested_config'] ?? {},
        status: r['status'],
        source: r['source'],
      })).sort((a, b) => String(a.title).localeCompare(String(b.title))),
    };

    const sourceSnapshotHash = createHash('sha256')
      .update(JSON.stringify(sourceSnapshot))
      .digest('hex');

    // Check latest dry-run for this project — only reuse if snapshot hasn't changed
    const { data: latestRun } = await supabase
      .from('sync_runs')
      .select('id, status, response_payload, request_payload')
      .eq('project_id', projectId)
      .eq('target_system', 'KB')
      .eq('mode', 'DRY_RUN')
      .eq('status', 'DRY_RUN_PASSED')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const cachedHash = latestRun?.['request_payload']?.['sourceSnapshotHash'];
    if (cachedHash && cachedHash === sourceSnapshotHash) {
      return {
        syncRunId: latestRun['id'],
        dryRun: true,
        idempotent: true,
        fresh: true,
        sourceSnapshotHash: sourceSnapshotHash.slice(0, 8),
        dryRunSchemaVersion: 'kb-dry-run-v1',
        targetSystem: 'KB',
        mode: 'DRY_RUN',
        status: latestRun['status'],
        payloadPreview: latestRun['response_payload'] ?? {},
        nextAllowedAction: 'KB apply sync is future PR 10 and remains disabled. Apply verifies snapshot hash matches current source.',
      };
    }

    // Build sections/blockers/warnings
    const sectionsIncluded: string[] = [];
    const missingFields: string[] = [];
    const warnings: string[] = [];
    const blockers: string[] = [];

    if (!client) {
      blockers.push('No onboard client found');
    } else {
      if (!client.displayName) missingFields.push('Client displayName');
      if (!client.clientKey) missingFields.push('Client clientKey');
    }

    if (bizProfile) {
      sectionsIncluded.push('business_profile');
      if (bizProfile['section_status'] !== 'APPROVED') {
        warnings.push('Business profile is not yet approved');
      }
    } else {
      missingFields.push('business_profile');
    }

    if (salesMap) sectionsIncluded.push('sales_process');

    if (faqItems && faqItems.length > 0) {
      sectionsIncluded.push(`faq (${faqItems.length} items)`);
    } else {
      missingFields.push('faq_items (none approved)');
    }

    if (promptCfg) {
      sectionsIncluded.push('prompt_config');
      if (promptCfg['section_status'] !== 'APPROVED') {
        warnings.push('Prompt config is not yet approved');
      }
    } else {
      missingFields.push('prompt_config');
    }

    if (handover) sectionsIncluded.push('handover_rules');
    else missingFields.push('handover_rules');
    if (followUp) sectionsIncluded.push('follow_up_rules');
    else missingFields.push('follow_up_rules');

    // Build payload preview (safe, non-mutating)
    const payloadPreview = {
      tenantIdentity: client ? {
        displayName: client.displayName,
        clientKey: client.clientKey,
        contactPhoneMasked: client.contactPhoneMasked,
        contactEmail: client.contactEmail ?? null,
        industry: client.industry ?? null,
        timezone: client.timezone ?? 'Asia/Singapore',
      } : null,
      businessProfile: bizProfile ? {
        businessName: bizProfile['business_name'],
        description: bizProfile['description'] ?? null,
        services: bizProfile['services'] ?? [],
        openingHours: bizProfile['opening_hours'] ?? {},
      } : null,
      salesProcess: salesMap ? {
        conversationGoal: salesMap['conversation_goal'] ?? null,
        primaryCta: salesMap['primary_cta'] ?? null,
        leadSources: salesMap['lead_sources'] ?? [],
      } : null,
      faqItems: (faqItems || []).map((f: Record<string, unknown>) => ({
        category: f['category'],
        question: f['question'],
      })),
      promptConfig: promptCfg ? {
        persona: promptCfg['persona'] ?? null,
        toneOfVoice: promptCfg['tone_of_voice'] ?? null,
        language: promptCfg['language'] ?? null,
      } : null,
      handoverRules: handover ? {
        handoverMethod: handover['handover_method'] ?? null,
        triggers: handover['triggers'] ?? [],
      } : null,
      followUpRules: followUp ? {
        enabled: followUp['enabled'] ?? false,
        goal: followUp['goal'] ?? null,
      } : null,
      aiRecommendationsForReview: (recs || []).map((r: Record<string, unknown>) => ({
        title: r['title'],
        recommendationType: r['recommendation_type'],
        riskLevel: r['risk_level'],
        status: r['status'],
        note: 'AI-suggested recommendation. Review and approve before future sync.',
      })),
    };

    // Generate sync_run with snapshot hash
    const syncRunId = randomUUID();
    const status = blockers.length > 0 ? 'DRY_RUN_FAILED' : 'DRY_RUN_PASSED';

    await supabase.from('sync_runs').insert({
      id: syncRunId,
      project_id: projectId,
      target_system: 'KB',
      mode: 'DRY_RUN',
      status,
      idempotency_key: idempotencyKey || `dry-run-${projectId}-${sourceSnapshotHash.slice(0, 8)}`,
      request_payload: {
        projectId,
        clientKey: client?.clientKey,
        dryRunSchemaVersion: 'kb-dry-run-v1',
        sourceSnapshotHash,
        sourceSnapshotFields: Object.keys(sourceSnapshot),
        generatedAt: now,
      },
      response_payload: {
        ...payloadPreview,
        _meta: {
          dryRunSchemaVersion: 'kb-dry-run-v1',
          sourceSnapshotHash: sourceSnapshotHash.slice(0, 8),
          generatedFromCurrentSource: true,
          cached: false,
        },
      },
      triggered_by: actorId,
      version: 1,
      duration_ms: null,
      completed_at: now,
    });

    this.audit.log({
      projectId,
      actorId,
      actorType: 'OPERATOR',
      action: 'sync.kb.dry_run',
      resourceType: 'sync_run',
      resourceId: syncRunId,
      changes: {
        status,
        sectionsIncluded,
        blockers,
        warnings,
        sourceSnapshotHash: sourceSnapshotHash.slice(0, 8),
      },
    });

    return {
      syncRunId,
      dryRun: true,
      idempotent: cachedHash !== undefined && cachedHash !== sourceSnapshotHash ? false : undefined,
      fresh: cachedHash === undefined || cachedHash !== sourceSnapshotHash,
      sourceSnapshotHash: sourceSnapshotHash.slice(0, 8),
      dryRunSchemaVersion: 'kb-dry-run-v1',
      previousRunStale: cachedHash !== undefined && cachedHash !== sourceSnapshotHash,
      targetSystem: 'KB',
      mode: 'DRY_RUN',
      status,
      onboardingProjectId: projectId,
      onboardClientId: project.onboardClientId,
      clientKey: client?.clientKey ?? null,
      displayName: client?.displayName ?? null,
      displayLabel: client?.displayLabel ?? null,
      generatedAt: now,
      generatedBy: actorId,
      payloadPreview,
      sectionsIncluded,
      missingFields,
      blockers,
      warnings,
      wouldCreate: blockers.length === 0,
      wouldUpdate: false,
      wouldSkip: blockers.length > 0,
      safetyChecks: {
        noKbMutation: true,
        noGhlMutation: true,
        noTenantCreation: true,
        noMessagesSent: true,
        payloadSanitized: true,
      },
      nextAllowedAction: 'KB apply sync is future PR 10 and remains disabled. Apply requires matching snapshot hash.',
    };
  }

  async getSyncRuns(projectId: string): Promise<Record<string, unknown>[]> {
    const supabase = getSupabaseService();
    const { data } = await supabase
      .from('sync_runs')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });

    return (data || []).map((r: Record<string, unknown>) => ({
      syncRunId: r['id'],
      targetSystem: r['target_system'],
      mode: r['mode'],
      status: r['status'],
      triggeredBy: r['triggered_by'],
      durationMs: r['duration_ms'],
      responsePayload: r['response_payload'],
      createdAt: r['created_at'],
      completedAt: r['completed_at'],
    }));
  }

  // ==========================================================================
  // KB SYNC APPLY (PR 10)
  // Apply approved dry-run payload to KB config behind strict gates.
  // ==========================================================================

  async kbApply(
    projectId: string,
    syncRunId: string,
    actorId: string,
    agencyId: string | undefined,
    idempotencyKey: string,
    confirmApply: boolean,
    applyScope?: string,
    operatorNote?: string,
  ): Promise<Record<string, unknown>> {
    if (!confirmApply) {
      throw new BadRequestException('confirmApply must be true');
    }

    // Feature flag gate
    const flagEnabled = (process.env['ONBOARD_KB_SYNC_ENABLED'] ?? 'false').toLowerCase() === 'true';
    if (!flagEnabled) {
      throw new BadRequestException('ONBOARD_KB_SYNC_ENABLED is not enabled. KB apply sync is blocked.');
    }

    const project = await this.getProject(projectId);
    if (!project) throw new NotFoundException('Project not found');

    if (project.status !== 'APPROVED') {
      throw new BadRequestException(`Project must be APPROVED for apply. Current status: ${project.status}`);
    }

    const supabase = getSupabaseService();

    // Idempotency check
    const { data: existingApply } = await supabase
      .from('sync_runs')
      .select('id, status')
      .eq('project_id', projectId)
      .eq('target_system', 'KB')
      .eq('mode', 'APPLY')
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();

    if (existingApply) {
      return {
        syncRunId: existingApply['id'],
        idempotent: true,
        status: existingApply['status'],
        message: 'Apply already processed with this idempotency key.',
      };
    }

    // Fetch the dry-run
    const { data: dryRun } = await supabase
      .from('sync_runs')
      .select('*')
      .eq('id', syncRunId)
      .single();

    if (!dryRun) throw new NotFoundException('syncRunId not found');

    if (dryRun['project_id'] !== projectId) {
      throw new BadRequestException('syncRun does not belong to this project');
    }
    if (dryRun['target_system'] !== 'KB') {
      throw new BadRequestException('syncRun targetSystem must be KB');
    }
    if (dryRun['mode'] !== 'DRY_RUN') {
      throw new BadRequestException('syncRun mode must be DRY_RUN');
    }
    if (dryRun['status'] !== 'DRY_RUN_PASSED') {
      throw new BadRequestException(`syncRun status is ${dryRun['status']}, not DRY_RUN_PASSED`);
    }

    const dryRunReqPayload = dryRun['request_payload'] as Record<string, unknown> | null;
    const schemaVersion = dryRunReqPayload?.['dryRunSchemaVersion'];
    if (schemaVersion !== 'kb-dry-run-v1') {
      throw new BadRequestException(`Unsupported dryRunSchemaVersion: ${String(schemaVersion)}. Expected kb-dry-run-v1. Run a new dry-run.`);
    }

    const dryRunSnapshotHash = dryRunReqPayload?.['sourceSnapshotHash'] as string | undefined;
    if (!dryRunSnapshotHash) {
      throw new BadRequestException('Dry-run does not have sourceSnapshotHash. Run a new dry-run.');
    }

    // Rebuild current source snapshot and compare
    const currentHash = await this.buildCurrentSnapshotHash(projectId);
    if (currentHash !== dryRunSnapshotHash) {
      throw new BadRequestException(
        `Source snapshot has changed since dry-run. Dry-run hash: ${String(dryRunSnapshotHash).slice(0, 8)}, current hash: ${currentHash.slice(0, 8)}. Run a new dry-run before applying.`,
      );
    }

    // All gates passed — execute tenant-only KB apply (PR 10D)
    const applyRunId = randomUUID();
    const now = new Date().toISOString();
    const client = await this.getClient(project.onboardClientId);

    if (!agencyId) {
      throw new BadRequestException('Operator agency is required for KB tenant creation. No agency found on session.');
    }

    const tenantName = client?.displayName ?? project.displayLabel ?? 'Unnamed Onboard Client';

    // Check identity map — if kbTenantId already exists, skip creation
    const { data: existingIdMap } = await supabase
      .from('onboarding_identity_map')
      .select('kb_tenant_id, id')
      .eq('project_id', projectId)
      .maybeSingle();

    let kbTenantId: string | null = existingIdMap?.['kb_tenant_id'] ?? null;
    let tenantCreated = false;

    if (!kbTenantId) {
      try {
        // Masked phone is display-only — do NOT write into real contact phone fields.
        // Pass null so real phone fields are stored empty.
        const tenant = await this.tenantsService.createTenant(agencyId, actorId, {
          name: tenantName,
          ghlLocationId: null,
          clientContactName: client?.contactName ?? null,
          clientContactPhone: null,
          clientContactEmail: client?.contactEmail ?? null,
        });

        kbTenantId = tenant.id;
        tenantCreated = true;

        // Update onboarding_identity_map
        if (existingIdMap) {
          await supabase.from('onboarding_identity_map').update({ kb_tenant_id: kbTenantId }).eq('id', existingIdMap['id']);
        } else {
          await supabase.from('onboarding_identity_map').insert({
            id: randomUUID(),
            project_id: projectId,
            onboard_client_id: project.onboardClientId,
            kb_tenant_id: kbTenantId,
          });
        }
      } catch (err) {
        const reason = `TENANT_CREATE_FAILED: ${err instanceof Error ? err.message : String(err)}`;
        await supabase.from('sync_runs').insert({
          id: applyRunId, project_id: projectId, target_system: 'KB', mode: 'APPLY',
          status: 'APPLY_FAILED', idempotency_key: idempotencyKey,
          request_payload: { parentDryRunId: syncRunId, dryRunSchemaVersion: schemaVersion, sourceSnapshotHash: dryRunSnapshotHash, confirmedBy: actorId },
          response_payload: { reason, tenantCreated: false },
          error_message: reason, triggered_by: actorId, version: 1, completed_at: now,
        });

        this.audit.log({
          projectId, actorId, actorType: 'OPERATOR', action: 'sync.kb.apply_failed',
          resourceType: 'sync_run', resourceId: applyRunId,
          changes: { reason, dryRunSyncRunId: syncRunId, sourceSnapshotHash: dryRunSnapshotHash.slice(0, 8) },
        });

        throw new BadRequestException(reason);
      }
    }

    // ===== FAQ / Knowledge apply (PR 10F) =====
    if (applyScope === 'FAQ_KNOWLEDGE_ONLY') {
      if (!kbTenantId) {
        throw new BadRequestException('No KB tenant found. Apply tenant identity first (PR 10D).');
      }

      const { data: faqItems } = await supabase
        .from('faq_items')
        .select('*')
        .eq('project_id', projectId)
        .eq('status', 'APPROVED');

      if (!faqItems || faqItems.length === 0) {
        throw new BadRequestException('No approved FAQ items found. Approve FAQ items first.');
      }

      let faqCreated = 0;
      let faqSkipped = 0;
      try {
        for (const item of faqItems) {
          const question = String(item['question'] ?? '');
          const answer = String(item['answer'] ?? '');
          if (!question || !answer) { faqSkipped++; continue; }

          // Check for duplicate FAQ by question text within tenant
          const { data: existingDoc } = await supabase
            .from('knowledge_documents')
            .select('id')
            .eq('tenant_id', kbTenantId)
            .eq('source', 'faq')
            .eq('title', `FAQ: ${question.slice(0, 200)}`)
            .maybeSingle();

          if (existingDoc) {
            faqSkipped++;
            continue;
          }

          await this.kbService.createFaq(kbTenantId, question, answer);
          faqCreated++;
        }
      } catch (err) {
        const reason = `FAQ_CREATE_FAILED: ${err instanceof Error ? err.message : String(err)}`;
        await supabase.from('sync_runs').insert({
          id: applyRunId, project_id: projectId, target_system: 'KB', mode: 'APPLY',
          status: 'APPLY_FAILED', idempotency_key: idempotencyKey,
          request_payload: { parentDryRunId: syncRunId, appliedScope: 'FAQ_KNOWLEDGE_ONLY' },
          response_payload: { reason, faqCreated, faqSkipped },
          error_message: reason, triggered_by: actorId, version: 1, completed_at: now,
        });
        this.audit.log({ projectId, actorId, actorType: 'OPERATOR', action: 'sync.kb.apply_failed', resourceType: 'sync_run', resourceId: applyRunId, changes: { reason } });
        throw new BadRequestException(reason);
      }

      await supabase.from('sync_runs').insert({
        id: applyRunId, project_id: projectId, target_system: 'KB', mode: 'APPLY',
        status: 'APPLIED', idempotency_key: idempotencyKey,
        request_payload: {
          parentDryRunId: syncRunId, dryRunSchemaVersion: schemaVersion,
          sourceSnapshotHash: dryRunSnapshotHash, confirmedBy: actorId,
          appliedScope: 'FAQ_KNOWLEDGE_ONLY',
        },
        response_payload: {
          appliedScope: 'FAQ_KNOWLEDGE_ONLY', kbTenantId,
          faqCreated, faqUpdated: 0, faqSkipped,
          knowledgeSynced: true,
          botProfileActive: false, activationDeferred: true,
          skipped: ['BOOKING_SETTINGS', 'HANDOVER_SETTINGS', 'FOLLOW_UP_SETTINGS', 'GHL_SYNC', 'OUTBOUND_SENDING', 'BOT_ACTIVATION'],
          noMessagesSent: true, noGhlSync: true, outboundEnabled: false,
        },
        triggered_by: actorId, version: 1, duration_ms: null, completed_at: now,
      });

      this.audit.log({ projectId, actorId, actorType: 'OPERATOR', action: 'sync.kb.apply_succeeded', resourceType: 'sync_run', resourceId: applyRunId, changes: { scope: 'FAQ_KNOWLEDGE_ONLY', kbTenantId: kbTenantId.slice(0, 8), faqCreated } });

      return {
        syncRunId: applyRunId, applied: true, appliedScope: 'FAQ_KNOWLEDGE_ONLY', status: 'APPLIED',
        kbTenantId, faqCreated, faqUpdated: 0, faqSkipped,
        knowledgeSynced: true, botProfileActive: false, activationDeferred: true,
        skipped: ['BOOKING_SETTINGS', 'HANDOVER_SETTINGS', 'FOLLOW_UP_SETTINGS', 'GHL_SYNC', 'OUTBOUND_SENDING', 'BOT_ACTIVATION'],
        noMessagesSent: true, noGhlSync: true, outboundEnabled: false,
        dryRunSyncRunId: syncRunId, sourceSnapshotHash: dryRunSnapshotHash.slice(0, 8),
        appliedAt: now, appliedBy: actorId,
        message: 'FAQ / knowledge synced. Bot activation, booking, follow-up, handover, GHL, and outbound are not synced.',
      };
    }

    // ===== Bot Profile + Prompt Config apply (PR 10E) =====
    if (applyScope === 'BOT_PROFILE_PROMPT_ONLY') {
      if (!kbTenantId) {
        throw new BadRequestException('No KB tenant found. Apply tenant identity first (PR 10D).');
      }

      const { data: promptCfg } = await supabase
        .from('prompt_configs')
        .select('*')
        .eq('project_id', projectId)
        .maybeSingle();

      if (!promptCfg) {
        throw new BadRequestException('No approved prompt config found. Approve the prompt config section first.');
      }

      let botProfileCreated = false;
      try {
        // Check for existing Onboard-created bot profile to avoid duplicates
        const { data: existingProfile } = await supabase
          .from('tenant_bot_profiles')
          .select('id')
          .eq('tenant_id', kbTenantId)
          .eq('name', 'Onboard Config')
          .maybeSingle();

        if (existingProfile) {
          botProfileCreated = false;
        } else {
          await this.botProfilesService.createBotProfile(actorId, kbTenantId, {
            name: 'Onboard Config',
            persona: promptCfg['persona'] ?? '',
            conversationGoals: Array.isArray(promptCfg['conversation_goals'])
              ? (promptCfg['conversation_goals'] as string[]).join('\n')
              : (promptCfg['conversation_goals'] ?? ''),
            businessNotes: promptCfg['business_notes'] ?? '',
            toneRules: promptCfg['tone_of_voice'] ?? '',
            setActive: false,
          });
          botProfileCreated = true;
        }
      } catch (err) {
        const reason = `BOT_PROFILE_CREATE_FAILED: ${err instanceof Error ? err.message : String(err)}`;
        await supabase.from('sync_runs').insert({
          id: applyRunId, project_id: projectId, target_system: 'KB', mode: 'APPLY',
          status: 'APPLY_FAILED', idempotency_key: idempotencyKey,
          request_payload: { parentDryRunId: syncRunId, appliedScope: 'BOT_PROFILE_PROMPT_ONLY' },
          response_payload: { reason, botProfileCreated: false },
          error_message: reason, triggered_by: actorId, version: 1, completed_at: now,
        });
        this.audit.log({ projectId, actorId, actorType: 'OPERATOR', action: 'sync.kb.apply_failed', resourceType: 'sync_run', resourceId: applyRunId, changes: { reason } });
        throw new BadRequestException(reason);
      }

      await supabase.from('sync_runs').insert({
        id: applyRunId, project_id: projectId, target_system: 'KB', mode: 'APPLY',
        status: 'APPLIED', idempotency_key: idempotencyKey,
        request_payload: {
          parentDryRunId: syncRunId, dryRunSchemaVersion: schemaVersion,
          sourceSnapshotHash: dryRunSnapshotHash, confirmedBy: actorId,
          appliedScope: 'BOT_PROFILE_PROMPT_ONLY',
        },
        response_payload: {
          appliedScope: 'BOT_PROFILE_PROMPT_ONLY', kbTenantId,
          botProfileCreated, botProfileReused: !botProfileCreated,
          promptConfigSynced: true,
          botProfileActive: false,
          activationDeferred: true,
          skipped: ['FAQ_KNOWLEDGE', 'BOOKING_SETTINGS', 'HANDOVER_SETTINGS', 'FOLLOW_UP_SETTINGS', 'GHL_SYNC', 'OUTBOUND_SENDING', 'BOT_ACTIVATION'],
          noMessagesSent: true, noGhlSync: true, outboundEnabled: false,
        },
        triggered_by: actorId, version: 1, duration_ms: null, completed_at: now,
      });

      this.audit.log({ projectId, actorId, actorType: 'OPERATOR', action: 'sync.kb.apply_succeeded', resourceType: 'sync_run', resourceId: applyRunId, changes: { scope: 'BOT_PROFILE_PROMPT_ONLY', kbTenantId: kbTenantId.slice(0, 8) } });

      return {
        syncRunId: applyRunId, applied: true, appliedScope: 'BOT_PROFILE_PROMPT_ONLY', status: 'APPLIED',
        kbTenantId, botProfileCreated, botProfileReused: !botProfileCreated,
        promptConfigSynced: true, botProfileActive: false, activationDeferred: true,
        skipped: ['FAQ_KNOWLEDGE', 'BOOKING_SETTINGS', 'HANDOVER_SETTINGS', 'FOLLOW_UP_SETTINGS', 'GHL_SYNC', 'OUTBOUND_SENDING', 'BOT_ACTIVATION'],
        noMessagesSent: true, noGhlSync: true, outboundEnabled: false,
        dryRunSyncRunId: syncRunId, sourceSnapshotHash: dryRunSnapshotHash.slice(0, 8),
        appliedAt: now, appliedBy: actorId,
        message: 'Bot profile and prompt config synced as inactive/draft. Activation is deferred to a future controlled go-live PR.',
      };
    }

    // ===== Tenant identity only (default) =====
    await supabase.from('sync_runs').insert({
      id: applyRunId, project_id: projectId, target_system: 'KB', mode: 'APPLY',
      status: 'APPLIED', idempotency_key: idempotencyKey,
      request_payload: {
        parentDryRunId: syncRunId, dryRunSchemaVersion: schemaVersion,
        sourceSnapshotHash: dryRunSnapshotHash, confirmedBy: actorId,
        appliedScope: 'TENANT_IDENTITY_ONLY',
      },
      response_payload: {
        appliedScope: 'TENANT_IDENTITY_ONLY',
        kbTenantId,
        tenantCreated,
        tenantReused: !tenantCreated,
        identityMapUpdated: true,
        skipped: ['BOT_PROFILE', 'PROMPT_CONFIG', 'FAQ_KNOWLEDGE', 'BOOKING_SETTINGS', 'HANDOVER_SETTINGS', 'FOLLOW_UP_SETTINGS', 'GHL_SYNC', 'OUTBOUND_SENDING'],
        noMessagesSent: true,
        noGhlSync: true,
        outboundEnabled: false,
        botConfigSynced: false,
      },
      triggered_by: actorId, version: 1, duration_ms: null, completed_at: now,
    });

    this.audit.log({
      projectId, actorId, actorType: 'OPERATOR', action: 'sync.kb.apply_succeeded',
      resourceType: 'sync_run', resourceId: applyRunId,
      changes: {
        scope: 'TENANT_IDENTITY_ONLY', kbTenantId: kbTenantId?.slice(0, 8),
        tenantCreated, sourceSnapshotHash: dryRunSnapshotHash.slice(0, 8), idempotencyKey: idempotencyKey.slice(0, 8),
      },
    });

    return {
      syncRunId: applyRunId,
      applied: true,
      appliedScope: 'TENANT_IDENTITY_ONLY',
      status: 'APPLIED',
      kbTenantId,
      tenantCreated,
      tenantReused: !tenantCreated,
      identityMapUpdated: true,
      skipped: ['BOT_PROFILE', 'PROMPT_CONFIG', 'FAQ_KNOWLEDGE', 'BOOKING_SETTINGS', 'HANDOVER_SETTINGS', 'FOLLOW_UP_SETTINGS', 'GHL_SYNC', 'OUTBOUND_SENDING'],
      noMessagesSent: true,
      noGhlSync: true,
      outboundEnabled: false,
      botConfigSynced: false,
      dryRunSyncRunId: syncRunId,
      sourceSnapshotHash: dryRunSnapshotHash.slice(0, 8),
      appliedAt: now,
      appliedBy: actorId,
      message: 'Tenant identity sync completed. Bot brain/config is not synced yet.',
    };
  }

  private async buildCurrentSnapshotHash(projectId: string): Promise<string> {
    const project = await this.getProject(projectId);
    if (!project) throw new NotFoundException('Project not found');

    const supabase = getSupabaseService();
    const client = await this.getClient(project.onboardClientId);

    const { data: bizProfile } = await supabase.from('business_profiles').select('*').eq('project_id', projectId).maybeSingle();
    const { data: salesMap } = await supabase.from('sales_process_maps').select('*').eq('project_id', projectId).maybeSingle();
    const { data: faqItems } = await supabase.from('faq_items').select('*').eq('project_id', projectId).eq('status', 'APPROVED');
    const { data: promptCfg } = await supabase.from('prompt_configs').select('*').eq('project_id', projectId).maybeSingle();
    const { data: handover } = await supabase.from('handover_rules').select('*').eq('project_id', projectId).maybeSingle();
    const { data: followUp } = await supabase.from('follow_up_rules').select('*').eq('project_id', projectId).maybeSingle();
    const { data: recs } = await supabase.from('automation_recommendations').select('*').eq('project_id', projectId).eq('status', 'SUGGESTED');

    const sourceSnapshot = {
      schemaVersion: 'kb-dry-run-v1',
      projectId,
      onboardClientId: project.onboardClientId,
      clientKey: client?.clientKey ?? null,
      displayName: client?.displayName ?? null,
      clientStatus: client?.status ?? null,
      projectStatus: project.status,
      projectVersion: project.version,
      businessProfile: bizProfile ? {
        businessName: bizProfile['business_name'], description: bizProfile['description'] ?? null,
        services: bizProfile['services'] ?? [], products: bizProfile['products'] ?? [],
        pricingPolicy: bizProfile['pricing_policy'] ?? null, depositPolicy: bizProfile['deposit_policy'] ?? null,
        openingHours: bizProfile['opening_hours'] ?? {}, targetCustomer: bizProfile['target_customer'] ?? null,
        serviceArea: bizProfile['service_area'] ?? null, forbiddenTopics: bizProfile['forbidden_topics'] ?? [],
        forbiddenClaims: bizProfile['forbidden_claims'] ?? [], sectionStatus: bizProfile['section_status'],
      } : null,
      salesProcess: salesMap ? {
        leadSources: salesMap['lead_sources'] ?? [], conversationGoal: salesMap['conversation_goal'],
        primaryCta: salesMap['primary_cta'] ?? null, bookingLink: salesMap['booking_link'] ?? null,
        leadFieldsToCollect: salesMap['lead_fields_to_collect'] ?? [],
        maxQuestionsBeforeBooking: salesMap['max_questions_before_booking'],
        channelPreference: salesMap['channel_preference'], pipelineName: salesMap['pipeline_name'] ?? null,
        pipelineStages: salesMap['pipeline_stages'] ?? [], conflictingWorkflows: salesMap['conflicting_workflows'] ?? [],
        sectionStatus: salesMap['section_status'],
      } : null,
      faqItems: (faqItems || []).map((f: Record<string, unknown>) => ({
        category: f['category'], question: f['question'], answer: f['answer'],
        sortOrder: f['sort_order'], status: f['status'],
      })).sort((a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0)),
      promptConfig: promptCfg ? {
        persona: promptCfg['persona'], toneOfVoice: promptCfg['tone_of_voice'],
        conversationGoals: promptCfg['conversation_goals'] ?? [], businessNotes: promptCfg['business_notes'] ?? null,
        language: promptCfg['language'] ?? null, useSinglish: promptCfg['use_singlish'],
        maxReplyLength: promptCfg['max_reply_length'], exampleGoodReply: promptCfg['example_good_reply'] ?? null,
        exampleBadReply: promptCfg['example_bad_reply'] ?? null, greetings: promptCfg['greetings'] ?? [],
        signOffs: promptCfg['sign_offs'] ?? [], sectionStatus: promptCfg['section_status'],
      } : null,
      handoverRules: handover ? {
        handoverContactName: handover['handover_contact_name'] ?? null,
        handoverMethod: handover['handover_method'], handoverAvailability: handover['handover_availability'] ?? null,
        emergencyContact: handover['emergency_contact'] ?? null, triggers: handover['triggers'] ?? [],
        sectionStatus: handover['section_status'],
      } : null,
      followUpRules: followUp ? {
        enabled: followUp['enabled'], goal: followUp['goal'] ?? null, tone: followUp['tone'] ?? null,
        cadenceHours: followUp['cadence_hours'], stopConditions: followUp['stop_conditions'] ?? [],
        doNotMessageRules: followUp['do_not_message_rules'] ?? [], dormantReactivation: followUp['dormant_reactivation'],
        sectionStatus: followUp['section_status'],
      } : null,
      recommendations: (recs || []).map((r: Record<string, unknown>) => ({
        title: r['title'], description: r['description'], recommendationType: r['recommendation_type'],
        riskLevel: r['risk_level'], suggestedConfig: r['suggested_config'] ?? {}, status: r['status'],
        source: r['source'],
      })).sort((a, b) => String(a.title).localeCompare(String(b.title))),
    };

    return createHash('sha256').update(JSON.stringify(sourceSnapshot)).digest('hex');
  }

  async kbPlanPreview(projectId: string): Promise<Record<string, unknown>> {
    const project = await this.getProject(projectId);
    if (!project) throw new NotFoundException('Project not found');

    const supabase = getSupabaseService();
    const client = await this.getClient(project.onboardClientId);

    let persona: string | null = null;
    let conversationGoals: string | null = null;
    let businessNotes: string | null = null;
    let toneRules: string | null = null;
    let maxReplyTokens: number | null = null;

    const { data: promptCfg } = await supabase
      .from('prompt_configs')
      .select('*')
      .eq('project_id', projectId)
      .maybeSingle();

    if (promptCfg) {
      persona = promptCfg['persona'] ?? null;
      const goals = promptCfg['conversation_goals'];
      conversationGoals = Array.isArray(goals) ? (goals as string[]).join(', ') : null;
      businessNotes = promptCfg['business_notes'] ?? null;
      toneRules = promptCfg['tone_of_voice'] ?? null;
      maxReplyTokens = promptCfg['max_reply_length'] ?? null;
    }

    const { data: faqItems } = await supabase
      .from('faq_items')
      .select('*')
      .eq('project_id', projectId)
      .eq('status', 'APPROVED');

    const { data: salesMap } = await supabase
      .from('sales_process_maps')
      .select('*')
      .eq('project_id', projectId)
      .maybeSingle();

    const { data: followUp } = await supabase
      .from('follow_up_rules')
      .select('*')
      .eq('project_id', projectId)
      .maybeSingle();

    const { data: handover } = await supabase
      .from('handover_rules')
      .select('*')
      .eq('project_id', projectId)
      .maybeSingle();

    const plans = mapOnboardToKbPlan({
      tenantName: client?.displayName ?? 'Unnamed',
      agencyId: 'operator-agency', // Placeholder — actual agency from operator's session in real apply
      clientContactName: client?.contactName ?? null,
      clientContactPhone: client?.contactPhoneMasked ?? null,
      clientContactEmail: client?.contactEmail ?? null,
      persona,
      conversationGoals,
      businessNotes,
      toneRules,
      maxReplyTokens,
      faqItems: (faqItems || []).map((f: Record<string, unknown>) => ({
        question: String(f['question'] ?? ''),
        answer: String(f['answer'] ?? ''),
        category: f['category'] ? String(f['category']) : undefined,
      })),
      bookingEnabled: Boolean(salesMap),
      bookingLink: salesMap?.['booking_link'] ?? null,
      leadFields: ['name', 'phone'],
      followUpEnabled: followUp?.['enabled'] ?? false,
      followUpGoal: followUp?.['goal'] ?? null,
      followUpCadenceHours: followUp?.['cadence_hours'] ?? null,
      handoverEnabled: handover?.['section_status'] === 'APPROVED',
      handoverPhone: handover?.['handover_contact_phone'] ?? null,
    });

    const totalOps = plans.reduce((sum, p) => sum + p.operations.length, 0);
    const allTables = plans.flatMap(p => p.operations.map(o => o.table));

    const blockers: string[] = [];
    const warnings: string[] = [];

    if (!client?.displayName) blockers.push('Missing client displayName');
    if (!persona) warnings.push('No prompt config persona set');
    if (!faqItems || faqItems.length === 0) warnings.push('No approved FAQ items');

    return {
      dryRun: true,
      noWrite: true,
      projectId,
      displayName: client?.displayName ?? null,
      operationCount: totalOps,
      phaseCount: plans.length,
      phases: plans.map(p => ({
        phase: p.phase,
        name: p.phaseName,
        operationCount: p.operations.length,
        operations: p.operations.map(o => ({
          table: o.table,
          operation: o.operation,
          notes: o.notes,
        })),
      })),
      targetTables: [...new Set(allTables)],
      wouldCreate: totalOps,
      wouldUpdate: 0,
      wouldSkip: 0,
      blockers,
      warnings,
      safetyChecks: {
        noKbMutation: true,
        noGhlMutation: true,
        noMessagesSent: true,
        noOutboundEnabled: true,
        secretsExcluded: true,
        fullPhoneExcluded: true,
      },
    };
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

function mapConversationGoal(focus?: string): string | null {
  if (!focus) return null;
  const lower = focus.toLowerCase();
  if (lower.includes('book') || lower.includes('appointment')) return 'BOOK_APPOINTMENT';
  if (lower.includes('lead') || lower.includes('qualify')) return 'QUALIFY_LEAD';
  if (lower.includes('faq') || lower.includes('answer')) return 'ANSWER_FAQS';
  if (lower.includes('human') || lower.includes('route')) return 'ROUTE_TO_HUMAN';
  return 'OTHER';
}

function mapRecommendationType(type: string): string {
  const upper = type.toUpperCase().replace(/[\s-]/g, '_');
  const valid = ['BOOKING', 'HANDOVER', 'FOLLOW_UP', 'TAGGING', 'PROMPT', 'KNOWLEDGE'];
  return valid.includes(upper) ? upper : 'OTHER';
}

function mapRiskLevel(level: string): string {
  const upper = level.toUpperCase();
  const valid = ['LOW', 'MEDIUM', 'HIGH'];
  return valid.includes(upper) ? upper : 'MEDIUM';
}
