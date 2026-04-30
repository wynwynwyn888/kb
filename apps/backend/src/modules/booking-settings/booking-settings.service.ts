import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { getSupabaseService } from '../../lib/supabase';
import { resolveAppTimeZone, wallClockInZoneToUtcMs } from '../../lib/business-time';
import { GhlService } from '../ghl/ghl.service';
import {
  GHL_CALENDARS_LIST_API_VERSION,
  formatGhlCalendarDetailSummary,
  type GhlCalendarDetailSummary,
  type GhlCalendarSummary,
  type GhlFreeSlot,
} from '@aisbp/ghl-client';
import {
  computeBookingScheduleDiagnostics,
  SCHED_WARN_FREE_SLOTS_EMPTY_RETRY,
  type BookingScheduleDiagnosticsDto,
} from './booking-schedule-diagnostics';
import {
  parseBookingMode,
  parseCoreFieldsJson,
  parseCustomFieldsJson,
  type CoreFieldToggle,
  type CustomBookingFieldDto,
} from '../../lib/tenant-automation-validation';
import { BOOKING_CORE_FIELD_KEYS, type BookingMode } from '../../lib/tenant-automation-constants';

export type TenantCoreFieldsDto = Record<string, CoreFieldToggle>;

export interface TenantBookingSettingsDto {
  enabled: boolean;
  bookingMode: BookingMode;
  defaultGhlCalendarId: string | null;
  defaultGhlCalendarName: string | null;
  coreFieldsJson: TenantCoreFieldsDto;
  customFieldsJson: CustomBookingFieldDto[];
  maxBookingsPerSlot: number;
}

function defaultCoreFields(): TenantCoreFieldsDto {
  const o: TenantCoreFieldsDto = {} as TenantCoreFieldsDto;
  for (const k of BOOKING_CORE_FIELD_KEYS) {
    o[k] = { enabled: false, required: false };
  }
  return o;
}

const DEFAULT_SETTINGS: TenantBookingSettingsDto = {
  enabled: false,
  bookingMode: 'COLLECT_DETAILS_ONLY',
  defaultGhlCalendarId: null,
  defaultGhlCalendarName: null,
  coreFieldsJson: defaultCoreFields(),
  customFieldsJson: [],
  maxBookingsPerSlot: 1,
};

function parseYmd(s: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  return { y, m: mo, d };
}

