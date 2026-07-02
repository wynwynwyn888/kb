// Bot / assistant profiles per workspace — Supabase

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { getSupabaseService } from '../../lib/supabase';
import { AuthService } from '../auth/auth.service';
import {
  type BotProfilePromptFields,
  KNOWLEDGE_ACCESS_ALL_VAULTS,
  KNOWLEDGE_ACCESS_SELECTED_VAULTS,
  KNOWLEDGE_SCOPE_ALL_WORKSPACE,
  KNOWLEDGE_SCOPE_SELECTED_COLLECTIONS,
  buildBookingNluProfileAppendix,
  buildBookingReplyPersonaPrompt,
  buildKnowledgeAccessSummaryLine,
  buildOrchestrationTenantPromptFromProfile,
  buildThreeSectionPromptBlob,
  parsePromptSections,
} from '../../lib/tenant-bot-profile-prompt';

/** Result of resolving KB document scope for the active assistant profile (live orchestration). */
export type KbDocumentAllowlistForActiveProfileResult =
  | {
      kind: 'all';
      kbVaultAccessMode: 'all_vaults';
      /** No active profile row — tenant-wide READY KB (legacy). */
      noActiveProfile: boolean;
      selectedVaultCount: 0;
      /** Not computed for full-tenant retrieval */
      allowedDocumentCount: null;
    }
  | {
      kind: 'none';
      kbVaultAccessMode: 'selected_vaults';
      reason: 'profileKnowledgeVaultsEmpty' | 'selectedVaultsNoDocuments';
      selectedVaultCount: number;
      allowedDocumentCount: 0;
    }
  | {
      kind: 'allowlist';
      kbVaultAccessMode: 'selected_vaults';
      documentIds: string[];
      selectedVaultCount: number;
      allowedDocumentCount: number;
    };

export interface TenantBotProfileDto {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  persona: string;
  conversationGoals: string;
  businessNotes: string;
  toneRules: string;
  bookingBehaviorNotes: string;
  escalationBehaviorNotes: string;
  knowledgeScopeNotes: string;
  knowledgeScopeMode: string;
  criticalFacts: string;
  /** all_vaults | selected_vaults */
  knowledgeAccessMode: string;
  selectedVaultIds: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  /** From linked `tenant_prompt_configs` */
  temperature: number;
  modelOverride: string | null;
  maxTokens: number | null;
  promptConfigId: string | null;
}

type ProfileRow = Record<string, unknown>;
type PromptRow = Record<string, unknown>;

@Injectable()
export class BotProfilesService {
  constructor(private readonly auth: AuthService) {}

  private async canAccessTenant(profileId: string, tenantId: string): Promise<boolean> {
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
      .select('id')
      .eq('profile_id', profileId)
      .eq('agency_id', tenant.agency_id as string)
      .maybeSingle();
    return !!au;
  }

  private async canManage(profileId: string, tenantId: string): Promise<boolean> {
    if (await this.auth.isTenantAdmin(profileId, tenantId)) return true;
    const supabase = getSupabaseService();
    const { data: tenant } = await supabase
      .from('tenants')
      .select('agency_id')
      .eq('id', tenantId)
      .maybeSingle();
    if (!tenant) return false;
    return this.auth.isAgencyAdmin(profileId, tenant.agency_id as string);
  }

  private mapProfile(
    row: ProfileRow,
    prompt: PromptRow | null,
    selectedVaultIds: string[],
  ): TenantBotProfileDto {
    const t = (prompt?.['temperature'] as number | undefined) ?? 0.7;
    const maxT = (prompt?.['max_tokens'] as number | null | undefined) ?? null;
    const accessRaw = String(row['knowledge_access_mode'] ?? '').trim();
    const knowledgeAccessMode =
      accessRaw === KNOWLEDGE_ACCESS_SELECTED_VAULTS ? KNOWLEDGE_ACCESS_SELECTED_VAULTS : KNOWLEDGE_ACCESS_ALL_VAULTS;
    return {
      id: row['id'] as string,
      tenantId: row['tenant_id'] as string,
      name: row['name'] as string,
      description: (row['description'] as string) ?? '',
      persona: (row['persona'] as string) ?? '',
      conversationGoals: (row['conversation_goals'] as string) ?? '',
      businessNotes: (row['business_notes'] as string) ?? '',
      toneRules: (row['tone_rules'] as string) ?? '',
      bookingBehaviorNotes: (row['booking_behavior_notes'] as string) ?? '',
      escalationBehaviorNotes: (row['escalation_behavior_notes'] as string) ?? '',
      knowledgeScopeNotes: (row['knowledge_scope_notes'] as string) ?? '',
      criticalFacts: (row['critical_facts'] as string) ?? '',
      knowledgeScopeMode:
        String(row['knowledge_scope_mode'] ?? '').trim() || KNOWLEDGE_SCOPE_ALL_WORKSPACE,
      knowledgeAccessMode,
      selectedVaultIds,
      isActive: Boolean(row['is_active']),
      createdAt: row['created_at'] as string,
      updatedAt: row['updated_at'] as string,
      temperature: t,
      modelOverride: (prompt?.['model_override'] as string | null) ?? null,
      maxTokens: maxT,
      promptConfigId: prompt ? (prompt['id'] as string) : null,
    };
  }

