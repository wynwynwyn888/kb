import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { OpenAiProviderAdapter } from '@aisbp/ai-provider-openai';
import { normalizeModelForLiveProvider } from '@aisbp/types';
import { getSupabaseService } from '../../lib/supabase';
import { isUsableOpenAiFallbackKey } from '../../lib/ai-live-model-resolve';
import type { ConfidenceThreshold, TagMatchMode } from '../../lib/tenant-automation-constants';
import type { TagRuleDto } from './tag-rules.service';

export interface TagRuleMatchHit {
  ruleId: string;
  ruleName: string;
  crmTagName: string;
  matchMode: TagMatchMode;
  confidence: number;
  confidenceLabel: ConfidenceThreshold;
  passesThreshold: boolean;
  source: 'keyword' | 'ai';
}

export interface TagRuleMatchResult {
  hits: TagRuleMatchHit[];
  /** CRM tag names that would be applied (enabled rules with autoApply and passing threshold). */
  tagsToApply: string[];
}

function minScoreForThreshold(t: ConfidenceThreshold): number {
  if (t === 'LOW') return 0.35;
  if (t === 'HIGH') return 0.72;
  return 0.52;
}

function labelFromScore(score: number): ConfidenceThreshold {
  if (score >= 0.72) return 'HIGH';
  if (score >= 0.52) return 'NORMAL';
  return 'LOW';
}

function keywordScore(message: string, description: string): number {
  const msg = message.toLowerCase();
  const words = description
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((w) => w.length >= 4);
  if (words.length === 0) return 0;
  const uniq = [...new Set(words)].slice(0, 24);
  let hits = 0;
  for (const w of uniq) {
    if (msg.includes(w)) hits++;
  }
  return hits / uniq.length;
}

type ProviderRow = {
  api_key: string | null;
  endpoint: string | null;
  settings: Record<string, unknown>;
};

@Injectable()
export class TagRuleMatchService {
  private readonly logger = new Logger(TagRuleMatchService.name);
  private readonly supabase = getSupabaseService();

  async testMatch(
    tenantId: string,
    message: string,
    opts?: { ruleIds?: string[] },
  ): Promise<TagRuleMatchResult> {
    const trimmed = message?.trim();
    if (!trimmed) throw new BadRequestException('message is required');

    const { data: tenant, error: tErr } = await this.supabase.from('tenants').select('id').eq('id', tenantId).maybeSingle();
    if (tErr || !tenant) throw new BadRequestException('Tenant not found');

    const { data: rows, error } = await this.supabase
      .from('tenant_tag_rules')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('enabled', true);

    if (error) {
      this.logger.warn(`testMatch: ${error.message}`);
      throw new BadRequestException('Could not load tag rules');
    }

    let rules = (rows ?? []).map((r) => this.rowToDto(r as Record<string, unknown>));
    if (opts?.ruleIds?.length) {
      const allow = new Set(opts.ruleIds);
      rules = rules.filter((x) => allow.has(x.id));
    }

    const keywordHits = new Map<string, { score: number }>();
    const needAiIds = new Set<string>();

    for (const r of rules) {
      const ks = keywordScore(trimmed, r.ruleDescription);
      keywordHits.set(r.id, { score: ks });
      if (r.matchMode === 'AI' || r.matchMode === 'HYBRID') {
        needAiIds.add(r.id);
      }
    }

    const aiSelected = new Set<string>();
    if (needAiIds.size > 0) {
      const aiRules = rules.filter((r) => needAiIds.has(r.id));
      const picked = await this.runAiClassifier(tenantId, trimmed, aiRules);
      for (const id of picked) aiSelected.add(id);
    }

    const hits: TagRuleMatchHit[] = [];

    for (const r of rules) {
      const ks = keywordHits.get(r.id)?.score ?? 0;
      let score = 0;
      let source: 'keyword' | 'ai' = 'keyword';

      if (r.matchMode === 'KEYWORD') {
        score = ks;
      } else if (r.matchMode === 'AI') {
        score = aiSelected.has(r.id) ? 0.88 : 0;
        source = 'ai';
      } else {
        // HYBRID
        const kwOk = ks >= minScoreForThreshold('LOW');
        const aiOk = aiSelected.has(r.id);
        if (aiOk) {
          score = Math.max(ks, 0.88);
          source = 'ai';
        } else if (kwOk) {
          score = ks;
          source = 'keyword';
        } else {
          score = 0;
        }
      }

      const label = labelFromScore(score);
      const passes = score >= minScoreForThreshold(r.confidenceThreshold);

      hits.push({
        ruleId: r.id,
        ruleName: r.ruleName,
        crmTagName: r.crmTagName,
        matchMode: r.matchMode,
        confidence: Math.round(score * 1000) / 1000,
        confidenceLabel: label,
        passesThreshold: passes,
        source,
      });
    }

    hits.sort((a, b) => b.confidence - a.confidence);

    const tagsToApply = hits
      .filter((h) => {
        const rule = rules.find((x) => x.id === h.ruleId);
        return rule && rule.autoApply && h.passesThreshold;
      })
      .map((h) => h.crmTagName.trim())
      .filter(Boolean);

    return { hits, tagsToApply: [...new Set(tagsToApply)] };
  }

