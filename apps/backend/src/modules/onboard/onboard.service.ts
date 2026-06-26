import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { getSupabaseService } from '../../lib/supabase';
import { randomUUID } from 'node:crypto';
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

    // Idempotency: check if dry-run already exists for this project
    const idKey = idempotencyKey || `dry-run-${projectId}`;
    const { data: existingRun } = await supabase
      .from('sync_runs')
      .select('id, status, response_payload')
      .eq('project_id', projectId)
      .eq('target_system', 'KB')
      .eq('mode', 'DRY_RUN')
      .eq('status', 'DRY_RUN_PASSED')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingRun) {
      return {
        syncRunId: existingRun['id'],
        dryRun: true,
        idempotent: true,
        targetSystem: 'KB',
        mode: 'DRY_RUN',
        status: existingRun['status'],
        payloadPreview: existingRun['response_payload'] ?? {},
        nextAllowedAction: 'KB apply sync is future PR 10 and remains disabled.',
      };
    }

    // Gather data for preview
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

    // Build sections included
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

    // Generate sync_run
    const syncRunId = randomUUID();
    const status = blockers.length > 0 ? 'DRY_RUN_FAILED' : 'DRY_RUN_PASSED';
    const now = new Date().toISOString();

    await supabase.from('sync_runs').insert({
      id: syncRunId,
      project_id: projectId,
      target_system: 'KB',
      mode: 'DRY_RUN',
      status,
      idempotency_key: idKey,
      request_payload: { projectId, clientKey: client?.clientKey },
      response_payload: payloadPreview,
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
      changes: { status, sectionsIncluded, blockers, warnings },
    });

    return {
      syncRunId,
      dryRun: true,
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
      nextAllowedAction: 'KB apply sync is future PR 10 and remains disabled.',
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
