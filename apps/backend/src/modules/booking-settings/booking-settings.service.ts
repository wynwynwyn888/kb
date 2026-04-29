import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { getSupabaseService } from '../../lib/supabase';
import { GhlService } from '../ghl/ghl.service';
import type { GhlCalendarSummary, GhlFreeSlot } from '@aisbp/ghl-client';
import {
  assertAllowedRequiredFieldKeys,
  parseBookingMode,
  parseRequiredFieldsJson,
} from '../../lib/tenant-automation-validation';
import type { BookingMode } from '../../lib/tenant-automation-constants';

export interface TenantBookingSettingsDto {
  enabled: boolean;
  bookingMode: BookingMode;
  defaultGhlCalendarId: string | null;
  defaultGhlCalendarName: string | null;
  requiredFieldsJson: string[];
}

const DEFAULT_SETTINGS: TenantBookingSettingsDto = {
  enabled: false,
  bookingMode: 'COLLECT_DETAILS_ONLY',
  defaultGhlCalendarId: null,
  defaultGhlCalendarName: null,
  requiredFieldsJson: [],
};

function rowToDto(row: Record<string, unknown>): TenantBookingSettingsDto {
  const rf = row['required_fields_json'];
  let requiredFieldsJson: string[] = [];
  try {
    requiredFieldsJson =
      rf === undefined || rf === null ? [] : parseRequiredFieldsJson(rf as unknown);
  } catch {
    requiredFieldsJson = [];
  }
  return {
    enabled: Boolean(row['enabled']),
    bookingMode: String(row['booking_mode'] ?? 'COLLECT_DETAILS_ONLY') as BookingMode,
    defaultGhlCalendarId:
      row['default_ghl_calendar_id'] === null || row['default_ghl_calendar_id'] === undefined
        ? null
        : String(row['default_ghl_calendar_id']),
    defaultGhlCalendarName:
      row['default_ghl_calendar_name'] === null || row['default_ghl_calendar_name'] === undefined
        ? null
        : String(row['default_ghl_calendar_name']),
    requiredFieldsJson,
  };
}

@Injectable()
export class BookingSettingsService {
  private readonly logger = new Logger(BookingSettingsService.name);
  private readonly supabase = getSupabaseService();

  constructor(private readonly ghlService: GhlService) {}

  async getBookingSettings(tenantId: string): Promise<TenantBookingSettingsDto> {
    const { data, error } = await this.supabase
      .from('tenant_booking_settings')
      .select('*')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (error) {
      this.logger.warn(`getBookingSettings: ${error.message}`);
      throw new BadRequestException('Could not load booking settings');
    }
    if (!data) return { ...DEFAULT_SETTINGS };
    return rowToDto(data as Record<string, unknown>);
  }

  async patchBookingSettings(
    tenantId: string,
    patch: Partial<{
      enabled: boolean;
      bookingMode: unknown;
      defaultGhlCalendarId: string | null;
      defaultGhlCalendarName: string | null;
      requiredFieldsJson: unknown;
    }>,
  ): Promise<TenantBookingSettingsDto> {
    const current = await this.getBookingSettings(tenantId);

    let bookingMode = current.bookingMode;
    if (patch.bookingMode !== undefined) {
      bookingMode = parseBookingMode(patch.bookingMode);
    }

    let requiredFieldsJson = current.requiredFieldsJson;
    if (patch.requiredFieldsJson !== undefined) {
      requiredFieldsJson = parseRequiredFieldsJson(patch.requiredFieldsJson);
      assertAllowedRequiredFieldKeys(requiredFieldsJson);
    }

    const enabled = patch.enabled !== undefined ? Boolean(patch.enabled) : current.enabled;
    const defaultGhlCalendarId =
      patch.defaultGhlCalendarId !== undefined ? patch.defaultGhlCalendarId : current.defaultGhlCalendarId;
    const defaultGhlCalendarName =
      patch.defaultGhlCalendarName !== undefined
        ? patch.defaultGhlCalendarName
        : current.defaultGhlCalendarName;

    const now = new Date().toISOString();

    const { data: existing } = await this.supabase
      .from('tenant_booking_settings')
      .select('tenant_id')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    const payload = {
      tenant_id: tenantId,
      enabled,
      booking_mode: bookingMode,
      default_ghl_calendar_id: defaultGhlCalendarId,
      default_ghl_calendar_name: defaultGhlCalendarName,
      required_fields_json: requiredFieldsJson,
      updated_at: now,
    };

    if (existing) {
      const { error } = await this.supabase.from('tenant_booking_settings').update(payload).eq('tenant_id', tenantId);
      if (error) {
        throw new BadRequestException(`Could not save booking settings: ${error.message}`);
      }
    } else {
      const { error } = await this.supabase.from('tenant_booking_settings').insert({
        ...payload,
        created_at: now,
      });
      if (error) {
        throw new BadRequestException(`Could not save booking settings: ${error.message}`);
      }
    }

    return this.getBookingSettings(tenantId);
  }

