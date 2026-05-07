import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { getSupabaseService } from '../../lib/supabase';

export interface TenantHumanEscalationSettingsDto {
  enabled: boolean;
  teamNotificationNumber: string | null;
  optionalMessagePrefix: string | null;
}

const DEFAULT: TenantHumanEscalationSettingsDto = {
  enabled: false,
  teamNotificationNumber: null,
  optionalMessagePrefix: null,
};

function normalizeNumber(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const t = String(raw).trim();
  return t.length ? t : null;
}

@Injectable()
export class HumanEscalationSettingsService {
  private readonly logger = new Logger(HumanEscalationSettingsService.name);
  private readonly supabase = getSupabaseService();

  async getSettings(tenantId: string): Promise<TenantHumanEscalationSettingsDto> {
    const { data, error } = await this.supabase
      .from('tenant_human_escalation_settings')
      .select('*')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (error) {
      this.logger.warn(`humanEscalationSettingsLoadFailed ${JSON.stringify({ tenantId, message: error.message })}`);
      throw new BadRequestException('Could not load human escalation settings');
    }
    if (!data) return { ...DEFAULT };

    const row = data as Record<string, unknown>;
    return {
      enabled: Boolean(row['enabled']),
      teamNotificationNumber: normalizeNumber(row['team_notification_number'] as string | null),
      optionalMessagePrefix:
        row['optional_message_prefix'] != null && String(row['optional_message_prefix']).trim()
          ? String(row['optional_message_prefix']).trim()
          : null,
    };
  }

  async patchSettings(tenantId: string, raw: unknown): Promise<TenantHumanEscalationSettingsDto> {
    if (!raw || typeof raw !== 'object') throw new BadRequestException('Invalid body');
    const o = raw as Record<string, unknown>;
    const current = await this.getSettings(tenantId);

    const enabled = o['enabled'] !== undefined ? Boolean(o['enabled']) : current.enabled;
    const teamNotificationNumber =
      o['teamNotificationNumber'] !== undefined
        ? normalizeNumber(o['teamNotificationNumber'] as string | null)
        : current.teamNotificationNumber;
    const optionalMessagePrefix =
      o['optionalMessagePrefix'] !== undefined
        ? o['optionalMessagePrefix'] === null || o['optionalMessagePrefix'] === ''
          ? null
          : String(o['optionalMessagePrefix']).trim() || null
        : current.optionalMessagePrefix;

    if (enabled && !teamNotificationNumber?.trim()) {
      throw new BadRequestException('Team notification number is required when human escalation is enabled');
    }

    const now = new Date().toISOString();
    const payload = {
      tenant_id: tenantId,
      enabled,
      team_notification_number: teamNotificationNumber,
      optional_message_prefix: optionalMessagePrefix,
      updated_at: now,
    };

    const { data: existing } = await this.supabase
      .from('tenant_human_escalation_settings')
      .select('tenant_id')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (existing) {
      const { error } = await this.supabase.from('tenant_human_escalation_settings').update(payload).eq('tenant_id', tenantId);
      if (error) throw new BadRequestException(error.message);
    } else {
      const { error } = await this.supabase.from('tenant_human_escalation_settings').insert({
        ...payload,
        created_at: now,
      });
      if (error) throw new BadRequestException(error.message);
    }

    this.logger.log(`humanEscalationSettingsSaved ${JSON.stringify({ tenantId, enabled })}`);
    return this.getSettings(tenantId);
  }
}
