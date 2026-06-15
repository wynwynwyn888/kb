// Agency AI Config — multi-provider rows + active provider on `agencies`.

import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import {
  AI_LIVE_PROVIDER_REGISTRY,
  MINIMAX_DEFAULT_API_BASE,
  OPENAI_DEFAULT_API_BASE,
  normalizeModelForLiveProvider,
} from '@aisbp/types';
import { getSupabaseService } from '../../lib/supabase';
import {
  assistantReplyPresentForHealthCheck,
  extractAssistantTextFromOpenAiCompatibleBody,
} from '../../lib/openai-compatible-completion-text';
import { minimaxChatCompletion } from '../generation/minimax.generate';
import { assertAgencyLiveAiProvider, assertModelBelongsToProvider } from './agency-ai-config.validation';
import {
  activeAiHealthFromSnapshot,
  agencyAiHealthErrorSummary,
  parseAiModelHealthSnapshot,
  type AiModelHealthSnapshot,
} from './ai-model-health-snapshot';

export interface AgencyProviderFormSnapshot {
  defaultModel: string;
  maxTokens?: number;
  temperature?: number;
  hasKey: boolean;
  minimaxGroupId?: string;
  /** Saved API base URL for this row (never includes secrets). */
  endpoint?: string | null;
}

export interface SubaccountBehaviorPolicy {
  /** Allowed response-style (temperature) range for subaccount prompts. */
  temperatureMin: number;
  temperatureMax: number;
  maxTokensMin: number;
  maxTokensMax: number;
  allowModelOverride: boolean;
  allowResponseStyleOverride: boolean;
  allowMaxTokensOverride: boolean;
}

export type ActiveAiHealthBadge = 'PASS' | 'FAIL' | 'UNKNOWN';

export interface AgencyAiConfig {
  provider: string;
  activeProvider: string;
  /** Model for the currently active provider row (live generation). */
  activeModel: string;
  enabled: boolean;
  defaultModel: string;
  maxTokens?: number;
  temperature?: number;
  hasApiKey: boolean;
  /** Which provider rows have a non-empty API key (for UI). */
  keysPresent: Partial<Record<string, boolean>>;
  /** Saved settings per provider row (for editing before save). */
  providerSnapshots: Partial<Record<string, AgencyProviderFormSnapshot>>;
  /** Agency governance for what subaccounts may configure on their bot (stored in `agencies.settings`). */
  subaccountBehaviorPolicy?: SubaccountBehaviorPolicy;
  /** Last model health check persisted in `agencies.settings.aiModelHealthSnapshot`. */
  aiModelHealthSnapshot?: AiModelHealthSnapshot | null;
  /** Health for the **active** provider + default model (UNKNOWN when never tested for that pair). */
  activeAiHealth: {
    healthBadge: ActiveAiHealthBadge;
    lastHealthCheckedAt: string | null;
    lastHealthLatencyMs: number | null;
    lastHealthErrorSummary: string | null;
  };
  /** Authoritative MiniMax/OpenAI + model list for agency UI (same as @aisbp/types registry). */
  liveAiCatalog: LiveAiCatalogDto;
}

export interface LiveAiCatalogDto {
  providers: Array<{ id: 'OPENAI' | 'MINIMAX'; label: string }>;
  modelsByProvider: Record<
    'OPENAI' | 'MINIMAX',
    Array<{ id: string; label: string; tier?: string }>
  >;
}

export function buildLiveAiCatalog(): LiveAiCatalogDto {
  return {
    providers: [
      { id: 'MINIMAX', label: AI_LIVE_PROVIDER_REGISTRY.MINIMAX.label },
      { id: 'OPENAI', label: AI_LIVE_PROVIDER_REGISTRY.OPENAI.label },
    ],
    modelsByProvider: {
      MINIMAX: [...AI_LIVE_PROVIDER_REGISTRY.MINIMAX.models],
      OPENAI: [...AI_LIVE_PROVIDER_REGISTRY.OPENAI.models],
    },
  };
}

export type SaveableProvider = 'OPENAI' | 'MINIMAX';