  private async loadVaultSelectionsForProfiles(
    tenantId: string,
    profileIds: string[],
  ): Promise<Map<string, string[]>> {
    const m = new Map<string, string[]>();
    if (!profileIds.length) return m;
    const supabase = getSupabaseService();
    const { data, error } = await supabase
      .from('tenant_bot_profile_knowledge_vaults')
      .select('profile_id, vault_id')
      .in('profile_id', profileIds);
    if (error) {
      throw new BadRequestException(`Failed to load profile vault links: ${error.message}`);
    }
    for (const r of data ?? []) {
      const pid = r['profile_id'] as string;
      const vid = r['vault_id'] as string;
      const cur = m.get(pid) ?? [];
      cur.push(vid);
      m.set(pid, cur);
    }
    return m;
  }

  private async computeKnowledgeAccessSummaryLine(tenantId: string, row: ProfileRow): Promise<string> {
    const access =
      String(row['knowledge_access_mode'] ?? '').trim() === KNOWLEDGE_ACCESS_SELECTED_VAULTS
        ? KNOWLEDGE_ACCESS_SELECTED_VAULTS
        : KNOWLEDGE_ACCESS_ALL_VAULTS;
    if (access !== KNOWLEDGE_ACCESS_SELECTED_VAULTS) {
      return buildKnowledgeAccessSummaryLine(KNOWLEDGE_ACCESS_ALL_VAULTS, []);
    }
    const supabase = getSupabaseService();
    const pid = row['id'] as string;
    const { data: links } = await supabase
      .from('tenant_bot_profile_knowledge_vaults')
      .select('vault_id')
      .eq('profile_id', pid);
    const vids = (links ?? []).map(l => l['vault_id'] as string).filter(Boolean);
    if (vids.length === 0) {
      return buildKnowledgeAccessSummaryLine(KNOWLEDGE_ACCESS_SELECTED_VAULTS, []);
    }
    const { data: vaults } = await supabase
      .from('knowledge_vaults')
      .select('id, name')
      .in('id', vids)
      .eq('tenant_id', tenantId);
    const names = (vaults ?? []).map(v => String(v['name'] ?? '')).filter(Boolean);
    return buildKnowledgeAccessSummaryLine(KNOWLEDGE_ACCESS_SELECTED_VAULTS, names);
  }

  private async buildPromptFieldsFromProfileRow(tenantId: string, row: ProfileRow): Promise<BotProfilePromptFields> {
    const summary = await this.computeKnowledgeAccessSummaryLine(tenantId, row);
    return {
      name: String(row['name'] ?? ''),
      description: String(row['description'] ?? ''),
      persona: String(row['persona'] ?? ''),
      conversationGoals: String(row['conversation_goals'] ?? ''),
      businessNotes: String(row['business_notes'] ?? ''),
      toneRules: String(row['tone_rules'] ?? ''),
      bookingBehaviorNotes: String(row['booking_behavior_notes'] ?? ''),
      escalationBehaviorNotes: String(row['escalation_behavior_notes'] ?? ''),
      knowledgeScopeNotes: String(row['knowledge_scope_notes'] ?? ''),
      criticalFacts: String(row['critical_facts'] ?? ''),
      knowledgeAccessSummary: summary,
    };
  }

  private async loadPromptsByProfileId(
    tenantId: string,
  ): Promise<Map<string, PromptRow>> {
    const supabase = getSupabaseService();
    const { data, error } = await supabase
      .from('tenant_prompt_configs')
      .select('id, tenant_id, bot_profile_id, temperature, model_override, max_tokens')
      .eq('tenant_id', tenantId);
    if (error) {
      throw new BadRequestException(`Failed to load prompt configs: ${error.message}`);
    }
    const m = new Map<string, PromptRow>();
    for (const r of data ?? []) {
      const bid = r['bot_profile_id'] as string | null;
      if (bid) m.set(bid, r as PromptRow);
    }
    return m;
  }

  /**
   * When no bot profiles exist but legacy prompt configs do, create profiles and links.
   */
  async ensureMigratedForTenant(tenantId: string): Promise<void> {
    const supabase = getSupabaseService();
    const { count, error: cErr } = await supabase
      .from('tenant_bot_profiles')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId);
    if (cErr) {
      throw new BadRequestException(`Failed to count profiles: ${cErr.message}`);
    }
    if ((count ?? 0) > 0) return;

