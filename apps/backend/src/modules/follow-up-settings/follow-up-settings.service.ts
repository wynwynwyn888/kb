import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { getSupabaseService } from '../../lib/supabase';
import {
  parseFollowUpSteps,
  parseActiveHoursWindowsJson,
  parseFollowUpActiveHoursTimezoneMode,
} from '../../lib/tenant-automation-validation';
import type { FollowUpActiveHoursTimezoneMode } from '../../lib/tenant-automation-constants';

export interface FollowUpStepApi {
  stepNumber: number;
  delayAmount: number;
  delayUnit: string;
  mode: string;
  fixedMessage?: string;
  aiInstruction?: string;
  enabled: boolean;
}

export type ActiveHoursDayWindow = { enabled: boolean; start: string; end: string };

export interface TenantFollowUpSettingsDto {
  enabled: boolean;
  maxFollowUps: number;
  stopOnCustomerReply: boolean;
  stopOnBookingCompleted: boolean;
  stopOnEscalated: boolean;
  stopOnOptOut: boolean;
  businessHoursOnly: boolean;
  activeHoursTimezoneMode: FollowUpActiveHoursTimezoneMode;
  activeHoursWindows: Record<string, ActiveHoursDayWindow>;
  steps: FollowUpStepApi[];
}

const DEFAULT_AI_INSTRUCTION =
  'Gentle nudge only. Do not sound salesy. Follow up based on the previous conversation context.';

const DEFAULT: TenantFollowUpSettingsDto = {
  enabled: false,
  maxFollowUps: 3,
  stopOnCustomerReply: true,
  stopOnBookingCompleted: false,
  stopOnEscalated: true,
  stopOnOptOut: true,
  businessHoursOnly: false,
  activeHoursTimezoneMode: 'BUSINESS',
  activeHoursWindows: parseActiveHoursWindowsJson({}),
  steps: [],
};

function normalizeStepsWithDefaults(steps: FollowUpStepApi[]): FollowUpStepApi[] {
  return steps.map((s) => {
    const mode = String(s.mode ?? '').trim();
    if (mode === 'ai_decides') {
      const aiInstruction = typeof s.aiInstruction === 'string' ? s.aiInstruction : '';
      const nextInstr = aiInstruction.trim() ? aiInstruction : DEFAULT_AI_INSTRUCTION;
      return { ...s, aiInstruction: nextInstr };
    }
    return s;
  });
}

function rowToDto(row: Record<string, unknown>): TenantFollowUpSettingsDto {
  const rawSteps = row['steps_json'];
  let steps: FollowUpStepApi[] = [];
  try {
    steps = parseFollowUpSteps(rawSteps);
  } catch {
    steps = [];
  }
  let activeHoursWindows = DEFAULT.activeHoursWindows;
  try {
    activeHoursWindows = parseActiveHoursWindowsJson(row['active_hours_windows_json']);
  } catch {
    activeHoursWindows = parseActiveHoursWindowsJson({});
  }
  let activeHoursTimezoneMode: FollowUpActiveHoursTimezoneMode = 'BUSINESS';
  try {
    activeHoursTimezoneMode = parseFollowUpActiveHoursTimezoneMode(row['active_hours_timezone_mode']);
  } catch {
    activeHoursTimezoneMode = 'BUSINESS';
  }
  const mf = Number(row['max_follow_ups'] ?? 3);
  return {
    enabled: Boolean(row['enabled']),
    maxFollowUps: Number.isFinite(mf) ? Math.min(10, Math.max(1, Math.floor(mf))) : 3,
    stopOnCustomerReply: Boolean(row['stop_on_customer_reply']),
    /** Legacy column ignored at runtime — always false for API consumers. */
    stopOnBookingCompleted: false,
    stopOnEscalated: Boolean(row['stop_on_escalated']),
    stopOnOptOut: Boolean(row['stop_on_opt_out']),
    businessHoursOnly: Boolean(row['business_hours_only']),
    activeHoursTimezoneMode,
    activeHoursWindows,
    steps: normalizeStepsWithDefaults(steps),
  };
}

@Injectable()
export class FollowUpSettingsService {
  private readonly logger = new Logger(FollowUpSettingsService.name);
  private readonly supabase = getSupabaseService();