export interface SaveAgencyAiConfigDto {
  provider: SaveableProvider;
  /** If omitted or empty, existing key is kept (update settings only). */
  apiKey?: string;
  endpoint?: string;
  defaultModel: string;
  maxTokens?: number;
  temperature?: number;
  /** MiniMax: optional group / org id when the account requires it. */
  minimaxGroupId?: string;
  /** When true, set `agencies.active_ai_provider` to `provider` after save. If omitted, active provider is unchanged. */
  setAsActive?: boolean;
}

export interface TestAgencyAiModelDto {
  provider: SaveableProvider;
  model: string;
  /** Reserved; health checks always use the saved key for the provider row. */
  optionalUseSavedKey?: boolean;
}

export interface AgencyAiModelTestResult {
  status: 'PASS' | 'FAIL';
  provider: string;
  model: string;
  latencyMs: number;
  checkedAt: string;
  errorCode?: string;
  errorSummary?: string;
}

const LIVE_PROVIDERS = new Set(['OPENAI', 'MINIMAX']);
const SETTINGS_HEALTH_KEY = 'aiModelHealthSnapshot';

const DEFAULT_SUBACCOUNT_BEHAVIOR: SubaccountBehaviorPolicy = {
  temperatureMin: 0,
  temperatureMax: 2,
  maxTokensMin: 200,
  maxTokensMax: 4000,
  allowModelOverride: true,
  allowResponseStyleOverride: true,
  allowMaxTokensOverride: true,
};

function parseSubaccountPolicy(raw: unknown): SubaccountBehaviorPolicy {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_SUBACCOUNT_BEHAVIOR };
  }
  const o = raw as Record<string, unknown>;
  return {
    temperatureMin: typeof o['temperatureMin'] === 'number' ? o['temperatureMin']! : DEFAULT_SUBACCOUNT_BEHAVIOR.temperatureMin,
    temperatureMax: typeof o['temperatureMax'] === 'number' ? o['temperatureMax']! : DEFAULT_SUBACCOUNT_BEHAVIOR.temperatureMax,
    maxTokensMin: typeof o['maxTokensMin'] === 'number' ? o['maxTokensMin']! : DEFAULT_SUBACCOUNT_BEHAVIOR.maxTokensMin,
    maxTokensMax: typeof o['maxTokensMax'] === 'number' ? o['maxTokensMax']! : DEFAULT_SUBACCOUNT_BEHAVIOR.maxTokensMax,
    allowModelOverride: typeof o['allowModelOverride'] === 'boolean' ? o['allowModelOverride']! : DEFAULT_SUBACCOUNT_BEHAVIOR.allowModelOverride,
    allowResponseStyleOverride:
      typeof o['allowResponseStyleOverride'] === 'boolean' ? o['allowResponseStyleOverride']! : DEFAULT_SUBACCOUNT_BEHAVIOR.allowResponseStyleOverride,
    allowMaxTokensOverride: typeof o['allowMaxTokensOverride'] === 'boolean' ? o['allowMaxTokensOverride']! : DEFAULT_SUBACCOUNT_BEHAVIOR.allowMaxTokensOverride,
  };
}

function openAiChatCompletionsUrl(endpoint: string | null | undefined): string {
  let b = (endpoint?.trim() || OPENAI_DEFAULT_API_BASE).replace(/\/$/, '');
  if (!/\/v1$/i.test(b)) {
    b = `${b}/v1`;
  }
  return `${b}/chat/completions`;
}

@Injectable()
export class AgencyAiConfigService {
  private readonly logger = new Logger(AgencyAiConfigService.name);
  private readonly supabase = getSupabaseService();

