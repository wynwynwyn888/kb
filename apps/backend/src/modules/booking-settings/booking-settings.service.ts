import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { getSupabaseService } from '../../lib/supabase';
import { resolveAppTimeZone, getBusinessLocalNow, snapUtcEpochMsToWholeMinute, snapUtcEpochMsToWholeSecond, wallClockInZoneToUtcMs } from '../../lib/business-time';
import { GhlService } from '../ghl/ghl.service';
import {
  GHL_CALENDARS_LIST_API_VERSION,
  GHL_FREE_SLOTS_PROBE_API_VERSIONS,
  formatGhlCalendarDetailSummary,
  resolveGhlFreeSlotsProductionSpec,
  type GhlCalendarDetailSummary,
  type GhlCalendarSummary,
  type GhlFreeSlot,
  type GhlFreeSlotsTimestampUnit,
  type GhlFreeSlotsUserParamMode,
  type GhlFreeSlotsProbeHostMode,
  type GhlFreeSlotsProbeRangeMode,
} from '@aisbp/ghl-client';
import {
  computeBookingRulesDiagnostics,
  type BookingRulesDiagnosticsDto,
} from './booking-rules-diagnostics';
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
  /** Optional menu labels for core `service` intake (A/B/C style prompts + strict matching when set). */
  serviceMenuOptions?: string[];
  maxBookingsPerSlot: number;
  internalBookingAlertEnabled: boolean;
  internalBookingAlertNumber: string | null;
  internalBookingAlertChannel: string;
  internalBookingAlertTemplate: string | null;
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
  internalBookingAlertEnabled: false,
  internalBookingAlertNumber: null,
  internalBookingAlertChannel: 'GHL_MESSAGE',
  internalBookingAlertTemplate: null,
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

function normalizeInternalAlertNumber(raw: string | null | undefined): string | null {
  if (raw === undefined || raw === null) return null;
  const t = String(raw).trim().replace(/\s+/g, '');
  return t.length ? t : null;
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
  const todayYmd = getBusinessLocalNow(crmTz).localIso.slice(0, 10);
  const dateStr = selDate || todayYmd;

  const ymd = parseYmd(dateStr);
  if (!ymd) throw new BadRequestException('Invalid date. Use YYYY-MM-DD.');

  const timeRaw = body.selectedTime?.trim() ?? '';
  if (timeRaw) {
    const hm = parseHm(timeRaw);
    if (!hm) throw new BadRequestException('Invalid time. Use HH:MM (24-hour).');
    let startMs = wallClockInZoneToUtcMs(crmTz, ymd.y, ymd.m, ymd.d, hm.hour, hm.minute);
    let endMs = startMs + 3600 * 1000;
    startMs = snapUtcEpochMsToWholeSecond(startMs);
    endMs = snapUtcEpochMsToWholeSecond(endMs);
    startMs = snapUtcEpochMsToWholeMinute(startMs);
    return { startMs, endMs, selectedDate: dateStr, selectedTime: timeRaw };
  }

  const endStr = body.endDate?.trim();
  if (endStr && endStr !== dateStr) {
    const endYmd = parseYmd(endStr);
    if (!endYmd) throw new BadRequestException('Invalid end date.');
    let startMs = wallClockInZoneToUtcMs(crmTz, ymd.y, ymd.m, ymd.d, 0, 0);
    let endMs = wallClockInZoneToUtcMs(crmTz, endYmd.y, endYmd.m, endYmd.d, 23, 59) + 60 * 1000 - 1;
    startMs = snapUtcEpochMsToWholeSecond(startMs);
    endMs = snapUtcEpochMsToWholeSecond(endMs);
    startMs = snapUtcEpochMsToWholeMinute(startMs);
    return { startMs, endMs, selectedDate: dateStr, selectedTime: '' };
  }

  let startMs = wallClockInZoneToUtcMs(crmTz, ymd.y, ymd.m, ymd.d, 0, 0);
  let endMs = startMs + 86400000 - 1;
  startMs = snapUtcEpochMsToWholeSecond(startMs);
  endMs = snapUtcEpochMsToWholeSecond(endMs);
  startMs = snapUtcEpochMsToWholeMinute(startMs);
  return { startMs, endMs, selectedDate: dateStr, selectedTime: '' };
}

