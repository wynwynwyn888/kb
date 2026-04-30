import type { GhlClient, GhlCalendarDetailSummary } from '@aisbp/ghl-client';

export const SCHED_WARN_NO_SCHEDULE = 'NO_AVAILABILITY_SCHEDULE';
export const SCHED_WARN_NO_TEAM = 'NO_TEAM_MEMBER';
export const SCHED_WARN_SCHEDULE_NO_RULES = 'SCHEDULE_NO_RULES';
export const SCHED_WARN_SCHEDULE_MISMATCH = 'SCHEDULE_CALENDAR_MISMATCH';
export const SCHED_WARN_FREE_SLOTS_EMPTY_RETRY = 'FREE_SLOTS_EMPTY_AFTER_RETRY';

export interface BookingScheduleDiagnosticsDto {
  calendarReachable: boolean;
  calendarType?: string | null;
  active?: boolean | null;
  teamMembersCount: number;
  openHoursCount: number;
  eventCalendarScheduleFound: boolean;
  userScheduleFound: boolean;
  scheduleRulesCount: number;
  scheduleTimezone?: string | null;
  scheduleAssociatedCalendarIds: string[];
  selectedCalendarInSchedule: boolean;
  warnings: string[];
  warningCodes: string[];
}

export async function computeBookingScheduleDiagnostics(
  client: GhlClient,
  calendarId: string,
  locationId: string,
  calendarSummary: GhlCalendarDetailSummary | undefined,
  options?: { extraWarnings?: string[]; extraCodes?: string[] },
): Promise<BookingScheduleDiagnosticsDto> {
  const warnings: string[] = [...(options?.extraWarnings ?? [])];
  const warningCodes: string[] = [...(options?.extraCodes ?? [])];

  const pushWarn = (msg: string, code: string) => {
    if (!warningCodes.includes(code)) {
      warnings.push(msg);
      warningCodes.push(code);
    }
  };

  const teamMembersCount = calendarSummary?.teamMemberCount ?? 0;
  const openHoursCount = calendarSummary?.openHoursCount ?? 0;

  let eventCalendarScheduleFound = false;
  let userScheduleFound = false;
  let scheduleRulesCount = 0;
  let scheduleTimezone: string | undefined;
  let scheduleAssociatedCalendarIds: string[] = [];
  let selectedCalendarInSchedule = false;

  const ev = await client.getEventCalendarSchedule(calendarId);
  if (ev.found && ev.diagnostics) {
    eventCalendarScheduleFound = true;
    scheduleRulesCount = Math.max(scheduleRulesCount, ev.diagnostics.rulesCount);
    scheduleTimezone = scheduleTimezone ?? ev.diagnostics.timezone;
    scheduleAssociatedCalendarIds = [
      ...new Set([...scheduleAssociatedCalendarIds, ...ev.diagnostics.associatedCalendarIds]),
    ];
    selectedCalendarInSchedule = true;
  }

  const teamIds = calendarSummary?.teamMemberUserIds ?? [];
  if (teamIds.length > 0) {
    const uid = teamIds[0]!;
    const search = await client.searchAvailabilitySchedules({
      locationId,
      userId: uid,
      calendarId,
      limit: 50,
    });
    if (!search.error && search.schedules.length > 0) {
      userScheduleFound = true;
      for (const row of search.schedules) {
        scheduleRulesCount = Math.max(scheduleRulesCount, row.rulesCount);
        scheduleTimezone = scheduleTimezone ?? row.timezone;
        scheduleAssociatedCalendarIds = [...new Set([...scheduleAssociatedCalendarIds, ...row.associatedCalendarIds])];
      }
      const needsHydrate = search.schedules.length > 0 && search.schedules.every((s) => s.rulesCount === 0);
      const firstId = search.schedules.find((s) => s.scheduleId)?.scheduleId;
      if (needsHydrate && firstId) {
        const full = await client.getAvailabilitySchedule(firstId, locationId);
        if (full.diagnostics) {
          scheduleRulesCount = Math.max(scheduleRulesCount, full.diagnostics.rulesCount);
          scheduleTimezone = scheduleTimezone ?? full.diagnostics.timezone;
          scheduleAssociatedCalendarIds = [
            ...new Set([...scheduleAssociatedCalendarIds, ...full.diagnostics.associatedCalendarIds]),
          ];
        }
      }
      if (!eventCalendarScheduleFound) {
        if (scheduleAssociatedCalendarIds.length === 0) {
          selectedCalendarInSchedule = true;
        } else {
          selectedCalendarInSchedule = scheduleAssociatedCalendarIds.includes(calendarId);
        }
      }
    }
  }

  if (openHoursCount === 0 && !eventCalendarScheduleFound && !userScheduleFound) {
    pushWarn(
      'Calendar is reachable, but no availability schedule was found. Configure or apply a CRM availability schedule.',
      SCHED_WARN_NO_SCHEDULE,
    );
  }
  if (teamMembersCount === 0) {
    pushWarn('No team member is assigned.', SCHED_WARN_NO_TEAM);
  }
  if ((eventCalendarScheduleFound || userScheduleFound) && scheduleRulesCount === 0) {
    pushWarn('Availability schedule exists but has no working-hour rules.', SCHED_WARN_SCHEDULE_NO_RULES);
  }
  if (
    userScheduleFound &&
    !eventCalendarScheduleFound &&
    scheduleAssociatedCalendarIds.length > 0 &&
    !scheduleAssociatedCalendarIds.includes(calendarId)
  ) {
    pushWarn('Schedule exists but is not associated with this calendar.', SCHED_WARN_SCHEDULE_MISMATCH);
  }

  return {
    calendarReachable: true,
    calendarType: calendarSummary?.calendarType ?? null,
    active: calendarSummary?.isActive ?? null,
    teamMembersCount,
    openHoursCount,
    eventCalendarScheduleFound,
    userScheduleFound,
    scheduleRulesCount,
    scheduleTimezone: scheduleTimezone ?? null,
    scheduleAssociatedCalendarIds,
    selectedCalendarInSchedule,
    warnings,
    warningCodes,
  };
}