  /**
   * Returns config for the **active** provider, plus `activeProvider` and `keysPresent`.
   */
  async getConfig(agencyId: string): Promise<AgencyAiConfig | null> {
    const { data: agency, error: aErr } = await this.supabase
      .from('agencies')
      .select('active_ai_provider, settings')
      .eq('id', agencyId)
      .single();

    if (aErr) {
      this.logger.error(`Failed to read agency: ${aErr.message}`);
      return null;
    }

    const activeRaw = (agency as { active_ai_provider?: string })?.active_ai_provider ?? 'OPENAI';
    const active = String(activeRaw).toUpperCase();
    const st = (agency as { settings?: Record<string, unknown> } | null)?.settings ?? {};
    const sub = st['subaccountBehaviorPolicy'];
    const subaccountBehaviorPolicy = parseSubaccountPolicy(sub);
    const healthSnap = parseAiModelHealthSnapshot(st[SETTINGS_HEALTH_KEY]);
    const liveAiCatalog = buildLiveAiCatalog();

    const { data: rows } = await this.supabase
      .from('agency_model_providers')
      .select('provider, api_key, settings, endpoint')
      .eq('agency_id', agencyId);

    await this.migrateLegacyMinimaxDefaultModels(agencyId, rows ?? []);

    const keysPresent: Partial<Record<string, boolean>> = {};
    const providerSnapshots: Partial<Record<string, AgencyProviderFormSnapshot>> = {};

    for (const r of rows ?? []) {
      const prov = String(r.provider).toUpperCase();
      if (!LIVE_PROVIDERS.has(prov)) continue;
      keysPresent[prov] = Boolean(r.api_key);
      const s = (r.settings as Record<string, unknown> | null) ?? {};
      const mg = s['minimaxGroupId'] as string | undefined;
      const snapshotDefault =
        (s['defaultModel'] as string) ?? (prov === 'MINIMAX' ? 'MiniMax-M3' : 'gpt-4o-mini');
      providerSnapshots[prov] = {
        defaultModel: normalizeModelForLiveProvider(prov, snapshotDefault),
        maxTokens: s['maxTokens'] as number | undefined,
        temperature: s['temperature'] as number | undefined,
        hasKey: Boolean(r.api_key),
        ...(mg?.trim() ? { minimaxGroupId: mg.trim() } : {}),
        endpoint: ((r as { endpoint?: string | null }).endpoint ?? null) as string | null,
      };
    }

    const row = (rows ?? []).find(r => String(r.provider).toUpperCase() === active);

    if (!row) {
      const fallback = normalizeModelForLiveProvider(active, '');
      const ah = activeAiHealthFromSnapshot(active, fallback, healthSnap);
      return {
        provider: active,
        activeProvider: active,
        activeModel: fallback,
        enabled: true,
        defaultModel: fallback,
        hasApiKey: false,
        keysPresent,
        providerSnapshots,
        subaccountBehaviorPolicy,
        aiModelHealthSnapshot: healthSnap,
        activeAiHealth: {
          healthBadge: ah.healthBadge,
          lastHealthCheckedAt: ah.lastHealthCheckedAt,
          lastHealthLatencyMs: ah.lastHealthLatencyMs,
          lastHealthErrorSummary: ah.lastHealthErrorSummary,
        },
        liveAiCatalog,
      };
    }

    const settings = row.settings as Record<string, unknown> ?? {};
    const rawModel = (settings['defaultModel'] as string) ?? '';
    const defaultModel = normalizeModelForLiveProvider(String(row.provider).toUpperCase(), rawModel);
    const ah = activeAiHealthFromSnapshot(active, defaultModel, healthSnap);

    return {
      provider: row.provider,
      activeProvider: active,
      activeModel: defaultModel,
      enabled: true,
      defaultModel,
      maxTokens: settings['maxTokens'] as number | undefined,
      temperature: settings['temperature'] as number | undefined,
      hasApiKey: !!row.api_key,
      keysPresent,
      providerSnapshots,
      subaccountBehaviorPolicy,
      aiModelHealthSnapshot: healthSnap,
      activeAiHealth: {
        healthBadge: ah.healthBadge,
        lastHealthCheckedAt: ah.lastHealthCheckedAt,
        lastHealthLatencyMs: ah.lastHealthLatencyMs,
        lastHealthErrorSummary: ah.lastHealthErrorSummary,
      },
      liveAiCatalog,
    };
  }

