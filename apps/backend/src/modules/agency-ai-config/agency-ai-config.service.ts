// Agency AI Config service - manage agency-level AI provider configuration

import { Injectable, Logger } from '@nestjs/common';
import { getSupabaseService } from '../../lib/supabase';

export interface AgencyAiConfig {
  provider: string;
  enabled: boolean;
  defaultModel: string;
  maxTokens?: number;
  temperature?: number;
  hasApiKey: boolean; // true if apiKey is stored (even if masked)
}

export interface SaveAgencyAiConfigDto {
  provider: 'OPENAI' | 'ANTHROPIC' | 'GOOGLE' | 'AZURE' | 'CUSTOM';
  apiKey: string;
  endpoint?: string;
  defaultModel: string;
  maxTokens?: number;
  temperature?: number;
}

@Injectable()
export class AgencyAiConfigService {
  private readonly logger = new Logger(AgencyAiConfigService.name);
  private readonly supabase = getSupabaseService();

  async getConfig(agencyId: string): Promise<AgencyAiConfig | null> {
    const { data, error } = await this.supabase
      .from('agency_model_providers')
      .select('provider, api_key, endpoint, settings')
      .eq('agency_id', agencyId)
      .eq('provider', 'OPENAI')
      .single();

    if (error && error.code !== 'PGRST116') {
      this.logger.error(`Failed to get agency AI config: ${error.message}`);
      return null;
    }

    if (!data) return null;

    const settings = data.settings as Record<string, unknown> ?? {};

    return {
      provider: data.provider,
      enabled: true,
      defaultModel: (settings['defaultModel'] as string) ?? 'gpt-4o-mini',
      maxTokens: settings['maxTokens'] as number | undefined,
      temperature: settings['temperature'] as number | undefined,
      hasApiKey: !!data.api_key,
    };
  }

  async saveConfig(
    agencyId: string,
    dto: SaveAgencyAiConfigDto,
  ): Promise<AgencyAiConfig> {
    const settings = {
      defaultModel: dto.defaultModel,
      maxTokens: dto.maxTokens ?? 500,
      temperature: dto.temperature ?? 0.7,
    };

    // Upsert - update if exists, insert if not
    const { data, error } = await this.supabase
      .from('agency_model_providers')
      .upsert(
        {
          agency_id: agencyId,
          provider: dto.provider,
          api_key: dto.apiKey,
          endpoint: dto.endpoint ?? null,
          settings,
        },
        { onConflict: 'agency_id,provider' },
      )
      .select('provider, api_key, endpoint, settings')
      .single();

    if (error) {
      this.logger.error(`Failed to save agency AI config: ${error.message}`);
      throw new Error(`Failed to save config: ${error.message}`);
    }

    this.logger.log(`Agency AI config saved: agencyId=${agencyId}, provider=${dto.provider}`);

    const savedSettings = data.settings as Record<string, unknown> ?? {};

    return {
      provider: data.provider,
      enabled: true,
      defaultModel: (savedSettings['defaultModel'] as string) ?? dto.defaultModel,
      maxTokens: savedSettings['maxTokens'] as number | undefined,
      temperature: savedSettings['temperature'] as number | undefined,
      hasApiKey: true,
    };
  }
}