  private rowToDto(rec: Record<string, unknown>): TagRuleDto {
    return {
      id: String(rec['id'] ?? ''),
      tenantId: String(rec['tenant_id'] ?? ''),
      enabled: Boolean(rec['enabled']),
      autoApply: Boolean(rec['auto_apply']),
      ruleName: String(rec['rule_name'] ?? ''),
      ruleDescription: String(rec['rule_description'] ?? ''),
      crmTagId: rec['crm_tag_id'] == null ? null : String(rec['crm_tag_id']),
      crmTagName: String(rec['crm_tag_name'] ?? ''),
      matchMode: String(rec['match_mode'] ?? 'AI') as TagRuleDto['matchMode'],
      confidenceThreshold: String(rec['confidence_threshold'] ?? 'NORMAL') as TagRuleDto['confidenceThreshold'],
      priority: Number(rec['priority'] ?? 0),
      createdAt: String(rec['created_at'] ?? ''),
      updatedAt: String(rec['updated_at'] ?? ''),
    };
  }

  private async runAiClassifier(tenantId: string, message: string, rules: TagRuleDto[]): Promise<string[]> {
    if (rules.length === 0) return [];
    const agencyId = await this.getAgencyId(tenantId);
    if (!agencyId) {
      this.logger.debug('No agency for tenant — skipping AI tag match');
      return [];
    }

    const openaiRow = await this.loadProviderRow(agencyId, 'OPENAI');
    if (!openaiRow?.api_key || !isUsableOpenAiFallbackKey(openaiRow.api_key)) {
      this.logger.debug('No OpenAI key for agency — skipping AI tag match');
      return [];
    }

    const model = normalizeModelForLiveProvider(
      'OPENAI',
      (openaiRow.settings['defaultModel'] as string | undefined) ?? undefined,
    );
    const maxTokens = typeof openaiRow.settings['maxTokens'] === 'number' ? (openaiRow.settings['maxTokens'] as number) : 300;
    const temperature = typeof openaiRow.settings['temperature'] === 'number' ? (openaiRow.settings['temperature'] as number) : 0;

    const list = rules.map((r) => `- ${r.id}: ${r.ruleName}\n  When to apply: ${r.ruleDescription}`).join('\n');

    const prompt =
      'You classify customer messages against tagging rules. Return ONLY valid JSON: {"ruleIds":["..."]}.\n' +
      'Include a rule id ONLY if the customer message clearly matches that rule\'s "When to apply" description.\n' +
      'Do not invent rule ids. Use only ids from the list. If none match, return {"ruleIds":[]}.\n\n' +
      `Rules:\n${list}\n\nCustomer message:\n${message}`;

    const adapter = new OpenAiProviderAdapter();
    adapter.initialize({
      apiKey: openaiRow.api_key,
      endpoint: openaiRow.endpoint ?? undefined,
      defaultModel: model,
      maxTokens,
      temperature,
    });

    try {
      const result = await adapter.generate({
        model,
        messages: [
          { role: 'system', content: 'You output compact JSON only. No markdown.' },
          { role: 'user', content: prompt },
        ],
        temperature,
        maxTokens,
      });
      const raw = result.content?.trim() ?? '';
      const parsed = this.parseRuleIdsJson(raw, new Set(rules.map((r) => r.id)));
      return parsed;
    } catch (e) {
      this.logger.warn(`AI tag match failed: ${e instanceof Error ? e.message : e}`);
      return [];
    }
  }

  private parseRuleIdsJson(text: string, allowed: Set<string>): string[] {
    const tryParse = (s: string): unknown => {
      try {
        return JSON.parse(s) as unknown;
      } catch {
        return null;
      }
    };

    let obj = tryParse(text);
    if (!obj && text.includes('{')) {
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start >= 0 && end > start) obj = tryParse(text.slice(start, end + 1));
    }

    if (!obj || typeof obj !== 'object') return [];
    const ids = (obj as Record<string, unknown>)['ruleIds'];
    if (!Array.isArray(ids)) return [];
    const out: string[] = [];
    for (const x of ids) {
      if (typeof x === 'string' && allowed.has(x)) out.push(x);
    }
    return out;
  }

  private async getAgencyId(tenantId: string): Promise<string | null> {
    const { data } = await this.supabase.from('tenants').select('agency_id').eq('id', tenantId).single();
    return data?.agency_id ?? null;
  }

  private async loadProviderRow(agencyId: string, provider: string): Promise<ProviderRow | null> {
    const { data, error } = await this.supabase
      .from('agency_model_providers')
      .select('provider, api_key, endpoint, settings')
      .eq('agency_id', agencyId)
      .eq('provider', provider)
      .maybeSingle();
    if (error || !data) return null;
    return {
      api_key: data.api_key,
      endpoint: data.endpoint,
      settings: (data.settings as Record<string, unknown>) ?? {},
    };
  }
}