  /** One-time style upgrade: agencies saved when M2.7 was the default still have it in settings JSON. */
  private async migrateLegacyMinimaxDefaultModels(
    agencyId: string,
    rows: Array<{ provider: string; settings: unknown }>,
  ): Promise<void> {
    for (const r of rows) {
      if (String(r.provider).toUpperCase() !== 'MINIMAX') continue;
      const s = (r.settings as Record<string, unknown> | null) ?? {};
      const stored = typeof s['defaultModel'] === 'string' ? s['defaultModel'].trim() : '';
      if (stored !== 'MiniMax-M2.7') continue;
      const next = { ...s, defaultModel: 'MiniMax-M3' };
      const { error } = await this.supabase
        .from('agency_model_providers')
        .update({ settings: next, updated_at: new Date().toISOString() })
        .eq('agency_id', agencyId)
        .eq('provider', 'MINIMAX');
      if (error) {
        this.logger.warn(`MiniMax M2.7→M3 migration failed for agency ${agencyId}: ${error.message}`);
      } else {
        this.logger.log(`Migrated agency ${agencyId} MiniMax default MiniMax-M2.7 → MiniMax-M3`);
      }
    }
  }

  private async persistHealthSnapshot(agencyId: string, snapshot: AiModelHealthSnapshot): Promise<void> {
    const { data: ag, error: aErr } = await this.supabase.from('agencies').select('settings').eq('id', agencyId).single();
    if (aErr || !ag) {
      this.logger.warn(`Could not persist AI health snapshot: agency read failed ${aErr?.message ?? ''}`);
      return;
    }
    const existing = (ag as { settings?: Record<string, unknown> }).settings ?? {};
    const next: Record<string, unknown> = { ...existing, [SETTINGS_HEALTH_KEY]: snapshot };
    const { error: uErr } = await this.supabase
      .from('agencies')
      .update({ settings: next, updated_at: new Date().toISOString() })
      .eq('id', agencyId);
    if (uErr) {
      this.logger.warn(`Could not persist AI health snapshot: ${uErr.message}`);
    }
  }