    const { data: configs, error: pErr } = await supabase
      .from('tenant_prompt_configs')
      .select(
        'id, tenant_id, name, system_prompt, temperature, model_override, max_tokens, prompt_variables, is_active, created_at, updated_at',
      )
      .eq('tenant_id', tenantId)
      .order('updated_at', { ascending: false });

    if (pErr) {
      throw new BadRequestException(`Failed to load prompt configs: ${pErr.message}`);
    }

    const list = configs ?? [];
    if (list.length === 0) {
      await this.insertDefaultProfileAndPrompt(tenantId);
      return;
    }

    const now = new Date().toISOString();
    const cfgIdToProfileId = new Map<string, string>();
    const usedProfileNames = new Set<string>();
    const takeUniqueProfileName = (raw: string): string => {
      const base = (raw || 'default').trim() || 'default';
      let candidate = base;
      let i = 1;
      while (usedProfileNames.has(candidate)) {
        candidate = `${base} (${i})`;
        i += 1;
      }
      usedProfileNames.add(candidate);
      return candidate;
    };

    for (const cfg of list) {
      const sid = cfg['system_prompt'] as string;
      const parsed = parsePromptSections(sid ?? '');
      const pid = randomUUID();
      const name = takeUniqueProfileName(String(cfg['name'] ?? 'default'));

      const { error: insE } = await supabase.from('tenant_bot_profiles').insert({
        id: pid,
        tenant_id: tenantId,
        name,
        description: '',
        persona: parsed.persona,
        conversation_goals: parsed.goals,
        business_notes: parsed.additional,
        tone_rules: '',
        booking_behavior_notes: '',
        escalation_behavior_notes: '',
        knowledge_scope_notes: '',
        knowledge_scope_mode: KNOWLEDGE_SCOPE_ALL_WORKSPACE,
        knowledge_access_mode: KNOWLEDGE_ACCESS_ALL_VAULTS,
        is_active: false,
        created_at: now,
        updated_at: now,
      });
      if (insE) {
        throw new BadRequestException(`Failed to migrate profile: ${insE.message}`);
      }

      const { error: upE } = await supabase
        .from('tenant_prompt_configs')
        .update({
          bot_profile_id: pid,
          system_prompt: buildThreeSectionPromptBlob(parsed.persona, parsed.goals, parsed.additional),
          updated_at: now,
        })
        .eq('id', cfg['id'] as string);
      if (upE) {
        throw new BadRequestException(`Failed to link prompt config: ${upE.message}`);
      }

      cfgIdToProfileId.set(cfg['id'] as string, pid);
    }

    const activeCfgs = list
      .filter(c => Boolean(c['is_active']))
      .sort((a, b) => String(b['updated_at'] ?? '').localeCompare(String(a['updated_at'] ?? '')));
    const winnerCfgId = activeCfgs[0]?.['id'] as string | undefined;
    const winnerProfileId = winnerCfgId ? cfgIdToProfileId.get(winnerCfgId) : undefined;