function parseHm(timeStr: string): { hour: number; minute: number } | null {
  const t = timeStr.trim();
  if (!t) return null;
  const pm = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(t);
  if (!pm) return null;
  const hour = parseInt(pm[1] ?? '', 10);
  const minute = parseInt(pm[2] ?? '', 10);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/**
 * Build UTC ms range for GHL free-slots from CRM-local date/time (IANA zone).
 */
function computeFreeSlotRangeMs(
  crmTz: string,
  body: {
    selectedDate?: string;
    selectedTime?: string;
    startDate?: string;
    endDate?: string;
  },
): { startMs: number; endMs: number; selectedDate: string; selectedTime: string } {
  const selDate = body.selectedDate?.trim() || body.startDate?.trim();
  const today = new Date();
  const todayYmd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const dateStr = selDate || todayYmd;

  const ymd = parseYmd(dateStr);
  if (!ymd) throw new BadRequestException('Invalid date. Use YYYY-MM-DD.');

  const timeRaw = body.selectedTime?.trim() ?? '';
  if (timeRaw) {
    const hm = parseHm(timeRaw);
    if (!hm) throw new BadRequestException('Invalid time. Use HH:MM (24-hour).');
    const startMs = wallClockInZoneToUtcMs(crmTz, ymd.y, ymd.m, ymd.d, hm.hour, hm.minute);
    const endMs = startMs + 3600 * 1000;
    return { startMs, endMs, selectedDate: dateStr, selectedTime: timeRaw };
  }

  const endStr = body.endDate?.trim();
  if (endStr && endStr !== dateStr) {
    const endYmd = parseYmd(endStr);
    if (!endYmd) throw new BadRequestException('Invalid end date.');
    const startMs = wallClockInZoneToUtcMs(crmTz, ymd.y, ymd.m, ymd.d, 0, 0);
    const endMs = wallClockInZoneToUtcMs(crmTz, endYmd.y, endYmd.m, endYmd.d, 23, 59) + 60 * 1000 - 1;
    return { startMs, endMs, selectedDate: dateStr, selectedTime: '' };
  }

  const startMs = wallClockInZoneToUtcMs(crmTz, ymd.y, ymd.m, ymd.d, 0, 0);
  const endMs = startMs + 86400000 - 1;
  return { startMs, endMs, selectedDate: dateStr, selectedTime: '' };
}

function rowToDto(row: Record<string, unknown>): TenantBookingSettingsDto {
  const coreRaw = row['core_fields_json'];
  let coreFieldsJson: TenantCoreFieldsDto;
  try {
    coreFieldsJson = coreRaw === undefined || coreRaw === null ? defaultCoreFields() : parseCoreFieldsJson(coreRaw as unknown);
  } catch {
    coreFieldsJson = defaultCoreFields();
  }
  const merged = defaultCoreFields();
  for (const k of BOOKING_CORE_FIELD_KEYS) {
    merged[k] = coreFieldsJson[k] ?? { enabled: false, required: false };
  }

  const custRaw = row['custom_fields_json'];
  let customFieldsJson: CustomBookingFieldDto[] = [];
  try {
    customFieldsJson =
      custRaw === undefined || custRaw === null ? [] : parseCustomFieldsJson(custRaw as unknown);
  } catch {
    customFieldsJson = [];
  }

  const cap = Number(row['max_bookings_per_slot'] ?? 1);
  const maxBookingsPerSlot = Number.isFinite(cap) && cap >= 1 ? Math.floor(cap) : 1;

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
    coreFieldsJson: merged,
    customFieldsJson,
    maxBookingsPerSlot,
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
      coreFieldsJson: unknown;
      customFieldsJson: unknown;
      maxBookingsPerSlot: unknown;
    }>,
  ): Promise<TenantBookingSettingsDto> {
    const current = await this.getBookingSettings(tenantId);

    let bookingMode = current.bookingMode;
    if (patch.bookingMode !== undefined) {
      bookingMode = parseBookingMode(patch.bookingMode);
    }

    let coreFieldsJson = current.coreFieldsJson;
    if (patch.coreFieldsJson !== undefined) {
      coreFieldsJson = parseCoreFieldsJson(patch.coreFieldsJson);
    }

    let customFieldsJson = current.customFieldsJson;
    if (patch.customFieldsJson !== undefined) {
      customFieldsJson = parseCustomFieldsJson(patch.customFieldsJson);
    }

    let maxBookingsPerSlot = current.maxBookingsPerSlot;
    if (patch.maxBookingsPerSlot !== undefined) {
      const n = Number(patch.maxBookingsPerSlot);
      if (!Number.isFinite(n) || n < 1) throw new BadRequestException('maxBookingsPerSlot must be >= 1');
      maxBookingsPerSlot = Math.floor(n);
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
      core_fields_json: coreFieldsJson,
      custom_fields_json: customFieldsJson,
      max_bookings_per_slot: maxBookingsPerSlot,
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
    const { client, ghlLocationId } = await this.ghlService.createGhlClientForConnectedTenantOrThrow(tenantId, profileId);

    this.logger.log(
      `ghlCalendarListRequest ${JSON.stringify({
        path: '/calendars/',
        locationId: ghlLocationId,
        apiVersion: GHL_CALENDARS_LIST_API_VERSION,
        tenantId,
        hasToken: true,
      })}`,
    );

    const r = await client.listCalendars();
    const syncedAt = new Date().toISOString();
    if (r.error) {
      this.logger.warn(
        `ghlCalendarListFailed ${JSON.stringify({
          status: r.httpStatus ?? null,
          responseBody: r.responseBodyExcerpt ?? null,
          path: r.requestPath ?? '/calendars/',
          locationId: ghlLocationId,
          tenantId,
          message: r.error,
        })}`,
      );
    }
    return { calendars: r.calendars, syncedAt, error: r.error };
  }

  private async loadTenantCrmTimezone(tenantId: string): Promise<string | null> {
    const { data, error } = await this.supabase.from('tenants').select('settings').eq('id', tenantId).maybeSingle();
    if (error || !data?.settings || typeof data.settings !== 'object' || data.settings === null) return null;
    const r = data.settings as Record<string, unknown>;
    for (const key of ['timeZone', 'timezone', 'crmTimezone', 'businessTimezone']) {
      const v = r[key];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return null;
  }

  async testCalendar(
    tenantId: string,
    profileId: string,
    body?: { calendarId?: string },
  ): Promise<{
    ok: boolean;
    calendarId: string | null;
    message: string;
    calendars?: GhlCalendarSummary[];
    calendarDetail?: GhlCalendarDetailSummary;
    scheduleDiagnostics?: BookingScheduleDiagnosticsDto;
  }> {
    const settings = await this.getBookingSettings(tenantId);
    const calendarId = body?.calendarId?.trim() || settings.defaultGhlCalendarId?.trim() || null;
    if (!calendarId) {
      return { ok: false, calendarId: null, message: 'Choose a default calendar first.' };
    }

    const { client, ghlLocationId } = await this.ghlService.createGhlClientForConnectedTenantOrThrow(tenantId, profileId);
    const listed = await client.listCalendars();
    if (listed.error) {
      this.logger.warn(
        `ghlCalendarListFailed ${JSON.stringify({
          status: listed.httpStatus ?? null,
          responseBody: listed.responseBodyExcerpt ?? null,
          path: listed.requestPath ?? '/calendars/',
          locationId: ghlLocationId,
          tenantId,
          message: listed.error,
        })}`,
      );
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

    const detail = await client.getCalendar(calendarId);
    if (detail.error) {
      this.logger.warn(
        `calendarDetailFetchFailed ${JSON.stringify({
          tenantId,
          calendarId,
          status: detail.httpStatus ?? null,
          excerpt: detail.responseBodyExcerpt ?? null,
          message: detail.error,
        })}`,
      );
    }
    const detailLine = detail.summary ? formatGhlCalendarDetailSummary(detail.summary) : '';

    const scheduleDiagnostics = await computeBookingScheduleDiagnostics(
      client,
      calendarId,
      ghlLocationId,
      detail.summary,
    );
    this.logger.log(
      `bookingCalendarScheduleDiagnostic ${JSON.stringify({
        tenantId,
        calendarId,
        locationId: ghlLocationId,
        teamMembersCount: scheduleDiagnostics.teamMembersCount,
        openHoursCount: scheduleDiagnostics.openHoursCount,
        eventCalendarScheduleFound: scheduleDiagnostics.eventCalendarScheduleFound,
        userScheduleFound: scheduleDiagnostics.userScheduleFound,
        scheduleRulesCount: scheduleDiagnostics.scheduleRulesCount,
        scheduleTimezone: scheduleDiagnostics.scheduleTimezone,
        warningCodes: scheduleDiagnostics.warningCodes,
      })}`,
    );

    return {
      ok: true,
      calendarId,
      message: detailLine ? `Calendar is reachable. ${detailLine}` : 'Calendar is reachable.',
      calendars: listed.calendars,
      calendarDetail: detail.summary,
      scheduleDiagnostics,
    };
  }

  async testSlots(
    tenantId: string,
    profileId: string,
    body: {
      selectedDate?: string;
      selectedTime?: string;
      startDate?: string;
      endDate?: string;
      timezone?: string;
      calendarId?: string;
    },
  ): Promise<{
    slots: GhlFreeSlot[];
    calendarId: string | null;
    error?: string;
    emptyWithoutError?: boolean;
    retriedWithUserId?: string | null;
    scheduleDiagnostics?: BookingScheduleDiagnosticsDto;
  }> {
    const settings = await this.getBookingSettings(tenantId);
    const calendarId = body.calendarId?.trim() || settings.defaultGhlCalendarId?.trim() || null;
    if (!calendarId) {
      throw new BadRequestException('Choose a default calendar first.');
    }

    const tenantTz = await this.loadTenantCrmTimezone(tenantId);
    let crmTimezoneUsed = body.timezone?.trim() || tenantTz || resolveAppTimeZone();

    let range: { startMs: number; endMs: number; selectedDate: string; selectedTime: string };
    try {
      range = computeFreeSlotRangeMs(crmTimezoneUsed, body);
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      this.logger.warn(`bookingTestSlots: invalid or unsupported CRM timezone "${crmTimezoneUsed}", using ${resolveAppTimeZone()}`);
      crmTimezoneUsed = resolveAppTimeZone();
      range = computeFreeSlotRangeMs(crmTimezoneUsed, body);
    }

    let startMs = range.startMs;
    let endMs = range.endMs;
    if (endMs <= startMs) {
      endMs = startMs + 3600 * 1000;
    }

    const { client, ghlLocationId } = await this.ghlService.createGhlClientForConnectedTenantOrThrow(tenantId, profileId);

    this.logger.log(
      `bookingTestSlotsRequest ${JSON.stringify({
        tenantId,
        calendarId,
        selectedDate: range.selectedDate,
        selectedTime: range.selectedTime || null,
        generatedStartIso: new Date(startMs).toISOString(),
        generatedEndIso: new Date(endMs).toISOString(),
        crmTimezoneUsed,
        requestShapeSentToGhl: 'GET /calendars/:calendarId/free-slots?startDate=<ms>&endDate=<ms>&timezone=<iana>',
        ghlLocationId,
      })}`,
    );

    let r = await client.getFreeSlots({
      calendarId,
      startDateMs: startMs,
      endDateMs: endMs,
      timezone: crmTimezoneUsed,
    });

    let retriedWithUserId: string | null = null;

    if (!r.error && r.slots.length === 0) {
      const calD = await client.getCalendar(calendarId);
      const userIds = calD.summary?.teamMemberUserIds;
      if (userIds && userIds.length > 0) {
        const uid = userIds[0]!;
        const r2 = await client.getFreeSlots({
          calendarId,
          startDateMs: startMs,
          endDateMs: endMs,
          timezone: crmTimezoneUsed,
          userId: uid,
        });
        retriedWithUserId = uid;
        this.logger.log(
          `bookingTestSlotsRetryWithUser ${JSON.stringify({
            calendarId,
            userId: uid,
            userIdsCount: userIds.length,
            slotsReturned: r2.slots.length,
            httpStatus: r2.httpStatus ?? null,
            shapeSummary: r2.shapeSummary,
          })}`,
        );
        if (r2.error) {
          this.logger.warn(`bookingTestSlots retry free-slots error: ${r2.error}`);
        } else if (r2.slots.length > 0) {
          r = r2;
        }
      }
    }

    this.logger.log(
      `bookingTestSlotsResult ${JSON.stringify({
        tenantId,
        calendarId,
        generatedStartIso: new Date(startMs).toISOString(),
        generatedEndIso: new Date(endMs).toISOString(),
        crmTimezoneUsed,
        httpStatus: r.httpStatus ?? null,
        rawResponseShape: r.shapeSummary,
        dateKeysReturned: r.dateKeys,
        slotsReturned: r.slots.length,
        hasSlots: r.slots.length > 0,
        retriedWithUserId,
        ghlLocationId,
      })}`,
    );

    if (r.error) {
      this.logger.warn(
        `bookingTestSlotsFailed ${JSON.stringify({
          tenantId,
          calendarId,
          status: r.httpStatus ?? null,
          responseBodyExcerpt: r.responseBodyExcerpt ?? null,
          requestShapeSentToGhl: {
            path: r.requestPath ?? null,
            query: r.requestQuery ?? null,
          },
          message: r.error,
        })}`,
      );
    }

    let scheduleDiagnostics: BookingScheduleDiagnosticsDto | undefined;
    if (!r.error && r.slots.length === 0) {
      const calSnap = await client.getCalendar(calendarId);
      const extraCodes = retriedWithUserId ? [SCHED_WARN_FREE_SLOTS_EMPTY_RETRY] : [];
      const extraWarnings = retriedWithUserId
        ? ['CRM returned no bookable slots even after staff-specific retry.']
        : [];
      scheduleDiagnostics = await computeBookingScheduleDiagnostics(
        client,
        calendarId,
        ghlLocationId,
        calSnap.summary,
        { extraWarnings, extraCodes },
      );
      this.logger.log(
        `bookingCalendarScheduleDiagnostic ${JSON.stringify({
          tenantId,
          calendarId,
          locationId: ghlLocationId,
          teamMembersCount: scheduleDiagnostics.teamMembersCount,
          openHoursCount: scheduleDiagnostics.openHoursCount,
          eventCalendarScheduleFound: scheduleDiagnostics.eventCalendarScheduleFound,
          userScheduleFound: scheduleDiagnostics.userScheduleFound,
          scheduleRulesCount: scheduleDiagnostics.scheduleRulesCount,
          scheduleTimezone: scheduleDiagnostics.scheduleTimezone,
          warningCodes: scheduleDiagnostics.warningCodes,
        })}`,
      );
    }

    return {
      slots: r.slots,
      calendarId,
      error: r.error,
      emptyWithoutError: !r.error && r.slots.length === 0,
      retriedWithUserId,
      scheduleDiagnostics,
    };
  }
}