  async testModel(agencyId: string, dto: TestAgencyAiModelDto): Promise<AgencyAiModelTestResult> {
    const prov = dto.provider.toUpperCase() as SaveableProvider;
    assertAgencyLiveAiProvider(prov);
    assertModelBelongsToProvider(prov, dto.model);
    const model = dto.model.trim();
    const checkedAt = new Date().toISOString();

    const { data: row, error: rowErr } = await this.supabase
      .from('agency_model_providers')
      .select('api_key, endpoint, settings')
      .eq('agency_id', agencyId)
      .eq('provider', prov)
      .maybeSingle();

    if (rowErr) {
      this.logger.error(`testModel read row: ${rowErr.message}`);
    }

    const apiKey = (row?.api_key as string | undefined)?.trim();
    if (!apiKey) {
      const fail: AgencyAiModelTestResult = {
        status: 'FAIL',
        provider: prov,
        model,
        latencyMs: 0,
        checkedAt,
        errorCode: 'NO_KEY',
        errorSummary: 'No API key saved for this provider.',
      };
      await this.persistHealthSnapshot(agencyId, {
        lastHealthStatus: 'FAIL',
        lastHealthCheckedAt: checkedAt,
        lastHealthLatencyMs: 0,
        lastHealthErrorSummary: fail.errorSummary ?? null,
        lastHealthModel: model,
        lastHealthProvider: prov,
        lastHealthErrorCode: fail.errorCode,
      });
      return fail;
    }

    const prompt = 'Reply with exactly: OK';
    const t0 = Date.now();

    try {
      if (prov === 'OPENAI') {
        const url = openAiChatCompletionsUrl(row?.endpoint as string | null | undefined);
        const res = await axios.post(
          url,
          {
            model,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 8,
            temperature: 0,
          },
          {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            timeout: 10_000,
          },
        );
        const latencyMs = Date.now() - t0;
        const text = extractAssistantTextFromOpenAiCompatibleBody(res.data);
        const ok = assistantReplyPresentForHealthCheck(text);
        if (!ok) {
          const fail: AgencyAiModelTestResult = {
            status: 'FAIL',
            provider: prov,
            model,
            latencyMs,
            checkedAt,
            errorCode: 'EMPTY_OR_UNREADABLE_REPLY',
            errorSummary: 'The model responded, but AISalesBot Pro could not verify the response format.',
          };
          await this.persistHealthSnapshot(agencyId, {
            lastHealthStatus: 'FAIL',
            lastHealthCheckedAt: checkedAt,
            lastHealthLatencyMs: latencyMs,
            lastHealthErrorSummary: fail.errorSummary ?? null,
            lastHealthModel: model,
            lastHealthProvider: prov,
            lastHealthErrorCode: fail.errorCode,
          });
          return fail;
        }
        const pass: AgencyAiModelTestResult = {
          status: 'PASS',
          provider: prov,
          model,
          latencyMs,
          checkedAt,
        };
        await this.persistHealthSnapshot(agencyId, {
          lastHealthStatus: 'PASS',
          lastHealthCheckedAt: checkedAt,
          lastHealthLatencyMs: latencyMs,
          lastHealthErrorSummary: null,
          lastHealthModel: model,
          lastHealthProvider: prov,
        });
        return pass;
      }

      const settings = (row?.settings as Record<string, unknown> | undefined) ?? {};
      const groupId = (settings['minimaxGroupId'] as string | undefined)?.trim() || undefined;
      const out = await minimaxChatCompletion({
        apiKey,
        baseUrl: (row?.endpoint as string | null | undefined) ?? undefined,
        groupId,
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        maxTokens: 8,
        timeoutMs: 10_000,
      });
      const latencyMs = Date.now() - t0;
      const ok = assistantReplyPresentForHealthCheck(String(out.content ?? ''));
      if (!ok) {
        const fail: AgencyAiModelTestResult = {
          status: 'FAIL',
          provider: prov,
          model,
          latencyMs,
          checkedAt,
          errorCode: 'EMPTY_OR_UNREADABLE_REPLY',
          errorSummary: 'MiniMax responded, but AISalesBot Pro could not verify the response format.',
        };
        await this.persistHealthSnapshot(agencyId, {
          lastHealthStatus: 'FAIL',
          lastHealthCheckedAt: checkedAt,
          lastHealthLatencyMs: latencyMs,
          lastHealthErrorSummary: fail.errorSummary ?? null,
          lastHealthModel: model,
          lastHealthProvider: prov,
          lastHealthErrorCode: fail.errorCode,
        });
        return fail;
      }
      const pass: AgencyAiModelTestResult = {
        status: 'PASS',
        provider: prov,
        model,
        latencyMs,
        checkedAt,
      };
      await this.persistHealthSnapshot(agencyId, {
        lastHealthStatus: 'PASS',
        lastHealthCheckedAt: checkedAt,
        lastHealthLatencyMs: latencyMs,
        lastHealthErrorSummary: null,
        lastHealthModel: model,
        lastHealthProvider: prov,
      });
      return pass;
    } catch (err) {
      const latencyMs = Date.now() - t0;
      const { errorCode, errorSummary } = agencyAiHealthErrorSummary(prov, err);
      const fail: AgencyAiModelTestResult = {
        status: 'FAIL',
        provider: prov,
        model,
        latencyMs,
        checkedAt,
        errorCode,
        errorSummary,
      };
      await this.persistHealthSnapshot(agencyId, {
        lastHealthStatus: 'FAIL',
        lastHealthCheckedAt: checkedAt,
        lastHealthLatencyMs: latencyMs,
        lastHealthErrorSummary: errorSummary,
        lastHealthModel: model,
        lastHealthProvider: prov,
        lastHealthErrorCode: errorCode,
      });
      return fail;
    }
  }

