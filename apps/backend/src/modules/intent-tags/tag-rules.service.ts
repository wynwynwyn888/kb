import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { getSupabaseService } from '../../lib/supabase';
import { GhlService } from '../ghl/ghl.service';
import type { GhlTagSummary } from '@aisbp/ghl-client';
import {
  parseConfidenceThreshold,
  parseMatchMode,
  parseTagRulePatch,
} from '../../lib/tenant-automation-validation';
import type { TagMatchMode, ConfidenceThreshold } from '../../lib/tenant-automation-constants';

export interface TagRuleDto {
  id: string;
  tenantId: string;
  enabled: boolean;
  autoApply: boolean;
  ruleName: string;
  ruleDescription: string;
  /** Explicit keyword phrases for KEYWORD/HYBRID when provided. */
  keywords: string[];
  crmTagId: string | null;
  crmTagName: string;
  matchMode: TagMatchMode;
  confidenceThreshold: ConfidenceThreshold;
  priority: number;
  createdAt: string;
  updatedAt: string;
}

export interface TaggingSettingsDto {
  automaticTaggingEnabled: boolean;
}

function parseKeywordsCell(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const x of raw) {
    if (typeof x === 'string' && x.trim()) out.push(x.trim());
  }
  return out;
}

export function mapTagRuleRow(rec: Record<string, unknown>): TagRuleDto {
  return {
    id: String(rec['id'] ?? ''),
    tenantId: String(rec['tenant_id'] ?? ''),
    enabled: Boolean(rec['enabled']),
    autoApply: Boolean(rec['auto_apply']),
    ruleName: String(rec['rule_name'] ?? ''),
    ruleDescription: String(rec['rule_description'] ?? ''),
    keywords: parseKeywordsCell(rec['keywords_json']),
    crmTagId: rec['crm_tag_id'] == null ? null : String(rec['crm_tag_id']),
    crmTagName: String(rec['crm_tag_name'] ?? ''),
    matchMode: String(rec['match_mode'] ?? 'AI') as TagMatchMode,
    confidenceThreshold: String(rec['confidence_threshold'] ?? 'NORMAL') as ConfidenceThreshold,
    priority: Number(rec['priority'] ?? 0),
    createdAt: String(rec['created_at'] ?? ''),
    updatedAt: String(rec['updated_at'] ?? ''),
  };
}

function rowToRule(rec: Record<string, unknown>): TagRuleDto {
  return mapTagRuleRow(rec);
}

/** Rules eligible for automatic CRM tagging (executor must only use these). */
export function enabledAutoTagRulesForExecutor(rules: TagRuleDto[]): TagRuleDto[] {
  return rules.filter((r) => r.enabled && r.autoApply && r.crmTagName.trim().length > 0);
}

@Injectable()
export class TagRulesService {
  private readonly logger = new Logger(TagRulesService.name);
  private readonly supabase = getSupabaseService();

  constructor(private readonly ghlService: GhlService) {}

  async getTaggingSettings(tenantId: string): Promise<TaggingSettingsDto> {
    const { data, error } = await this.supabase
      .from('tenant_tagging_settings')
      .select('automatic_tagging_enabled')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (error) {
      this.logger.warn(`getTaggingSettings: ${error.message}`);
      throw new BadRequestException('Could not load tagging settings');
    }
    if (!data) return { automaticTaggingEnabled: false };
    return { automaticTaggingEnabled: Boolean(data['automatic_tagging_enabled']) };
  }

  async patchTaggingSettings(tenantId: string, patch: { automaticTaggingEnabled?: boolean }): Promise<TaggingSettingsDto> {
    const current = await this.getTaggingSettings(tenantId);
    const automaticTaggingEnabled =
      patch.automaticTaggingEnabled !== undefined ? Boolean(patch.automaticTaggingEnabled) : current.automaticTaggingEnabled;

    const now = new Date().toISOString();
    const { data: existing } = await this.supabase.from('tenant_tagging_settings').select('tenant_id').eq('tenant_id', tenantId).maybeSingle();

    if (existing) {
      const { error } = await this.supabase
        .from('tenant_tagging_settings')
        .update({ automatic_tagging_enabled: automaticTaggingEnabled, updated_at: now })
        .eq('tenant_id', tenantId);
      if (error) throw new BadRequestException(error.message);
    } else {
      const { error } = await this.supabase.from('tenant_tagging_settings').insert({
        tenant_id: tenantId,
        automatic_tagging_enabled: automaticTaggingEnabled,
        created_at: now,
        updated_at: now,
      });
      if (error) throw new BadRequestException(error.message);
    }

    return this.getTaggingSettings(tenantId);
  }

  async listRules(tenantId: string): Promise<{ rules: TagRuleDto[] }> {
    const { data: rows, error } = await this.supabase
      .from('tenant_tag_rules')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('priority', { ascending: false })
      .order('created_at', { ascending: true });

    if (error) {
      this.logger.warn(`listRules: ${error.message}`);
      throw new BadRequestException('Could not load tag rules');
    }

    return { rules: (rows ?? []).map((r) => rowToRule(r as Record<string, unknown>)) };
  }