  async getFollowUpSettings(tenantId: string): Promise<TenantFollowUpSettingsDto> {
    const { data, error } = await this.supabase
      .from('tenant_follow_up_settings')
      .select('*')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (error) {
      this.logger.warn(`getFollowUpSettings: ${error.message}`);
      throw new BadRequestException('Could not load follow-up settings');
    }
    if (!data) return { ...DEFAULT };
    return rowToDto(data as Record<string, unknown>);
  }

  async patchFollowUpSettings(tenantId: string, raw: unknown): Promise<TenantFollowUpSettingsDto> {
    if (!raw || typeof raw !== 'object') throw new BadRequestException('Invalid body');
    const o = raw as Record<string, unknown>;
    const current = await this.getFollowUpSettings(tenantId);

    const enabled = o['enabled'] !== undefined ? Boolean(o['enabled']) : current.enabled;
    let maxFollowUps = current.maxFollowUps;
    if (o['maxFollowUps'] !== undefined) {
      const n = Number(o['maxFollowUps']);
      if (!Number.isFinite(n)) throw new BadRequestException('maxFollowUps must be a number');
      maxFollowUps = Math.min(10, Math.max(1, Math.floor(n)));
    }

    const stopOnCustomerReply =
      o['stopOnCustomerReply'] !== undefined ? Boolean(o['stopOnCustomerReply']) : current.stopOnCustomerReply;
    const stopOnEscalated = o['stopOnEscalated'] !== undefined ? Boolean(o['stopOnEscalated']) : current.stopOnEscalated;
    const stopOnOptOut = o['stopOnOptOut'] !== undefined ? Boolean(o['stopOnOptOut']) : current.stopOnOptOut;
    const businessHoursOnly =
      o['businessHoursOnly'] !== undefined ? Boolean(o['businessHoursOnly']) : current.businessHoursOnly;

    let activeHoursTimezoneMode = current.activeHoursTimezoneMode;
    if (o['activeHoursTimezoneMode'] !== undefined) {
      activeHoursTimezoneMode = parseFollowUpActiveHoursTimezoneMode(o['activeHoursTimezoneMode']);
    }

    let activeHoursWindows = current.activeHoursWindows;
    if (o['activeHoursWindows'] !== undefined) {
      activeHoursWindows = parseActiveHoursWindowsJson(o['activeHoursWindows']);
    }

    let steps = current.steps;
    if (o['steps'] !== undefined) {
      steps = parseFollowUpSteps(o['steps']);
    }
    steps = normalizeStepsWithDefaults(steps);

    // Enforce enabled-step requirements (defaults are applied above for ai_decides).
    for (const s of steps) {
      if (!s.enabled) continue;
      if (String(s.mode) === 'fixed_message' && !(s.fixedMessage ?? '').trim()) {
        throw new BadRequestException(`Step ${s.stepNumber}: fixed message required when enabled`);
      }
      if (String(s.mode) === 'ai_decides' && !(s.aiInstruction ?? '').trim()) {
        throw new BadRequestException(`Step ${s.stepNumber}: AI instruction required when enabled`);
      }
    }

    const now = new Date().toISOString();
    const payload = {
      tenant_id: tenantId,
      enabled,
      max_follow_ups: maxFollowUps,
      stop_on_customer_reply: stopOnCustomerReply,
      stop_on_booking_completed: false,
      stop_on_escalated: stopOnEscalated,
      stop_on_opt_out: stopOnOptOut,
      business_hours_only: businessHoursOnly,
      active_hours_timezone_mode: activeHoursTimezoneMode,
      active_hours_windows_json: activeHoursWindows,
      steps_json: steps,
      updated_at: now,
    };

    const { data: existing } = await this.supabase.from('tenant_follow_up_settings').select('tenant_id').eq('tenant_id', tenantId).maybeSingle();

    if (existing) {
      const { error } = await this.supabase.from('tenant_follow_up_settings').update(payload).eq('tenant_id', tenantId);
      if (error) throw new BadRequestException(error.message);
    } else {
      const { error } = await this.supabase.from('tenant_follow_up_settings').insert({
        ...payload,
        created_at: now,
      });
      if (error) throw new BadRequestException(error.message);
    }

    this.logger.log(
      `followUpSettingsSaved ${JSON.stringify({
        tenantId,
        enabled,
        businessHoursOnly,
        stepsTotal: steps.length,
        stepsEnabled: steps.filter(s => s.enabled).length,
      })}`,
    );

    return this.getFollowUpSettings(tenantId);
  }
}