  async saveSubaccountBehaviorPolicy(
    agencyId: string,
    policy: SubaccountBehaviorPolicy,
    profileId?: string,
  ): Promise<SubaccountBehaviorPolicy> {
    if (policy.temperatureMin > policy.temperatureMax) {
      throw new BadRequestException('temperatureMin must be less than or equal to temperatureMax');
    }
    if (policy.maxTokensMin > policy.maxTokensMax) {
      throw new BadRequestException('maxTokensMin must be less than or equal to maxTokensMax');
    }
    const { data: ag, error: aErr } = await this.supabase
      .from('agencies')
      .select('settings')
      .eq('id', agencyId)
      .single();
    if (aErr || !ag) {
      throw new Error(`Agency not found: ${aErr?.message ?? ''}`);
    }
    const existing = (ag as { settings?: Record<string, unknown> }).settings ?? {};
    const next: Record<string, unknown> = {
      ...existing,
      subaccountBehaviorPolicy: policy,
    };
    const { error: uErr } = await this.supabase
      .from('agencies')
      .update({ settings: next, updated_at: new Date().toISOString() })
      .eq('id', agencyId);
    if (uErr) {
      throw new Error(`Failed to save policy: ${uErr.message}`);
    }
    this.logger.log(`Subaccount behavior policy updated for agency ${agencyId}`);

    if (profileId) {
      await this.supabase.from('quota_audit_logs').insert({
        id: randomUUID(),
        agency_id: agencyId,
        profile_id: profileId,
        tenant_id: null,
        action: 'agency.reply_policy',
        delta: 0,
        previous_total: null,
        new_total: null,
        metadata: { subaccountBehaviorPolicy: policy },
      });
    }
    return policy;
  }

  async saveConfig(agencyId: string, dto: SaveAgencyAiConfigDto, profileId?: string): Promise<AgencyAiConfig> {
    assertModelBelongsToProvider(dto.provider, dto.defaultModel);

    const { data: existingRow, error: existingErr } = await this.supabase
      .from('agency_model_providers')
      .select('id, api_key, settings, endpoint')
      .eq('agency_id', agencyId)
      .eq('provider', dto.provider)
      .maybeSingle();

    if (existingErr && existingErr.code !== 'PGRST116') {
      this.logger.error(`Failed to read agency_model_providers: ${existingErr.message}`);
      throw new Error(`Failed to save config: ${existingErr.message}`);
    }

    const keyIncoming = dto.apiKey?.trim();
    const keepKey = existingRow && (!keyIncoming || keyIncoming.length === 0);
    if (!existingRow && (!keyIncoming || keyIncoming.length === 0)) {
      throw new BadRequestException('API key is required when creating a new provider row');
    }
    if (dto.provider === 'MINIMAX' && !keepKey && (!keyIncoming || keyIncoming.length === 0)) {
      throw new BadRequestException('API key is required for MiniMax');
    }

    const prevSettings = (existingRow?.settings as Record<string, unknown> | undefined) ?? {};
    const settings: Record<string, unknown> = {
      defaultModel: dto.defaultModel.trim(),
      maxTokens: dto.maxTokens ?? (prevSettings['maxTokens'] as number) ?? 500,
      temperature: dto.temperature ?? (prevSettings['temperature'] as number) ?? 0.7,
    };
    if (dto.provider === 'MINIMAX') {
      if (dto.minimaxGroupId !== undefined) {
        const g = dto.minimaxGroupId.trim();
        settings['minimaxGroupId'] = g || undefined;
      } else {
        const prevG = prevSettings['minimaxGroupId'];
        if (prevG !== undefined) settings['minimaxGroupId'] = prevG;
      }
    }

    const updatedAt = new Date().toISOString();
    const prevEndpoint = (existingRow as { endpoint?: string | null } | null)?.endpoint ?? null;
    const endpointForRow =
      dto.provider === 'MINIMAX'
        ? (() => {
            const t = dto.endpoint !== undefined ? dto.endpoint.trim() : '';
            if (dto.endpoint === undefined) {
              return prevEndpoint && String(prevEndpoint).trim() ? String(prevEndpoint).trim() : MINIMAX_DEFAULT_API_BASE;
            }
            if (!t || /\bapi\.minimax\.chat\b/i.test(t)) return MINIMAX_DEFAULT_API_BASE;
            return t;
          })()
        : dto.endpoint !== undefined
          ? dto.endpoint.trim() || null
          : prevEndpoint;

    const payload: Record<string, unknown> = {
      endpoint: endpointForRow,
      settings,
      updated_at: updatedAt,
    };
    if (keepKey) {
      // keep existing key
    } else {
      payload['api_key'] = keyIncoming;
    }

    let result;
    if (existingRow) {
      result = await this.supabase
        .from('agency_model_providers')
        .update(payload)
        .eq('id', existingRow.id)
        .select('provider, api_key, settings')
        .single();
    } else {
      result = await this.supabase
        .from('agency_model_providers')
        .insert({
          id: randomUUID(),
          agency_id: agencyId,
          provider: dto.provider,
          ...payload,
          api_key: keyIncoming,
        })
        .select('provider, api_key, settings')
        .single();
    }

    const { data, error } = result;
    if (error || !data) {
      throw new Error(`Failed to save config: ${error?.message ?? 'no row'}`);
    }

    const { data: agRow } = await this.supabase
      .from('agencies')
      .select('active_ai_provider')
      .eq('id', agencyId)
      .single();
    const previousActive = (agRow as { active_ai_provider?: string } | null)?.active_ai_provider ?? null;

    const setActive = dto.setAsActive !== false;
    if (setActive) {
      const { data: updated, error: uAg } = await this.supabase
        .from('agencies')
        .update({ active_ai_provider: dto.provider, updated_at: new Date().toISOString() })
        .eq('id', agencyId)
        .select('id, active_ai_provider');
      if (uAg) {
        throw new BadRequestException(`Could not set active live provider: ${uAg.message ?? 'database error'}`);
      }
      if (!updated?.length) {
        throw new BadRequestException('Agency not found when setting active live provider');
      }
    }

    this.logger.log(`Agency AI config saved: agencyId=${agencyId}, provider=${dto.provider}`);

    if (profileId) {
      const keyRotated = !keepKey && Boolean(keyIncoming);
      const activeAfter = setActive ? dto.provider : previousActive;
      await this.supabase.from('quota_audit_logs').insert({
        id: randomUUID(),
        agency_id: agencyId,
        profile_id: profileId,
        tenant_id: null,
        action: 'agency.ai_settings',
        delta: 0,
        previous_total: null,
        new_total: null,
        metadata: {
          provider: dto.provider,
          defaultModel: dto.defaultModel,
          setAsActive: setActive,
          previousActiveProvider: previousActive,
          activeProviderAfter: activeAfter,
          keyRotated,
        },
      });
    }

    const out = await this.getConfig(agencyId);
    if (!out) throw new Error('Failed to load config after save');
    return out;
  }

