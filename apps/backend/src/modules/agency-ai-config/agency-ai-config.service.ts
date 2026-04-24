// Agency AI Config — multi-provider rows + active provider on `agencies`.

import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { getSupabaseService } from '../../lib/supabase';

export interface AgencyProviderFormSnapshot {
  defaultModel: string;
  maxTokens?: number;
  temperature?: number;
  hasKey: boolean;
  minimaxGroupId?: string;
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
}

export type SaveableProvider = 'OPENAI' | 'MINIMAX' | 'ANTHROPIC' | 'GOOGLE' | 'AZURE' | 'CUSTOM';

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
    allowResponseStyleOverride: typeof o['allowResponseStyleOverride'] === 'boolean' ? o['allowResponseStyleOverride']! : DEFAULT_SUBACCOUNT_BEHAVIOR.allowResponseStyleOverride,
    allowMaxTokensOverride: typeof o['allowMaxTokensOverride'] === 'boolean' ? o['allowMaxTokensOverride']! : DEFAULT_SUBACCOUNT_BEHAVIOR.allowMaxTokensOverride,
  };
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

    const { data: rows } = await this.supabase
      .from('agency_model_providers')
      .select('provider, api_key, settings')
      .eq('agency_id', agencyId);

    const keysPresent: Partial<Record<string, boolean>> = {};
    const providerSnapshots: Partial<Record<string, AgencyProviderFormSnapshot>> = {};

    for (const r of rows ?? []) {
      keysPresent[r.provider] = Boolean(r.api_key);
      const s = (r.settings as Record<string, unknown> | null) ?? {};
      const mg = s['minimaxGroupId'] as string | undefined;
      const prov = String(r.provider).toUpperCase();
      const snapshotDefault =
        (s['defaultModel'] as string) ?? (prov === 'MINIMAX' ? 'MiniMax-M2.7' : 'gpt-4o-mini');
      providerSnapshots[r.provider] = {
        defaultModel: snapshotDefault,
        maxTokens: s['maxTokens'] as number | undefined,
        temperature: s['temperature'] as number | undefined,
        hasKey: Boolean(r.api_key),
        ...(mg?.trim() ? { minimaxGroupId: mg.trim() } : {}),
      };
    }

    const row = (rows ?? []).find(r => String(r.provider).toUpperCase() === active);

    if (!row) {
      const fallback = active === 'MINIMAX' ? 'MiniMax-M2.7' : 'gpt-4o-mini';
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
      };
    }

    const settings = row.settings as Record<string, unknown> ?? {};
    const isMinimax = String(row.provider).toUpperCase() === 'MINIMAX';
    const defaultModel =
      (settings['defaultModel'] as string) ?? (isMinimax ? 'MiniMax-M2.7' : 'gpt-4o-mini');

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
    };
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

  async saveConfig(
    agencyId: string,
    dto: SaveAgencyAiConfigDto,
    profileId?: string,
  ): Promise<AgencyAiConfig> {
    const { data: existingRow, error: existingErr } = await this.supabase
      .from('agency_model_providers')
      .select('id, api_key, settings')
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
      throw new Error('API key is required when creating a new provider row');
    }
    if (dto.provider === 'MINIMAX' && !keepKey && (!keyIncoming || keyIncoming.length === 0)) {
      throw new Error('API key is required for MiniMax');
    }

    const prevSettings = (existingRow?.settings as Record<string, unknown> | undefined) ?? {};
    const settings: Record<string, unknown> = {
      defaultModel: dto.defaultModel,
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
    /** International MiniMax keys authenticate on `api.minimax.io`; `api.minimax.chat` often returns 2049 for the same token. */
    const minimaxApiBase = 'https://api.minimax.io/v1';
    const endpointForRow =
      dto.provider === 'MINIMAX'
        ? (() => {
            const t = dto.endpoint?.trim() ?? '';
            if (!t || /\bapi\.minimax\.chat\b/i.test(t)) return minimaxApiBase;
            return t;
          })()
        : (dto.endpoint?.trim() || null);

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

    // Omitted/undefined: treat as true so clients that forget the flag still rotate the live stack.
    // Explicit `false` means "save this row but do not change the agency active provider".
    const setActive = dto.setAsActive !== false;
    if (setActive) {
      if (dto.provider !== 'OPENAI' && dto.provider !== 'MINIMAX') {
        throw new BadRequestException(
          'Only OPENAI or MINIMAX can be set as the active live provider with the current generation stack.',
        );
      }
      const { data: updated, error: uAg } = await this.supabase
        .from('agencies')
        .update({ active_ai_provider: dto.provider, updated_at: new Date().toISOString() })
        .eq('id', agencyId)
        .select('id, active_ai_provider');
      if (uAg) {
        throw new BadRequestException(
          `Could not set active live provider: ${uAg.message ?? 'database error'}`,
        );
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

  async setActiveProvider(
    agencyId: string,
    provider: SaveableProvider,
    profileId?: string,
  ): Promise<AgencyAiConfig> {
    if (provider !== 'OPENAI' && provider !== 'MINIMAX') {
      throw new BadRequestException(
        'Only OPENAI or MINIMAX can be the active live provider with the current generation stack.',
      );
    }
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
