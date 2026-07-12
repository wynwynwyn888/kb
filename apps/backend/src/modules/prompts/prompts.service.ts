// Prompts service — tenant prompt configs & agency system policies (Supabase)

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { getSupabaseService } from '../../lib/supabase';
import { AuthService } from '../auth/auth.service';
import { parsePromptSections } from '../../lib/tenant-bot-profile-prompt';
import { agencyRoleCanReadTenant } from '../authorization/authorization-policy.service';

export interface TenantPromptDto {
  id: string;
  tenantId: string;
  name: string;
  systemPrompt: string;
  temperature: number;
  modelOverride: string | null;
  maxTokens: number | null;
  promptVariables: Record<string, unknown>;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AgencyPolicyDto {
  id: string;
  agencyId: string;
  name: string;
  content: string;
  priority: number;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class PromptsService {
  constructor(private readonly auth: AuthService) {}

  /** Mirrors tenants access: tenant_users member OR agency member for tenant's agency. */
  async canAccessTenant(profileId: string, tenantId: string): Promise<boolean> {
    const supabase = getSupabaseService();
    const { data: tu } = await supabase
      .from('tenant_users')
      .select('id')
      .eq('profile_id', profileId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (tu) return true;

    const { data: tenant } = await supabase
      .from('tenants')
      .select('agency_id')
      .eq('id', tenantId)
      .maybeSingle();
    if (!tenant) return false;

    const { data: au } = await supabase
      .from('agency_users')
      .select('role')
      .eq('profile_id', profileId)
      .eq('agency_id', tenant.agency_id as string)
      .maybeSingle();
    return agencyRoleCanReadTenant(au?.role);
  }

  async canManageTenantPrompts(profileId: string, tenantId: string): Promise<boolean> {
    if (await this.auth.isTenantAdmin(profileId, tenantId)) {
      return true;
    }
    const supabase = getSupabaseService();
    const { data: tenant } = await supabase
      .from('tenants')
      .select('agency_id')
      .eq('id', tenantId)
      .maybeSingle();
    if (!tenant) return false;
    return this.auth.isAgencyAdmin(profileId, tenant.agency_id as string);
  }

  async listTenantPrompts(
    tenantId: string,
    profileId: string,
  ): Promise<TenantPromptDto[]> {
    if (!(await this.canAccessTenant(profileId, tenantId))) {
      throw new NotFoundException('Tenant not found');
    }
    const supabase = getSupabaseService();
    const { data, error } = await supabase
      .from('tenant_prompt_configs')
      .select(
        'id, tenant_id, name, system_prompt, temperature, model_override, max_tokens, prompt_variables, is_active, created_at, updated_at',
      )
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: true });

    if (error) {
      throw new BadRequestException(`Failed to list prompt configs: ${error.message}`);
    }

    return (data ?? []).map(row => this.mapTenantRow(row as Record<string, unknown>));
  }

  async upsertTenantPrompt(
    profileId: string,
    body: {
      tenantId: string;
      name: string;
      systemPrompt: string;
      temperature?: number;
      modelOverride?: string;
      maxTokens?: number;
      promptVariables?: Record<string, unknown>;
      isActive?: boolean;
    },
  ): Promise<TenantPromptDto> {
    const { tenantId, name, systemPrompt } = body;
    if (!(await this.canManageTenantPrompts(profileId, tenantId))) {
      throw new ForbiddenException('Insufficient permissions to manage tenant prompts');
    }

    const supabase = getSupabaseService();
    const now = new Date().toISOString();
    const temperature = body.temperature ?? 0.7;
    const promptVariables = body.promptVariables ?? {};
    const isActive = body.isActive ?? true;

    const { data: existing } = await supabase
      .from('tenant_prompt_configs')
      .select('id, bot_profile_id')
      .eq('tenant_id', tenantId)
      .eq('name', name.trim())
      .maybeSingle();

    if (existing?.id) {
      const parsed = parsePromptSections(systemPrompt);
      if (existing.bot_profile_id) {
        await supabase
          .from('tenant_bot_profiles')
          .update({
            name: name.trim(),
            persona: parsed.persona,
            conversation_goals: parsed.goals,
            business_notes: parsed.additional,
            updated_at: now,
          })
          .eq('tenant_id', tenantId)
          .eq('id', existing.bot_profile_id as string);
      }
      const { data: updated, error: ue } = await supabase
        .from('tenant_prompt_configs')
        .update({
          system_prompt: systemPrompt,
          temperature,
          model_override: body.modelOverride ?? null,
          max_tokens: body.maxTokens ?? null,
          prompt_variables: promptVariables,
          is_active: isActive,
          updated_at: now,
        })
        .eq('tenant_id', tenantId)
        .eq('id', existing.id)
        .select(
          'id, tenant_id, name, system_prompt, temperature, model_override, max_tokens, prompt_variables, is_active, created_at, updated_at',
        )
        .single();

      if (ue || !updated) {
        throw new BadRequestException(
          `Failed to update prompt config: ${ue?.message ?? 'unknown'}`,
        );
      }
      return this.mapTenantRow(updated);
    }

    const id = randomUUID();
    const { data: inserted, error: ie } = await supabase
      .from('tenant_prompt_configs')
      .insert({
        id,
        tenant_id: tenantId,
        name: name.trim(),
        system_prompt: systemPrompt,
        temperature,
        model_override: body.modelOverride ?? null,
        max_tokens: body.maxTokens ?? null,
        prompt_variables: promptVariables,
        is_active: isActive,
        created_at: now,
        updated_at: now,
      })
      .select(
        'id, tenant_id, name, system_prompt, temperature, model_override, max_tokens, prompt_variables, is_active, created_at, updated_at',
      )
      .single();

    if (ie || !inserted) {
      throw new BadRequestException(`Failed to create prompt config: ${ie?.message ?? 'unknown'}`);
    }

    return this.mapTenantRow(inserted);
  }

  async listAgencyPolicies(
    agencyId: string,
    profileId: string,
  ): Promise<AgencyPolicyDto[]> {
    const ok = await this.auth.hasAgencyAccess(profileId, agencyId);
    if (!ok) {
      throw new NotFoundException('Agency not found');
    }

    const supabase = getSupabaseService();
    const { data, error } = await supabase
      .from('agency_system_policies')
      .select(
        'id, agency_id, name, content, priority, is_default, created_at, updated_at',
      )
      .eq('agency_id', agencyId)
      .order('priority', { ascending: false })
      .order('created_at', { ascending: true });

    if (error) {
      throw new BadRequestException(`Failed to list policies: ${error.message}`);
    }

    return (data ?? []).map(row => this.mapPolicyRow(row as Record<string, unknown>));
  }

  async upsertAgencyPolicy(
    profileId: string,
    body: {
      agencyId: string;
      name: string;
      content: string;
      priority?: number;
      isDefault?: boolean;
      /** When set, updates this row in place (including renames). Otherwise upserts by `(agencyId, name)`. */
      policyId?: string | null;
    },
  ): Promise<AgencyPolicyDto> {
    const { agencyId, name, content } = body;
    const can = await this.auth.isAgencyAdmin(profileId, agencyId);
    if (!can) {
      throw new ForbiddenException('Insufficient permissions to manage agency policies');
    }

    const supabase = getSupabaseService();
    const now = new Date().toISOString();
    const priority = body.priority ?? 0;
    const isDefault = body.isDefault ?? false;
    const policyId = body.policyId?.trim();

    if (policyId) {
      const { data: byId, error: fe } = await supabase
        .from('agency_system_policies')
        .select('id')
        .eq('id', policyId)
        .eq('agency_id', agencyId)
        .maybeSingle();

      if (fe) {
        throw new BadRequestException(`Failed to resolve policy: ${fe.message}`);
      }
      if (!byId?.id) {
        throw new NotFoundException('Policy not found');
      }

      const { data: updatedById, error: ue } = await supabase
        .from('agency_system_policies')
        .update({
          name: name.trim(),
          content,
          priority,
          is_default: isDefault,
          updated_at: now,
        })
        .eq('id', policyId)
        .eq('agency_id', agencyId)
        .select('id, agency_id, name, content, priority, is_default, created_at, updated_at')
        .single();

      if (ue || !updatedById) {
        throw new BadRequestException(`Failed to update policy: ${ue?.message ?? 'unknown'}`);
      }
      return this.mapPolicyRow(updatedById);
    }

    const { data: existing } = await supabase
      .from('agency_system_policies')
      .select('id')
      .eq('agency_id', agencyId)
      .eq('name', name.trim())
      .maybeSingle();

    if (existing?.id) {
      const { data: updated, error: ue } = await supabase
        .from('agency_system_policies')
        .update({
          content,
          priority,
          is_default: isDefault,
          updated_at: now,
        })
        .eq('id', existing.id)
        .select(
          'id, agency_id, name, content, priority, is_default, created_at, updated_at',
        )
        .single();

      if (ue || !updated) {
        throw new BadRequestException(`Failed to update policy: ${ue?.message ?? 'unknown'}`);
      }
      return this.mapPolicyRow(updated);
    }

    const id = randomUUID();
    const { data: inserted, error: ie } = await supabase
      .from('agency_system_policies')
      .insert({
        id,
        agency_id: agencyId,
        name: name.trim(),
        content,
        priority,
        is_default: isDefault,
        created_at: now,
        updated_at: now,
      })
      .select(
        'id, agency_id, name, content, priority, is_default, created_at, updated_at',
      )
      .single();

    if (ie || !inserted) {
      throw new BadRequestException(`Failed to create policy: ${ie?.message ?? 'unknown'}`);
    }

    return this.mapPolicyRow(inserted);
  }

  async deleteAgencyPolicy(
    profileId: string,
    agencyId: string,
    policyId: string,
  ): Promise<void> {
    const can = await this.auth.isAgencyAdmin(profileId, agencyId);
    if (!can) {
      throw new ForbiddenException('Insufficient permissions to manage agency policies');
    }

    const supabase = getSupabaseService();
    const { data: row, error: fe } = await supabase
      .from('agency_system_policies')
      .select('id')
      .eq('id', policyId)
      .eq('agency_id', agencyId)
      .maybeSingle();

    if (fe) {
      throw new BadRequestException(`Failed to resolve policy: ${fe.message}`);
    }
    if (!row?.id) {
      throw new NotFoundException('Policy not found');
    }

    const { error: de } = await supabase.from('agency_system_policies').delete().eq('id', policyId);

    if (de) {
      throw new BadRequestException(`Failed to delete policy: ${de.message}`);
    }
  }

  private mapTenantRow(row: Record<string, unknown>): TenantPromptDto {
    return {
      id: row['id'] as string,
      tenantId: row['tenant_id'] as string,
      name: row['name'] as string,
      systemPrompt: row['system_prompt'] as string,
      temperature: row['temperature'] as number,
      modelOverride: (row['model_override'] as string | null) ?? null,
      maxTokens: (row['max_tokens'] as number | null) ?? null,
      promptVariables: (row['prompt_variables'] as Record<string, unknown>) ?? {},
      isActive: row['is_active'] as boolean,
      createdAt: row['created_at'] as string,
      updatedAt: row['updated_at'] as string,
    };
  }

  private mapPolicyRow(row: Record<string, unknown>): AgencyPolicyDto {
    return {
      id: row['id'] as string,
      agencyId: row['agency_id'] as string,
      name: row['name'] as string,
      content: row['content'] as string,
      priority: row['priority'] as number,
      isDefault: row['is_default'] as boolean,
      createdAt: row['created_at'] as string,
      updatedAt: row['updated_at'] as string,
    };
  }
}