  async setActiveProvider(agencyId: string, provider: SaveableProvider, profileId?: string): Promise<AgencyAiConfig> {
    assertAgencyLiveAiProvider(provider);
    const { data: agBefore } = await this.supabase
      .from('agencies')
      .select('active_ai_provider')
      .eq('id', agencyId)
      .single();
    const prevActive = (agBefore as { active_ai_provider?: string } | null)?.active_ai_provider ?? null;

    const { data: row } = await this.supabase
      .from('agency_model_providers')
      .select('id, api_key')
      .eq('agency_id', agencyId)
      .eq('provider', provider)
      .maybeSingle();
    if (!row?.api_key) {
      throw new BadRequestException(`No API key stored for ${provider}. Save credentials first.`);
    }
    const { data: updated, error } = await this.supabase
      .from('agencies')
      .update({ active_ai_provider: provider, updated_at: new Date().toISOString() })
      .eq('id', agencyId)
      .select('id');
    if (error) throw new Error(error.message);
    if (!updated?.length) {
      throw new BadRequestException('Agency not found when setting active provider');
    }

    if (profileId) {
      await this.supabase.from('quota_audit_logs').insert({
        id: randomUUID(),
        agency_id: agencyId,
        profile_id: profileId,
        tenant_id: null,
        action: 'agency.active_provider',
        delta: 0,
        previous_total: null,
        new_total: null,
        metadata: { previousActiveProvider: prevActive, newActiveProvider: provider },
      });
    }
    const out = await this.getConfig(agencyId);
    if (!out) throw new Error('Failed to load config');
    return out;
  }
}