  async createRule(tenantId: string, raw: unknown): Promise<{ rule: TagRuleDto }> {
    const dto = parseTagRulePatch(raw, { partial: false });
    if (!dto.ruleName?.trim()) throw new BadRequestException('ruleName is required');
    if (!dto.ruleDescription?.trim()) throw new BadRequestException('ruleDescription is required');
    if (!dto.crmTagName?.trim()) throw new BadRequestException('crmTagName is required');
    if (dto.autoApply && !dto.crmTagName.trim()) throw new BadRequestException('crmTagName required when autoApply is on');

    const now = new Date().toISOString();
    const id = randomUUID();
    const row = {
      id,
      tenant_id: tenantId,
      enabled: dto.enabled ?? true,
      auto_apply: dto.autoApply ?? false,
      rule_name: dto.ruleName.trim(),
      rule_description: dto.ruleDescription.trim(),
      keywords_json: dto.keywords ?? [],
      crm_tag_id: dto.crmTagId ?? null,
      crm_tag_name: dto.crmTagName.trim(),
      match_mode: dto.matchMode ?? 'AI',
      confidence_threshold: dto.confidenceThreshold ?? 'NORMAL',
      priority: dto.priority ?? 0,
      created_at: now,
      updated_at: now,
    };

    const { error } = await this.supabase.from('tenant_tag_rules').insert(row);
    if (error) throw new BadRequestException(error.message);

    const { data } = await this.supabase.from('tenant_tag_rules').select('*').eq('id', id).single();
    if (!data) throw new BadRequestException('Rule was not persisted');
    return { rule: rowToRule(data as Record<string, unknown>) };
  }

  async updateRule(tenantId: string, ruleId: string, raw: unknown): Promise<{ rule: TagRuleDto }> {
    const dto = parseTagRulePatch(raw, { partial: true });
    const { data: existing, error: findErr } = await this.supabase
      .from('tenant_tag_rules')
      .select('id')
      .eq('id', ruleId)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (findErr || !existing) throw new NotFoundException('Rule not found');

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (dto.enabled !== undefined) patch['enabled'] = dto.enabled;
    if (dto.autoApply !== undefined) patch['auto_apply'] = dto.autoApply;
    if (dto.ruleName !== undefined) patch['rule_name'] = dto.ruleName.trim();
    if (dto.ruleDescription !== undefined) patch['rule_description'] = dto.ruleDescription.trim();
    if (dto.keywords !== undefined) patch['keywords_json'] = dto.keywords;
    if (dto.crmTagId !== undefined) patch['crm_tag_id'] = dto.crmTagId;
    if (dto.crmTagName !== undefined) patch['crm_tag_name'] = dto.crmTagName.trim();
    if (dto.matchMode !== undefined) patch['match_mode'] = dto.matchMode;
    if (dto.confidenceThreshold !== undefined) patch['confidence_threshold'] = dto.confidenceThreshold;
    if (dto.priority !== undefined) patch['priority'] = dto.priority;

    const { error } = await this.supabase.from('tenant_tag_rules').update(patch).eq('id', ruleId).eq('tenant_id', tenantId);
    if (error) throw new BadRequestException(error.message);

    const { data } = await this.supabase.from('tenant_tag_rules').select('*').eq('id', ruleId).single();
    if (!data) throw new BadRequestException('Rule not found after update');
    return { rule: rowToRule(data as Record<string, unknown>) };
  }

  async deleteRule(tenantId: string, ruleId: string): Promise<{ ok: boolean }> {
    const { data, error } = await this.supabase
      .from('tenant_tag_rules')
      .delete()
      .eq('id', ruleId)
      .eq('tenant_id', tenantId)
      .select('id');
    if (error) throw new BadRequestException(error.message);
    if (!data?.length) throw new NotFoundException('Rule not found');
    return { ok: true };
  }

  async syncTags(tenantId: string, profileId: string): Promise<{
    tags: GhlTagSummary[];
    syncedAt: string;
    error?: string;
  }> {
    const { client } = await this.ghlService.createGhlClientForConnectedTenantOrThrow(tenantId, profileId);
    const r = await client.listTags();
    const syncedAt = new Date().toISOString();
    if (r.error) this.logger.warn(`syncTags CRM: ${r.error}`);
    return { tags: r.tags, syncedAt, error: r.error };
  }

  async testTag(
    tenantId: string,
    profileId: string,
    body: { contactId?: string; tagName?: string },
  ): Promise<{ success: boolean; message?: string; error?: string }> {
    const contactId = body.contactId?.trim();
    const tagName = body.tagName?.trim();
    if (!contactId) throw new BadRequestException('contactId is required');
    if (!tagName) throw new BadRequestException('tagName is required');

    const { client } = await this.ghlService.createGhlClientForConnectedTenantOrThrow(tenantId, profileId);
    const listed = await client.listTags();
    if (listed.error) {
      return { success: false, error: listed.error };
    }
    const approved = listed.tags.some((t) => t.name.trim().toLowerCase() === tagName.toLowerCase());
    if (!approved) {
      return {
        success: false,
        error: 'Tag is not in the CRM tag list. Sync tags and pick an existing tag name.',
      };
    }

    const result = await client.tagContact({ contactId, tags: [tagName] });
    if (!result.success) {
      return { success: false, error: result.error ?? 'Tag failed' };
    }
    return { success: true, message: 'Tag applied to contact.' };
  }

  /** Load rules for matching (enabled rows). */
  async getRulesForMatch(tenantId: string): Promise<TagRuleDto[]> {
    const { rules } = await this.listRules(tenantId);
    return rules.filter((r) => r.enabled);
  }
}