function probeRangeFullLocalDay(
  crmTz: string,
  dateStr: string,
): { startMs: number; endMs: number } {
  const ymd = parseYmd(dateStr.trim());
  if (!ymd) throw new BadRequestException('Invalid date. Use YYYY-MM-DD.');
  let startMs = wallClockInZoneToUtcMs(crmTz, ymd.y, ymd.m, ymd.d, 0, 0);
  let endMs = startMs + 86400000 - 1;
  startMs = snapUtcEpochMsToWholeSecond(startMs);
  endMs = snapUtcEpochMsToWholeSecond(endMs);
  startMs = snapUtcEpochMsToWholeMinute(startMs);
  return { startMs, endMs };
}

/** selected local instant through end of that local calendar day */
function probeRangeSelectedThroughDayEnd(
  crmTz: string,
  dateStr: string,
  timeRaw: string,
): { startMs: number; endMs: number } {
  const ymd = parseYmd(dateStr.trim());
  if (!ymd) throw new BadRequestException('Invalid date. Use YYYY-MM-DD.');
  const t = timeRaw.trim();
  let hour = 0;
  let minute = 0;
  if (t) {
    const hm = parseHm(t);
    if (!hm) throw new BadRequestException('Invalid time. Use HH:MM (24-hour).');
    hour = hm.hour;
    minute = hm.minute;
  }
  let startMs = wallClockInZoneToUtcMs(crmTz, ymd.y, ymd.m, ymd.d, hour, minute);
  const dayStart = wallClockInZoneToUtcMs(crmTz, ymd.y, ymd.m, ymd.d, 0, 0);
  let endMs = dayStart + 86400000 - 1;
  startMs = snapUtcEpochMsToWholeSecond(startMs);
  endMs = snapUtcEpochMsToWholeSecond(endMs);
  startMs = snapUtcEpochMsToWholeMinute(startMs);
  return { startMs, endMs };
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

  let serviceMenuOptions: string[] | undefined;
  const smRaw = row['service_menu_options'];
  if (Array.isArray(smRaw)) {
    serviceMenuOptions = smRaw
      .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      .map(x => String(x).trim());
    if (!serviceMenuOptions.length) serviceMenuOptions = undefined;
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
    coreFieldsJson: merged,
    customFieldsJson,
    serviceMenuOptions,
    maxBookingsPerSlot,
    internalBookingAlertEnabled: Boolean(row['internal_booking_alert_enabled']),
    internalBookingAlertNumber:
      row['internal_booking_alert_number'] === null || row['internal_booking_alert_number'] === undefined
        ? null
        : String(row['internal_booking_alert_number']).trim() || null,
    internalBookingAlertChannel: String(row['internal_booking_alert_channel'] ?? 'GHL_MESSAGE').trim() || 'GHL_MESSAGE',
    internalBookingAlertTemplate:
      row['internal_booking_alert_template'] === null || row['internal_booking_alert_template'] === undefined
        ? null
        : String(row['internal_booking_alert_template']).trim() || null,
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
    if (!data) return this.normalizeLiveBookingCoreFields({ ...DEFAULT_SETTINGS });
    return this.normalizeLiveBookingCoreFields(rowToDto(data as Record<string, unknown>));
  }

  /**
   * Live assistant defaults + invalid-toggle repair:
   * - If live booking is on and no core field is enabled, default service/date/time/name/phone as required asks.
   * - If Required=true but Ask (enabled)=false, enable ask and log (required cannot be collected when hidden).
   */
  private normalizeLiveBookingCoreFields(dto: TenantBookingSettingsDto): TenantBookingSettingsDto {
    const core: TenantCoreFieldsDto = { ...dto.coreFieldsJson };
    const live =
      dto.enabled && (dto.bookingMode === 'CHECK_AVAILABILITY' || dto.bookingMode === 'BOOK_AFTER_CONFIRMATION');
    const noneAsked = BOOKING_CORE_FIELD_KEYS.every(k => !core[k]?.enabled);
    if (live && noneAsked) {
      this.logger.warn(
        'tenant booking: live assistant enabled but no core fields asked — defaulting to service, preferred date/time, name, phone as required',
      );
      for (const k of ['service', 'preferred_date', 'preferred_time', 'name', 'phone'] as const) {
        core[k] = { enabled: true, required: true };
      }
      core['email'] = { enabled: false, required: false };
      core['first_visit'] = { enabled: false, required: false };
    }
    for (const k of BOOKING_CORE_FIELD_KEYS) {
      const t = core[k];
      if (t?.required && !t?.enabled) {
        this.logger.warn(`tenant booking: core field "${k}" is required but not asked — enabling ask`);
        core[k] = { enabled: true, required: true };
      }
    }
    return { ...dto, coreFieldsJson: core };
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
      internalBookingAlertEnabled: boolean;
      internalBookingAlertNumber: string | null;
      internalBookingAlertChannel: string;
      internalBookingAlertTemplate: string | null;
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

    let internalBookingAlertEnabled =
      patch.internalBookingAlertEnabled !== undefined
        ? Boolean(patch.internalBookingAlertEnabled)
        : current.internalBookingAlertEnabled;
    let internalBookingAlertNumber =
      patch.internalBookingAlertNumber !== undefined
        ? normalizeInternalAlertNumber(patch.internalBookingAlertNumber)
        : current.internalBookingAlertNumber;
    let internalBookingAlertChannel =
      patch.internalBookingAlertChannel !== undefined
        ? String(patch.internalBookingAlertChannel).trim() || 'GHL_MESSAGE'
        : current.internalBookingAlertChannel;
    let internalBookingAlertTemplate =
      patch.internalBookingAlertTemplate !== undefined
        ? patch.internalBookingAlertTemplate === null
          ? null
          : String(patch.internalBookingAlertTemplate).trim() || null
        : current.internalBookingAlertTemplate;

    if (internalBookingAlertEnabled && !internalBookingAlertNumber?.trim()) {
      throw new BadRequestException('Team notification number is required when internal booking alert is enabled');
    }

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
      internal_booking_alert_enabled: internalBookingAlertEnabled,
      internal_booking_alert_number: internalBookingAlertNumber,
      internal_booking_alert_channel: internalBookingAlertChannel,
      internal_booking_alert_template: internalBookingAlertTemplate,
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
    return this.resolveTenantCrmTimezone(tenantId);
  }

  /** CRM IANA timezone from tenant settings (single source for booking date math). */
  async resolveTenantCrmTimezone(tenantId: string): Promise<string | null> {
    const { data, error } = await this.supabase.from('tenants').select('settings').eq('id', tenantId).maybeSingle();
    if (error || !data?.settings || typeof data.settings !== 'object' || data.settings === null) return null;
    const r = data.settings as Record<string, unknown>;
    for (const key of ['timeZone', 'timezone', 'crmTimezone', 'businessTimezone']) {
      const v = r[key];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return null;
  }

  /** Slot duration and per-slot capacity from GHL calendar detail (authoritative over tenant defaults). */
  async loadCalendarBookingRules(
    tenantId: string,
    calendarId: string,
  ): Promise<{ slotDurationMinutes: number | null; appointmentsPerSlot: number | null }> {
    const calId = calendarId.trim();
    if (!calId) return { slotDurationMinutes: null, appointmentsPerSlot: null };
    try {
      const { client } = await this.ghlService.createGhlClientForConnectedTenantWorkerOrThrow(tenantId);
      const calSnap = await client.getCalendar(calId);
      const slotDurationMinutes =
        typeof calSnap.summary?.slotDuration === 'number' && Number.isFinite(calSnap.summary.slotDuration)
          ? Math.floor(calSnap.summary.slotDuration)
          : null;
      const appointmentsPerSlot =
        typeof calSnap.summary?.appointmentsPerSlot === 'number' &&
        Number.isFinite(calSnap.summary.appointmentsPerSlot)
          ? Math.floor(calSnap.summary.appointmentsPerSlot)
          : null;
      return { slotDurationMinutes, appointmentsPerSlot };
    } catch {
      return { slotDurationMinutes: null, appointmentsPerSlot: null };
    }
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
    bookingRulesDiagnostics?: BookingRulesDiagnosticsDto;
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

    const bookingRulesDiagnostics = computeBookingRulesDiagnostics(detail.summary, undefined);
    this.logger.log(
      `bookingCalendarRulesDiagnostic ${JSON.stringify({
        tenantId,
        calendarId,
        calendarType: detail.summary?.calendarType ?? detail.summary?.typeRaw ?? null,
        slotDuration: bookingRulesDiagnostics.slotDuration,
        slotInterval: bookingRulesDiagnostics.slotInterval,
        appointmentPerSlot: bookingRulesDiagnostics.appointmentsPerSlot,
        bufferSummary: bookingRulesDiagnostics.bufferSummary,
        minNoticeSummary: bookingRulesDiagnostics.minNoticeSummary,
        bookingWindowSummary: bookingRulesDiagnostics.bookingWindowSummary,
        meetingLocationPresent: bookingRulesDiagnostics.meetingLocationPresent,
        conflictCheckSummary: bookingRulesDiagnostics.conflictCheckSummary,
        warningCodes: bookingRulesDiagnostics.warningCodes,
      })}`,
    );

    return {
      ok: true,
      calendarId,
      message: detailLine ? `Calendar is reachable. ${detailLine}` : 'Calendar is reachable.',
      calendars: listed.calendars,
      calendarDetail: detail.summary,
      scheduleDiagnostics,
      bookingRulesDiagnostics,
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
    bookingRulesDiagnostics?: BookingRulesDiagnosticsDto;
    slotsSourceMessage?: string;
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

    this.logger.log(`selectedFreeSlotsVariant ${JSON.stringify(resolveGhlFreeSlotsProductionSpec())}`);

    const freeSlotsProd = resolveGhlFreeSlotsProductionSpec();

    this.logger.log(
      `bookingTestSlotsRequest ${JSON.stringify({
        tenantId,
        calendarId,
        selectedDate: range.selectedDate,
        selectedTime: range.selectedTime || null,
        generatedStartIso: new Date(startMs).toISOString(),
        generatedEndIso: new Date(endMs).toISOString(),
        crmTimezoneUsed,
        requestShapeSentToGhl: 'GET /calendars/:calendarId/free-slots (shape from resolveGhlFreeSlotsProductionSpec / env)',
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
    let calWhenEmpty: { summary?: GhlCalendarDetailSummary } | undefined;

    if (freeSlotsProd.hostMode !== 'widget_backend' && !r.error && r.slots.length === 0) {
      calWhenEmpty = await client.getCalendar(calendarId);
      const userIds = calWhenEmpty.summary?.teamMemberUserIds;
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
        this.logger.debug(
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
        rawResponseShape: r.rawResponseShape ?? null,
        parsedShapeSummary: r.shapeSummary,
        rawIsoStringCount: r.rawIsoStringCount ?? null,
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
    let bookingRulesDiagnostics: BookingRulesDiagnosticsDto | undefined;
    if (!r.error && r.slots.length === 0) {
      const calSnap = calWhenEmpty ?? (await client.getCalendar(calendarId));
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
      bookingRulesDiagnostics = computeBookingRulesDiagnostics(calSnap.summary, {
        selectedDate: range.selectedDate,
        selectedTime: range.selectedTime,
        rangeStartMs: startMs,
        zeroSlots: true,
      });
      this.logger.log(
        `bookingCalendarZeroSlotsDiagnostics ${JSON.stringify({
          tenantId,
          calendarId,
          locationId: ghlLocationId,
          schedule: {
            teamMembersCount: scheduleDiagnostics.teamMembersCount,
            openHoursCount: scheduleDiagnostics.openHoursCount,
            eventCalendarScheduleFound: scheduleDiagnostics.eventCalendarScheduleFound,
            userScheduleFound: scheduleDiagnostics.userScheduleFound,
            scheduleRulesCount: scheduleDiagnostics.scheduleRulesCount,
            scheduleTimezone: scheduleDiagnostics.scheduleTimezone,
            warningCodes: scheduleDiagnostics.warningCodes,
          },
          rules: {
            calendarType: calSnap.summary?.calendarType ?? calSnap.summary?.typeRaw ?? null,
            slotDuration: bookingRulesDiagnostics.slotDuration,
            slotInterval: bookingRulesDiagnostics.slotInterval,
            appointmentPerSlot: bookingRulesDiagnostics.appointmentsPerSlot,
            bufferSummary: bookingRulesDiagnostics.bufferSummary,
            minNoticeSummary: bookingRulesDiagnostics.minNoticeSummary,
            bookingWindowSummary: bookingRulesDiagnostics.bookingWindowSummary,
            meetingLocationPresent: bookingRulesDiagnostics.meetingLocationPresent,
            conflictCheckSummary: bookingRulesDiagnostics.conflictCheckSummary,
            warningCodes: bookingRulesDiagnostics.warningCodes,
          },
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
      bookingRulesDiagnostics,
      slotsSourceMessage: r.availabilityNote,
    };
  }

  /**
   * Inbound automation (WhatsApp booking): same free-slots lookup as test-slots without heavy diagnostics,
   * using worker GHL credentials (no end-user JWT).
   */
  async fetchFreeSlotsForAutomation(
    tenantId: string,
    body: { calendarId: string; selectedDate: string; selectedTime?: string; endDate?: string },
  ): Promise<{
    slots: GhlFreeSlot[];
    calendarId: string;
    error?: string;
    retriedWithUserId?: string | null;
    crmTimezoneUsed: string;
    selectedDate: string;
    selectedTime: string;
    startMs: number;
    endMs: number;
    ghlLocationId: string;
  }> {
    const calendarId = body.calendarId.trim();
    if (!calendarId) {
      throw new BadRequestException('calendarId is required.');
    }

    const tenantTz = await this.loadTenantCrmTimezone(tenantId);
    let crmTimezoneUsed = tenantTz || resolveAppTimeZone();

    let range: { startMs: number; endMs: number; selectedDate: string; selectedTime: string };
    try {
      range = computeFreeSlotRangeMs(crmTimezoneUsed, body);
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      this.logger.warn(
        `fetchFreeSlotsForAutomation: invalid CRM timezone "${crmTimezoneUsed}", using ${resolveAppTimeZone()}`,
      );
      crmTimezoneUsed = resolveAppTimeZone();
      range = computeFreeSlotRangeMs(crmTimezoneUsed, body);
    }

    let startMs = range.startMs;
    let endMs = range.endMs;
    if (endMs <= startMs) {
      endMs = startMs + 3600 * 1000;
    }

    const { client, ghlLocationId } = await this.ghlService.createGhlClientForConnectedTenantWorkerOrThrow(tenantId);

    this.logger.log(`selectedFreeSlotsVariant ${JSON.stringify(resolveGhlFreeSlotsProductionSpec())}`);

    const freeSlotsProd = resolveGhlFreeSlotsProductionSpec();

    this.logger.log(
      `bookingSlotsFetched ${JSON.stringify({
        tenantId,
        calendarId,
        selectedDate: range.selectedDate,
        selectedTime: range.selectedTime || null,
        generatedStartIso: new Date(startMs).toISOString(),
        generatedEndIso: new Date(endMs).toISOString(),
        crmTimezoneUsed,
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

    if (freeSlotsProd.hostMode !== 'widget_backend' && !r.error && r.slots.length === 0) {
      const calWhenEmpty = await client.getCalendar(calendarId);
      const userIds = calWhenEmpty.summary?.teamMemberUserIds;
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
        this.logger.debug(
          `bookingSlotsFetchedRetry ${JSON.stringify({
            calendarId,
            userId: uid,
            slotsReturned: r2.slots.length,
            httpStatus: r2.httpStatus ?? null,
          })}`,
        );
        if (!r2.error && r2.slots.length > 0) {
          r = r2;
        }
      }
    }

    this.logger.log(
      `bookingSlotsFetchedResult ${JSON.stringify({
        tenantId,
        calendarId,
        httpStatus: r.httpStatus ?? null,
        slotsReturned: r.slots.length,
        hasError: Boolean(r.error),
        retriedWithUserId,
      })}`,
    );

    return {
      slots: r.slots,
      calendarId,
      error: r.error,
      retriedWithUserId,
      crmTimezoneUsed,
      selectedDate: range.selectedDate,
      selectedTime: range.selectedTime,
      startMs,
      endMs,
      ghlLocationId,
    };
  }

  async probeFreeSlots(
    tenantId: string,
    profileId: string,
    body: {
      calendarId: string;
      selectedDate: string;
      selectedTime?: string;
      userId?: string;
      timezone?: string;
    },
  ): Promise<{
    crmTimezoneUsed: string;
    teamUserIdProbe: string | null;
    productionSpec: ReturnType<typeof resolveGhlFreeSlotsProductionSpec>;
    variants: Array<{
      variantName: string;
      hostMode: GhlFreeSlotsProbeHostMode;
      rangeMode: GhlFreeSlotsProbeRangeMode;
      sendSeatsPerSlot: boolean;
      version: string;
      timestampUnit: GhlFreeSlotsTimestampUnit | 'ms';
      userParamMode: GhlFreeSlotsUserParamMode;
      timezoneIncluded: boolean;
      requestPath: string;
      startDateValue: string;
      endDateValue: string;
      httpStatus?: number;
      /** Parsed / normalized shape label from `parseGhlFreeSlotsResponse`. */
      responseShape: string;
      /** Coarse HTTP body classification (e.g. `array(len=N)`). */
      rawResponseShape: string;
      rawIsoStringCount: number;
      parsedSlotsReturned: number;
      dateKeysReturned: string[];
      slotsReturned: number;
      firstFewSlots: { startTime: string; endTime: string }[];
      errorExcerpt?: string;
    }>;
    anySlotsReturned: boolean;
    allVariantsZero: boolean;
    message?: string;
  }> {
    const calendarId = body.calendarId?.trim();
    if (!calendarId) {
      throw new BadRequestException('calendarId is required.');
    }
    const selectedDate = body.selectedDate?.trim();
    if (!selectedDate) {
      throw new BadRequestException('selectedDate is required (YYYY-MM-DD).');
    }

    const nodeEnv = (process.env['NODE_ENV'] ?? '').trim();
    const allowProbe = (process.env['ALLOW_BOOKING_PROBE'] ?? '').trim().toLowerCase();
    if (nodeEnv === 'production' && allowProbe !== 'true') {
      throw new ForbiddenException(
        'Booking free-slots probe is disabled in production. Set ALLOW_BOOKING_PROBE=true on the server to enable it.',
      );
    }

    const tenantTz = await this.loadTenantCrmTimezone(tenantId);
    const crmTimezoneUsed = body.timezone?.trim() || tenantTz || resolveAppTimeZone();

    const { client, ghlLocationId } = await this.ghlService.createGhlClientForConnectedTenantOrThrow(tenantId, profileId);

    const calSnap = await client.getCalendar(calendarId);

    let teamUserId = body.userId?.trim() || null;
    if (!teamUserId) {
      const ids = calSnap.summary?.teamMemberUserIds;
      if (ids && ids.length > 0) teamUserId = ids[0]!;
    }

    const slotDurationMinutes =
      typeof calSnap.summary?.slotDuration === 'number' && Number.isFinite(calSnap.summary.slotDuration)
        ? calSnap.summary.slotDuration
        : null;

    const productionSpec = resolveGhlFreeSlotsProductionSpec();

    const mapFirstFew = (slots: GhlFreeSlot[]) =>
      slots.slice(0, 3).map((s) => ({
        startTime: s.startTime.length > 48 ? `${s.startTime.slice(0, 45)}…` : s.startTime,
        endTime:
          s.endTime !== undefined && s.endTime.trim().length > 0
            ? s.endTime.length > 48
              ? `${s.endTime.slice(0, 45)}…`
              : s.endTime
            : '—',
      }));

    const logParserMiss = (variantName: string, exec: { httpStatus?: number; rawIsoStringCount?: number; slots: GhlFreeSlot[]; shapeSummary: string; rawResponseShape?: string }) => {
      if (exec.httpStatus === 200 && (exec.rawIsoStringCount ?? 0) > 0 && exec.slots.length === 0) {
        this.logger.warn(
          `freeSlotsParserMissedIsoStringArray ${JSON.stringify({
            tenantId,
            calendarId,
            variantName,
            rawIsoStringCount: exec.rawIsoStringCount ?? 0,
            rawResponseShape: exec.rawResponseShape ?? null,
            parsedShapeSummary: exec.shapeSummary,
          })}`,
        );
      }
    };

    type ProbeRow = {
      variantName: string;
      hostMode: GhlFreeSlotsProbeHostMode;
      rangeMode: GhlFreeSlotsProbeRangeMode;
      sendSeatsPerSlot: boolean;
      version: string;
      timestampUnit: GhlFreeSlotsTimestampUnit | 'ms';
      userParamMode: GhlFreeSlotsUserParamMode;
      timezoneIncluded: boolean;
      requestPath: string;
      startDateValue: string;
      endDateValue: string;
      httpStatus?: number;
      responseShape: string;
      rawResponseShape: string;
      rawIsoStringCount: number;
      parsedSlotsReturned: number;
      dateKeysReturned: string[];
      slotsReturned: number;
      firstFewSlots: { startTime: string; endTime: string }[];
      errorExcerpt?: string;
    };

    const variants: ProbeRow[] = [];

    const widgetBearerProbe = (process.env['GHL_FREE_SLOTS_WIDGET_PROBE_WITH_BEARER'] ?? 'false').trim().toLowerCase();
    const widgetProbeUsesBearer = widgetBearerProbe === 'true' || widgetBearerProbe === '1';

    const widgetExec = await client.executeWidgetCompatibleMonthRangeProbe({
      calendarId,
      selectedDateYmd: selectedDate,
      crmTimezone: crmTimezoneUsed,
      usePrivateIntegrationBearer: widgetProbeUsesBearer,
      slotDurationMinutes,
    });
    const widgetVariantName = `widgetExact|month|${widgetProbeUsesBearer ? 'bearer' : 'public'}|2021-04-15`;
    logParserMiss(widgetVariantName, {
      httpStatus: widgetExec.httpStatus,
      rawIsoStringCount: widgetExec.rawIsoStringCount,
      slots: widgetExec.slots,
      shapeSummary: widgetExec.shapeSummary,
      rawResponseShape: widgetExec.rawResponseShape,
    });
    const wVersion = widgetExec.versionHeader ?? '2021-04-15';
    variants.push({
      variantName: widgetVariantName,
      hostMode: 'leadconnectorBackendWidget',
      rangeMode: 'month',
      sendSeatsPerSlot: Boolean(widgetExec.sendSeatsPerSlot),
      version: wVersion,
      timestampUnit: 'ms',
      userParamMode: 'none',
      timezoneIncluded: true,
      requestPath: widgetExec.requestPath,
      startDateValue: widgetExec.requestQuery?.['startDate'] ?? '',
      endDateValue: widgetExec.requestQuery?.['endDate'] ?? '',
      httpStatus: widgetExec.httpStatus,
      responseShape: widgetExec.shapeSummary,
      rawResponseShape: widgetExec.rawResponseShape ?? 'unknown',
      rawIsoStringCount: widgetExec.rawIsoStringCount ?? 0,
      parsedSlotsReturned: widgetExec.slots.length,
      dateKeysReturned: widgetExec.dateKeys,
      slotsReturned: widgetExec.slots.length,
      firstFewSlots: mapFirstFew(widgetExec.slots),
      errorExcerpt: widgetExec.error?.slice(0, 220),
    });

    const ranges: { mode: 'fullLocalDay' | 'selectedToDayEnd'; startMs: number; endMs: number }[] = [];
    ranges.push({ mode: 'fullLocalDay', ...probeRangeFullLocalDay(crmTimezoneUsed, selectedDate) });
    ranges.push({
      mode: 'selectedToDayEnd',
      ...probeRangeSelectedThroughDayEnd(crmTimezoneUsed, selectedDate, body.selectedTime ?? ''),
    });

    for (const range of ranges) {
      for (const apiVersion of GHL_FREE_SLOTS_PROBE_API_VERSIONS) {
        for (const timestampUnit of ['ms', 's'] as const) {
          for (const userParamMode of ['none', 'userId', 'userIds'] as const) {
            for (const includeTimezone of [true, false] as const) {
              const variantName = `${apiVersion}|${timestampUnit}|${userParamMode}|${includeTimezone ? 'tz' : 'noTz'}|${
                range.mode
              }`;
              const probeRangeMode: GhlFreeSlotsProbeRangeMode =
                range.mode === 'fullLocalDay' ? 'fullLocalDay' : 'selectedToDayEnd';
              const exec = await client.executeFreeSlotsVariant({
                calendarId,
                startDateMs: range.startMs,
                endDateMs: range.endMs,
                timezone: crmTimezoneUsed,
                teamUserId,
                apiVersion,
                timestampUnit,
                userParamMode,
                includeTimezone,
                variantMeta: { probeRangeMode },
              });
              logParserMiss(variantName, {
                httpStatus: exec.httpStatus,
                rawIsoStringCount: exec.rawIsoStringCount,
                slots: exec.slots,
                shapeSummary: exec.shapeSummary,
                rawResponseShape: exec.rawResponseShape,
              });
              variants.push({
                variantName,
                hostMode: 'servicesApi',
                rangeMode: probeRangeMode,
                sendSeatsPerSlot: false,
                version: apiVersion,
                timestampUnit,
                userParamMode,
                timezoneIncluded: includeTimezone,
                requestPath: exec.requestPath,
                startDateValue: exec.requestQuery?.['startDate'] ?? '',
                endDateValue: exec.requestQuery?.['endDate'] ?? '',
                httpStatus: exec.httpStatus,
                responseShape: exec.shapeSummary,
                rawResponseShape: exec.rawResponseShape ?? 'unknown',
                rawIsoStringCount: exec.rawIsoStringCount ?? 0,
                parsedSlotsReturned: exec.slots.length,
                dateKeysReturned: exec.dateKeys,
                slotsReturned: exec.slots.length,
                firstFewSlots: mapFirstFew(exec.slots),
                errorExcerpt: exec.error?.slice(0, 220),
              });
            }
          }
        }
      }
    }

    const widgetMonthWin = variants.some(
      (v) => v.hostMode === 'leadconnectorBackendWidget' && v.rangeMode === 'month' && v.slotsReturned > 0,
    );
    const anySlotsReturned = variants.some((v) => v.slotsReturned > 0);
    const allVariantsZero = variants.length > 0 && !anySlotsReturned;
    let message: string | undefined;
    if (allVariantsZero) {
      message =
        'All tested free-slots probe variants returned zero slots for this calendar and date range. Adjust GHL availability or booking rules, or align backend env with a variant that returns slots.';
    } else if (widgetMonthWin) {
      message = 'CRM returned slots using widget-compatible month range.';
    }

    this.logger.log(
      `probeFreeSlotsComplete tenant=${tenantId} calendarId=${calendarId} locationId=${ghlLocationId} variantCount=${variants.length} anySlotsReturned=${anySlotsReturned} widgetMonthWin=${widgetMonthWin} hostMode=${productionSpec.hostMode} rangeMode=${productionSpec.rangeMode}`,
    );

    return {
      crmTimezoneUsed,
      teamUserIdProbe: teamUserId,
      productionSpec,
      variants,
      anySlotsReturned,
      allVariantsZero,
      message,
    };
  }
}