    if (winnerProfileId) {
      await this.setActiveProfileInternal(tenantId, winnerProfileId);
    } else {
      const firstPid = cfgIdToProfileId.get(list[0]!['id'] as string);
      if (firstPid) await this.setActiveProfileInternal(tenantId, firstPid);
    }
  }

  private async insertDefaultProfileAndPrompt(tenantId: string): Promise<void> {
    const supabase = getSupabaseService();
    const now = new Date().toISOString();
    const pid = randomUUID();
    const cid = randomUUID();
    const blob = buildThreeSectionPromptBlob('', '', '');

    const { error: pe } = await supabase.from('tenant_bot_profiles').insert({
      id: pid,
      tenant_id: tenantId,
      name: 'Default',
      description: '',
      persona: '',
      conversation_goals: '',
      business_notes: '',
      tone_rules: '',
      booking_behavior_notes: '',
      escalation_behavior_notes: '',
      knowledge_scope_notes: '',
      knowledge_scope_mode: KNOWLEDGE_SCOPE_ALL_WORKSPACE,
      knowledge_access_mode: KNOWLEDGE_ACCESS_ALL_VAULTS,
      is_active: true,
      created_at: now,
      updated_at: now,
    });
    if (pe) throw new BadRequestException(`Failed to create default profile: ${pe.message}`);

    const { error: ce } = await supabase.from('tenant_prompt_configs').insert({
      id: cid,
      tenant_id: tenantId,
      name: 'Default',
      system_prompt: blob,
      temperature: 0.7,
      model_override: null,
      max_tokens: 800,
      prompt_variables: {},
      is_active: true,
      bot_profile_id: pid,
      created_at: now,
      updated_at: now,
    });
    if (ce) throw new BadRequestException(`Failed to create default prompt config: ${ce.message}`);
  }

  private async replaceProfileVaultLinks(profileId: string, vaultIds: string[]): Promise<void> {
    const supabase = getSupabaseService();
    await supabase.from('tenant_bot_profile_knowledge_vaults').delete().eq('profile_id', profileId);
    if (!vaultIds.length) return;
    const rows = vaultIds.map(vid => ({ profile_id: profileId, vault_id: vid }));
    const { error } = await supabase.from('tenant_bot_profile_knowledge_vaults').insert(rows);
    if (error) throw new BadRequestException(`Failed to save vault selection: ${error.message}`);
  }

  private async setActiveProfileInternal(tenantId: string, profileId: string): Promise<void> {
    const supabase = getSupabaseService();
    const now = new Date().toISOString();
    await supabase
      .from('tenant_bot_profiles')
      .update({ is_active: false, updated_at: now })
      .eq('tenant_id', tenantId);
    const { data: ok, error } = await supabase
      .from('tenant_bot_profiles')
      .update({ is_active: true, updated_at: now })
      .eq('tenant_id', tenantId)
      .eq('id', profileId)
      .select('id')
      .maybeSingle();
    if (error || !ok) {
      throw new BadRequestException('Failed to set active profile');
    }
    await supabase
      .from('tenant_prompt_configs')
      .update({ is_active: false, updated_at: now })
      .eq('tenant_id', tenantId);
    await supabase
      .from('tenant_prompt_configs')
      .update({ is_active: true, updated_at: now })
      .eq('bot_profile_id', profileId);
  }

  async listBotProfiles(profileId: string, tenantId: string): Promise<TenantBotProfileDto[]> {
    if (!(await this.canAccessTenant(profileId, tenantId))) {
      throw new NotFoundException('Tenant not found');
    }
    await this.ensureMigratedForTenant(tenantId);

    const supabase = getSupabaseService();
    const { data: rows, error } = await supabase
      .from('tenant_bot_profiles')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: true });
    if (error) {
      throw new BadRequestException(`Failed to list profiles: ${error.message}`);
    }
    const prompts = await this.loadPromptsByProfileId(tenantId);
    const profileIds = (rows ?? []).map(r => r['id'] as string);
    const vaultMap = await this.loadVaultSelectionsForProfiles(tenantId, profileIds);
    return (rows ?? []).map(r =>
      this.mapProfile(r as ProfileRow, prompts.get(r['id'] as string) ?? null, vaultMap.get(r['id'] as string) ?? []),
    );
  }

  async createBotProfile(
    profileId: string,
    tenantId: string,
    body: {
      name: string;
      description?: string;
      persona?: string;
      conversationGoals?: string;
      businessNotes?: string;
      toneRules?: string;
      bookingBehaviorNotes?: string;
      escalationBehaviorNotes?: string;
      knowledgeScopeNotes?: string;
      knowledgeScopeMode?: string;
      knowledgeAccessMode?: string;
      selectedVaultIds?: string[];
      temperature?: number;
      modelOverride?: string | null;
      maxTokens?: number | null;
      setActive?: boolean;
    },
  ): Promise<TenantBotProfileDto> {
    if (!(await this.canManage(profileId, tenantId))) {
      throw new ForbiddenException('Insufficient permissions');
    }
    await this.ensureMigratedForTenant(tenantId);

    const name = body.name?.trim();
    if (!name) throw new BadRequestException('name is required');

    const supabase = getSupabaseService();
    const now = new Date().toISOString();
    const pid = randomUUID();
    const cid = randomUUID();
    const persona = body.persona ?? '';
    const goals = body.conversationGoals ?? '';
    const notes = body.businessNotes ?? '';
    const blob = buildThreeSectionPromptBlob(persona, goals, notes);

    const accessMode =
      body.knowledgeAccessMode?.trim() === KNOWLEDGE_ACCESS_SELECTED_VAULTS
        ? KNOWLEDGE_ACCESS_SELECTED_VAULTS
        : KNOWLEDGE_ACCESS_ALL_VAULTS;
    const scopeMode =
      body.knowledgeScopeMode?.trim() === KNOWLEDGE_SCOPE_SELECTED_COLLECTIONS
        ? KNOWLEDGE_SCOPE_SELECTED_COLLECTIONS
        : KNOWLEDGE_SCOPE_ALL_WORKSPACE;
    const effectiveScope =
      body.knowledgeScopeMode !== undefined
        ? scopeMode
        : accessMode === KNOWLEDGE_ACCESS_SELECTED_VAULTS
          ? KNOWLEDGE_SCOPE_SELECTED_COLLECTIONS
          : KNOWLEDGE_SCOPE_ALL_WORKSPACE;

    const insertProf = {
      id: pid,
      tenant_id: tenantId,
      name,
      description: body.description ?? '',
      persona,
      conversation_goals: goals,
      business_notes: notes,
      tone_rules: body.toneRules ?? '',
      booking_behavior_notes: body.bookingBehaviorNotes ?? '',
      escalation_behavior_notes: body.escalationBehaviorNotes ?? '',
      knowledge_scope_notes: body.knowledgeScopeNotes ?? '',
      knowledge_scope_mode: effectiveScope,
      knowledge_access_mode: accessMode,
      is_active: false,
      created_at: now,
      updated_at: now,
    };

    const { error: ie } = await supabase.from('tenant_bot_profiles').insert(insertProf);
    if (ie) {
      if (String(ie.message).includes('unique') || String(ie.code) === '23505') {
        throw new BadRequestException('A profile with this name already exists');
      }
      throw new BadRequestException(`Failed to create profile: ${ie.message}`);
    }

    const { error: pcErr } = await supabase.from('tenant_prompt_configs').insert({
      id: cid,
      tenant_id: tenantId,
      name,
      system_prompt: blob,
      temperature: body.temperature ?? 0.7,
      model_override: body.modelOverride ?? null,
      max_tokens: body.maxTokens ?? 800,
      prompt_variables: {},
      is_active: Boolean(body.setActive),
      bot_profile_id: pid,
      created_at: now,
      updated_at: now,
    });
    if (pcErr) {
      await supabase.from('tenant_bot_profiles').delete().eq('id', pid);
      throw new BadRequestException(`Failed to create prompt config: ${pcErr.message}`);
    }

    if (body.setActive) {
      await this.setActiveProfileInternal(tenantId, pid);
    }

    const selectedVaults = Array.isArray(body.selectedVaultIds) ? body.selectedVaultIds.filter(Boolean) : [];
    if (accessMode === KNOWLEDGE_ACCESS_SELECTED_VAULTS && selectedVaults.length > 0) {
      await this.replaceProfileVaultLinks(pid, selectedVaults);
    }

    const { data: row, error: re } = await supabase
      .from('tenant_bot_profiles')
      .select('*')
      .eq('id', pid)
      .single();
    if (re || !row) {
      throw new BadRequestException(`Failed to load created profile: ${re?.message ?? 'unknown'}`);
    }
    const { data: pr } = await supabase
      .from('tenant_prompt_configs')
      .select('id, tenant_id, bot_profile_id, temperature, model_override, max_tokens')
      .eq('bot_profile_id', pid)
      .maybeSingle();
    const vm = await this.loadVaultSelectionsForProfiles(tenantId, [row['id'] as string]);
    return this.mapProfile(row as ProfileRow, pr as PromptRow | null, vm.get(row['id'] as string) ?? []);
  }

  async updateBotProfile(
    profileId: string,
    tenantId: string,
    botProfileId: string,
    body: Partial<{
      name: string;
      description: string;
      persona: string;
      conversationGoals: string;
      businessNotes: string;
      toneRules: string;
      bookingBehaviorNotes: string;
      escalationBehaviorNotes: string;
      knowledgeScopeNotes: string;
      knowledgeScopeMode: string;
      knowledgeAccessMode: string;
      selectedVaultIds: string[];
      temperature: number;
      modelOverride: string | null;
      maxTokens: number | null;
    }>,
  ): Promise<TenantBotProfileDto> {
    if (!(await this.canManage(profileId, tenantId))) {
      throw new ForbiddenException('Insufficient permissions');
    }

    const supabase = getSupabaseService();
    const { data: existing, error: fe } = await supabase
      .from('tenant_bot_profiles')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('id', botProfileId)
      .maybeSingle();
    if (fe || !existing) throw new NotFoundException('Profile not found');

    const now = new Date().toISOString();
    const nextName =
      body.name !== undefined ? body.name.trim() : String(existing['name'] ?? '');
    const nextDesc = body.description !== undefined ? body.description : String(existing['description'] ?? '');
    const nextPersona = body.persona !== undefined ? body.persona : String(existing['persona'] ?? '');
    const nextGoals =
      body.conversationGoals !== undefined
        ? body.conversationGoals
        : String(existing['conversation_goals'] ?? '');
    const nextBiz =
      body.businessNotes !== undefined ? body.businessNotes : String(existing['business_notes'] ?? '');
    const nextTone = body.toneRules !== undefined ? body.toneRules : String(existing['tone_rules'] ?? '');
    const nextBook =
      body.bookingBehaviorNotes !== undefined
        ? body.bookingBehaviorNotes
        : String(existing['booking_behavior_notes'] ?? '');
    const nextEsc =
      body.escalationBehaviorNotes !== undefined
        ? body.escalationBehaviorNotes
        : String(existing['escalation_behavior_notes'] ?? '');
    const nextKnow =
      body.knowledgeScopeNotes !== undefined
        ? body.knowledgeScopeNotes
        : String(existing['knowledge_scope_notes'] ?? '');
    const nextScopeMode =
      body.knowledgeScopeMode !== undefined
        ? body.knowledgeScopeMode.trim() === KNOWLEDGE_SCOPE_SELECTED_COLLECTIONS
          ? KNOWLEDGE_SCOPE_SELECTED_COLLECTIONS
          : KNOWLEDGE_SCOPE_ALL_WORKSPACE
        : String(existing['knowledge_scope_mode'] ?? '').trim() || KNOWLEDGE_SCOPE_ALL_WORKSPACE;
    const nextAccessMode =
      body.knowledgeAccessMode !== undefined
        ? body.knowledgeAccessMode.trim() === KNOWLEDGE_ACCESS_SELECTED_VAULTS
          ? KNOWLEDGE_ACCESS_SELECTED_VAULTS
          : KNOWLEDGE_ACCESS_ALL_VAULTS
        : String(existing['knowledge_access_mode'] ?? '').trim() || KNOWLEDGE_ACCESS_ALL_VAULTS;
    const effectiveScopeForRow =
      body.knowledgeScopeMode !== undefined
        ? nextScopeMode
        : nextAccessMode === KNOWLEDGE_ACCESS_SELECTED_VAULTS
          ? KNOWLEDGE_SCOPE_SELECTED_COLLECTIONS
          : KNOWLEDGE_SCOPE_ALL_WORKSPACE;

    const { error: ue } = await supabase
      .from('tenant_bot_profiles')
      .update({
        name: nextName,
        description: nextDesc,
        persona: nextPersona,
        conversation_goals: nextGoals,
        business_notes: nextBiz,
        tone_rules: nextTone,
        booking_behavior_notes: nextBook,
        escalation_behavior_notes: nextEsc,
        knowledge_scope_notes: nextKnow,
        knowledge_scope_mode: effectiveScopeForRow,
        knowledge_access_mode: nextAccessMode,
        updated_at: now,
      })
      .eq('id', botProfileId)
      .eq('tenant_id', tenantId);
    if (ue) {
      if (String(ue.message).includes('unique') || String(ue.code) === '23505') {
        throw new BadRequestException('A profile with this name already exists');
      }
      throw new BadRequestException(`Failed to update profile: ${ue.message}`);
    }

    const blob = buildThreeSectionPromptBlob(nextPersona, nextGoals, nextBiz);
    const updPrompt: Record<string, unknown> = {
      system_prompt: blob,
      name: nextName,
      updated_at: now,
    };
    if (body.temperature !== undefined) updPrompt['temperature'] = body.temperature;
    if (body.modelOverride !== undefined) updPrompt['model_override'] = body.modelOverride;
    if (body.maxTokens !== undefined) updPrompt['max_tokens'] = body.maxTokens;

    await supabase.from('tenant_prompt_configs').update(updPrompt).eq('bot_profile_id', botProfileId);

    if (body.knowledgeAccessMode !== undefined && nextAccessMode === KNOWLEDGE_ACCESS_ALL_VAULTS) {
      await this.replaceProfileVaultLinks(botProfileId, []);
    } else if (
      nextAccessMode === KNOWLEDGE_ACCESS_SELECTED_VAULTS &&
      body.selectedVaultIds !== undefined
    ) {
      await this.replaceProfileVaultLinks(botProfileId, body.selectedVaultIds.filter(Boolean));
    }

    const { data: row } = await supabase
      .from('tenant_bot_profiles')
      .select('*')
      .eq('id', botProfileId)
      .single();
    const pr = await supabase
      .from('tenant_prompt_configs')
      .select('id, tenant_id, bot_profile_id, temperature, model_override, max_tokens')
      .eq('bot_profile_id', botProfileId)
      .maybeSingle();
    const vm = await this.loadVaultSelectionsForProfiles(tenantId, [botProfileId]);
    return this.mapProfile(row as ProfileRow, pr.data as PromptRow | null, vm.get(botProfileId) ?? []);
  }

  async setActiveBotProfile(
    profileId: string,
    tenantId: string,
    botProfileId: string,
  ): Promise<TenantBotProfileDto> {
    if (!(await this.canManage(profileId, tenantId))) {
      throw new ForbiddenException('Insufficient permissions');
    }
    const supabase = getSupabaseService();
    const { data: ex } = await supabase
      .from('tenant_bot_profiles')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('id', botProfileId)
      .maybeSingle();
    if (!ex) throw new NotFoundException('Profile not found');

    await this.setActiveProfileInternal(tenantId, botProfileId);

    const { data: row } = await supabase
      .from('tenant_bot_profiles')
      .select('*')
      .eq('id', botProfileId)
      .single();
    const pr = await supabase
      .from('tenant_prompt_configs')
      .select('id, tenant_id, bot_profile_id, temperature, model_override, max_tokens')
      .eq('bot_profile_id', botProfileId)
      .maybeSingle();
    const vm = await this.loadVaultSelectionsForProfiles(tenantId, [botProfileId]);
    return this.mapProfile(row as ProfileRow, pr.data as PromptRow | null, vm.get(botProfileId) ?? []);
  }

  async duplicateBotProfile(
    profileId: string,
    tenantId: string,
    botProfileId: string,
  ): Promise<TenantBotProfileDto> {
    if (!(await this.canManage(profileId, tenantId))) {
      throw new ForbiddenException('Insufficient permissions');
    }
    const list = await this.listBotProfiles(profileId, tenantId);
    const src = list.find(p => p.id === botProfileId);
    if (!src) throw new NotFoundException('Profile not found');

    let base = `Copy of ${src.name}`;
    const names = new Set(list.map(p => p.name));
    let candidate = base;
    let n = 2;
    while (names.has(candidate)) {
      candidate = `${base} (${n})`;
      n += 1;
    }

    return this.createBotProfile(profileId, tenantId, {
      name: candidate,
      description: src.description,
      persona: src.persona,
      conversationGoals: src.conversationGoals,
      businessNotes: src.businessNotes,
      toneRules: src.toneRules,
      bookingBehaviorNotes: src.bookingBehaviorNotes,
      escalationBehaviorNotes: src.escalationBehaviorNotes,
      knowledgeScopeNotes: src.knowledgeScopeNotes,
      knowledgeScopeMode: src.knowledgeScopeMode,
      knowledgeAccessMode: src.knowledgeAccessMode,
      selectedVaultIds: src.selectedVaultIds,
      temperature: src.temperature,
      modelOverride: src.modelOverride,
      maxTokens: src.maxTokens,
      setActive: false,
    });
  }

  async deleteBotProfile(profileId: string, tenantId: string, botProfileId: string): Promise<void> {
    if (!(await this.canManage(profileId, tenantId))) {
      throw new ForbiddenException('Insufficient permissions');
    }
    const supabase = getSupabaseService();
    const { data: prof } = await supabase
      .from('tenant_bot_profiles')
      .select('id, is_active')
      .eq('tenant_id', tenantId)
      .eq('id', botProfileId)
      .maybeSingle();
    if (!prof) throw new NotFoundException('Profile not found');
    if (prof['is_active']) {
      throw new BadRequestException(
        'Cannot delete the active Assistant Profile. Set another profile as active first.',
      );
    }

    const { count } = await supabase
      .from('tenant_bot_profiles')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId);
    if ((count ?? 0) <= 1) {
      throw new BadRequestException('Cannot delete the only Assistant Profile for this workspace.');
    }

    const { error } = await supabase.from('tenant_bot_profiles').delete().eq('id', botProfileId);
    if (error) throw new BadRequestException(`Failed to delete profile: ${error.message}`);
  }

  /**
   * Resolves which knowledge document IDs the active assistant profile may use for KB retrieval.
   */
  async getKbDocumentAllowlistForActiveProfile(tenantId: string): Promise<KbDocumentAllowlistForActiveProfileResult> {
    await this.ensureMigratedForTenant(tenantId);
    const supabase = getSupabaseService();
    const { data: prof } = await supabase
      .from('tenant_bot_profiles')
      .select('id, knowledge_access_mode')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .maybeSingle();
    if (!prof?.id) {
      return {
        kind: 'all',
        kbVaultAccessMode: 'all_vaults',
        noActiveProfile: true,
        selectedVaultCount: 0,
        allowedDocumentCount: null,
      };
    }

    const access = String(prof['knowledge_access_mode'] ?? '').trim();
    if (access !== KNOWLEDGE_ACCESS_SELECTED_VAULTS) {
      return {
        kind: 'all',
        kbVaultAccessMode: 'all_vaults',
        noActiveProfile: false,
        selectedVaultCount: 0,
        allowedDocumentCount: null,
      };
    }

    const { data: links } = await supabase
      .from('tenant_bot_profile_knowledge_vaults')
      .select('vault_id')
      .eq('profile_id', prof['id'] as string);
    const vaultIds = (links ?? []).map(l => l['vault_id'] as string).filter(Boolean);
    if (vaultIds.length === 0) {
      return {
        kind: 'none',
        kbVaultAccessMode: 'selected_vaults',
        reason: 'profileKnowledgeVaultsEmpty',
        selectedVaultCount: 0,
        allowedDocumentCount: 0,
      };
    }

    const { data: docs } = await supabase
      .from('knowledge_documents')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('status', 'READY')
      .in('vault_id', vaultIds);
    const ids = (docs ?? []).map(d => d.id as string).filter(Boolean);
    if (ids.length === 0) {
      return {
        kind: 'none',
        kbVaultAccessMode: 'selected_vaults',
        reason: 'selectedVaultsNoDocuments',
        selectedVaultCount: vaultIds.length,
        allowedDocumentCount: 0,
      };
    }
    return {
      kind: 'allowlist',
      kbVaultAccessMode: 'selected_vaults',
      documentIds: ids,
      selectedVaultCount: vaultIds.length,
      allowedDocumentCount: ids.length,
    };
  }

  /** Orchestration: active profile text + linked reply settings. Falls back to legacy prompt row if needed. */
  async getActivePromptForOrchestration(tenantId: string): Promise<{
    id: string;
    systemPrompt: string;
    businessNotes: string;
    temperature: number;
    modelOverride?: string;
    maxTokens: number | null;
    isActive: boolean;
    updatedAt: string | null;
  } | null> {
    await this.ensureMigratedForTenant(tenantId);
    const supabase = getSupabaseService();

    const { data: prof } = await supabase
      .from('tenant_bot_profiles')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .maybeSingle();

    if (prof?.id) {
      const { data: pr } = await supabase
        .from('tenant_prompt_configs')
        .select('id, temperature, model_override, max_tokens, updated_at')
        .eq('bot_profile_id', prof['id'] as string)
        .maybeSingle();

      const promptFields = await this.buildPromptFieldsFromProfileRow(tenantId, prof as ProfileRow);
      const systemPrompt = buildOrchestrationTenantPromptFromProfile(promptFields);
      return {
        id: (pr?.['id'] as string) ?? (prof['id'] as string),
        systemPrompt,
        businessNotes: promptFields.businessNotes.trim(),
        temperature: (pr?.['temperature'] as number) ?? 0.7,
        modelOverride: (pr?.['model_override'] as string | undefined) || undefined,
        maxTokens: (pr?.['max_tokens'] as number | null) ?? null,
        isActive: true,
        updatedAt: (pr?.['updated_at'] as string) ?? (prof['updated_at'] as string) ?? null,
      };
    }

    const { data: legacy } = await supabase
      .from('tenant_prompt_configs')
      .select('id, system_prompt, temperature, model_override, max_tokens, is_active, updated_at')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!legacy) return null;
    const legacyPrompt = legacy['system_prompt'] as string;
    const parsedLegacy = parsePromptSections(legacyPrompt);
    return {
      id: legacy['id'] as string,
      systemPrompt: legacyPrompt,
      businessNotes: parsedLegacy.additional.trim(),
      temperature: legacy['temperature'] as number,
      modelOverride: (legacy['model_override'] as string | undefined) || undefined,
      maxTokens: (legacy['max_tokens'] as number | null) ?? null,
      isActive: Boolean(legacy['is_active']),
      updatedAt: (legacy['updated_at'] as string) ?? null,
    };
  }

  async getBookingNluProfileAppendix(tenantId: string): Promise<string> {
    await this.ensureMigratedForTenant(tenantId);
    const supabase = getSupabaseService();
    const { data: prof } = await supabase
      .from('tenant_bot_profiles')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .maybeSingle();
    if (!prof?.id) return '';
    const fields = await this.buildPromptFieldsFromProfileRow(tenantId, prof as ProfileRow);
    return buildBookingNluProfileAppendix(fields);
  }

  async getBookingReplyPersonaPrompt(tenantId: string): Promise<string | undefined> {
    await this.ensureMigratedForTenant(tenantId);
    const supabase = getSupabaseService();
    const { data: prof } = await supabase
      .from('tenant_bot_profiles')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .maybeSingle();
    if (!prof?.id) return undefined;
    const fields = await this.buildPromptFieldsFromProfileRow(tenantId, prof as ProfileRow);
    const s = buildBookingReplyPersonaPrompt(fields).trim();
    return s || undefined;
  }

  /** Settings UI / tenant detail — active assistant profile + reply settings. */
  async getActiveProfileSnapshotForSettings(tenantId: string): Promise<{
    id: string;
    name: string;
    temperature: number;
    modelOverride?: string;
    isActive: boolean;
  } | null> {
    await this.ensureMigratedForTenant(tenantId);
    const supabase = getSupabaseService();
    const { data: prof } = await supabase
      .from('tenant_bot_profiles')
      .select('id, name, is_active')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .maybeSingle();
    if (!prof?.id) return null;
    const { data: pr } = await supabase
      .from('tenant_prompt_configs')
      .select('id, temperature, model_override, is_active')
      .eq('bot_profile_id', prof['id'] as string)
      .maybeSingle();
    return {
      id: (pr?.['id'] as string) ?? (prof['id'] as string),
      name: prof['name'] as string,
      temperature: (pr?.['temperature'] as number) ?? 0.7,
      modelOverride: (pr?.['model_override'] as string | undefined) || undefined,
      isActive: true,
    };
  }
}