  async syncCalendars(tenantId: string, profileId: string): Promise<{
    calendars: GhlCalendarSummary[];
    syncedAt: string;
    error?: string;
  }> {
    const { client } = await this.ghlService.createGhlClientForConnectedTenantOrThrow(tenantId, profileId);
    const r = await client.listCalendars();
    const syncedAt = new Date().toISOString();
    if (r.error) {
      this.logger.warn(`syncCalendars GHL: ${r.error}`);
    }
    return { calendars: r.calendars, syncedAt, error: r.error };
  }

  async testCalendar(tenantId: string, profileId: string): Promise<{
    ok: boolean;
    calendarId: string | null;
    message: string;
    calendars?: GhlCalendarSummary[];
  }> {
    const settings = await this.getBookingSettings(tenantId);
    const calendarId = settings.defaultGhlCalendarId?.trim() || null;
    if (!calendarId) {
      return { ok: false, calendarId: null, message: 'Set a default calendar first.' };
    }

    const { client } = await this.ghlService.createGhlClientForConnectedTenantOrThrow(tenantId, profileId);
    const listed = await client.listCalendars();
    if (listed.error) {
      return { ok: false, calendarId, message: listed.error, calendars: listed.calendars };
    }
    const found = listed.calendars.some((c) => c.id === calendarId);
    if (!found) {
      return {
        ok: false,
        calendarId,
        message: 'Default calendar id was not returned by GHL for this location.',
        calendars: listed.calendars,
      };
    }
    return {
      ok: true,
      calendarId,
      message: 'Calendar is reachable.',
      calendars: listed.calendars,
    };
  }

  async testSlots(
    tenantId: string,
    profileId: string,
    body: { startDate?: string; endDate?: string; timezone?: string },
  ): Promise<{ slots: GhlFreeSlot[]; calendarId: string | null; error?: string }> {
    const settings = await this.getBookingSettings(tenantId);
    const calendarId = settings.defaultGhlCalendarId?.trim() || null;
    if (!calendarId) {
      throw new BadRequestException('Set a default calendar first.');
    }

    const start = body.startDate?.trim();
    const end = body.endDate?.trim();
    const today = new Date();
    const startDate =
      start ||
      `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const endD = new Date(today);
    endD.setDate(endD.getDate() + 7);
    const endDate =
      end ||
      `${endD.getFullYear()}-${String(endD.getMonth() + 1).padStart(2, '0')}-${String(endD.getDate()).padStart(2, '0')}`;

    const { client } = await this.ghlService.createGhlClientForConnectedTenantOrThrow(tenantId, profileId);
    const r = await client.getFreeSlots({
      calendarId,
      startDate,
      endDate,
      timezone: body.timezone?.trim() || undefined,
    });
    if (r.error) {
      this.logger.warn(`testSlots GHL: ${r.error}`);
    }
    return { slots: r.slots, calendarId, error: r.error };
  }
}
