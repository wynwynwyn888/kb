'use client';

import type { CSSProperties } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import {
  getApiBaseUrl,
  getTenantBookingSettings,
  isApiHttpError,
  patchTenantBookingSettings,
  syncTenantCalendars,
  probeTenantBookingFreeSlots,
  testTenantBookingCalendar,
  testTenantBookingSlots,
  type CustomBookingField,
  type TenantBookingMode,
  type TenantBookingRulesDiagnostics,
  type TenantBookingScheduleDiagnostics,
  type TenantBookingSettings,
  type TenantFreeSlotsProbeResult,
  type TenantFreeSlotsProbeVariant,
} from '@/lib/api';
import {
  ErrorBanner,
  LoadingBlock,
  SectionCard,
  mvpDangerButtonStyle,
  mvpInputStyle,
  mvpLabelStyle,
  mvpPrimaryButtonStyle,
  mvpSecondaryButtonStyle,
  mvpSelectStyle,
} from '@/components/app/mvp-ui';

const BOOKING_MODE_OPTIONS: { value: TenantBookingMode; label: string; hint: string }[] = [
  {
    value: 'COLLECT_DETAILS_ONLY',
    label: 'Collect details only',
    hint: 'Ask for booking fields only — does not confirm a reservation with the CRM.',
  },
  {
    value: 'CHECK_AVAILABILITY',
    label: 'Check availability',
    hint: 'Surfaces slot suggestions from the connected calendar — still not a confirmed booking.',
  },
  {
    value: 'BOOK_AFTER_CONFIRMATION',
    label: 'Slot confirmation workflow',
    hint: 'Workflow-style selection — confirmation with your CRM/booking system is not implied until that integration is live.',
  },
];

const CORE_FIELDS: { key: string; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'phone', label: 'Phone' },
  { key: 'email', label: 'Email' },
  { key: 'service', label: 'Service' },
  { key: 'preferred_date', label: 'Preferred date' },
  { key: 'preferred_time', label: 'Preferred time' },
  { key: 'first_visit', label: 'First visit' },
];

const CUSTOM_TYPES = ['short_text', 'long_text', 'single_select', 'checkbox'] as const;

const CUSTOM_FIELD_TYPE_LABELS: Record<(typeof CUSTOM_TYPES)[number], string> = {
  short_text: 'Short text',
  long_text: 'Long text',
  single_select: 'Single select',
  checkbox: 'Checkbox',
};

/** Hidden in production unless `NEXT_PUBLIC_SHOW_BOOKING_DIAGNOSTICS=true` (see `apps/frontend/.env.example`). */
const SHOW_BOOKING_DIAGNOSTICS =
  process.env.NODE_ENV !== 'production' ||
  process.env['NEXT_PUBLIC_SHOW_BOOKING_DIAGNOSTICS'] === 'true';

const AVAILABILITY_ZERO_MAIN =
  'No available slots were returned for this calendar and time range.';
/** Secondary guidance — wording depends on whether the availability schedule includes this calendar. */
function availabilityZeroHint(scheduleDiag: TenantBookingScheduleDiagnostics | null): string {
  if (scheduleDiag?.selectedCalendarInSchedule) {
    return 'Calendar schedule is associated correctly, but CRM still returned no bookable slots. Check Booking rules, meeting location, buffers, minimum notice, date range, and external calendar conflicts.';
  }
  return 'CRM returned no bookable slots. Check availability schedules, Booking rules, meeting location, buffers, minimum notice, date range, and external calendar conflicts.';
}
const AVAILABILITY_EXTRA_WHEN_TEST_OK =
  'Calendar is reachable, but no availability was returned. This usually means availability/staff/service settings need checking inside CRM.';

function todayIsoDate(): string {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

/** Narrow slots to those at or after the chosen local date + starting time (extra filter after API). */
function filterSlotsAfterLocalStart(
  slots: { startTime: string; endTime?: string }[],
  dateStr: string,
  timeStr: string,
): { startTime: string; endTime?: string }[] {
  const t = timeStr.trim();
  if (!t) return slots;
  const [hhRaw, mmRaw] = t.split(':');
  const hh = parseInt(hhRaw ?? '', 10);
  if (Number.isNaN(hh)) return slots;
  const mm = mmRaw !== undefined ? parseInt(mmRaw, 10) : 0;
  const minute = Number.isNaN(mm) ? 0 : mm;
  const minMs = new Date(
    `${dateStr}T${String(hh).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`,
  ).getTime();
  if (Number.isNaN(minMs)) return slots;
  return slots.filter(s => {
    const x = new Date(s.startTime).getTime();
    return !Number.isNaN(x) && x >= minMs;
  });
}

function cardStyle(): CSSProperties {
  return {
    border: '1px solid var(--aisbp-border)',
    borderRadius: 10,
    padding: '0.85rem 1rem',
    marginBottom: '0.75rem',
    background: 'var(--aisbp-surface)',
  };
}

function subsectionTitleStyle(): CSSProperties {
  return { fontSize: '0.82rem', fontWeight: 600, marginBottom: '0.35rem' };
}

function statusLineStyle(): CSSProperties {
  return {
    fontSize: '0.78rem',
    color: 'var(--aisbp-muted)',
    marginTop: '0.4rem',
    lineHeight: 1.45,
    marginBottom: 0,
  };
}

function availabilityHintStyle(): CSSProperties {
  return {
    fontSize: '0.72rem',
    color: 'var(--aisbp-muted)',
    marginTop: '0.45rem',
    lineHeight: 1.5,
    marginBottom: 0,
  };
}

function scheduleDiagBoxStyle(): CSSProperties {
  return {
    marginTop: '0.65rem',
    padding: '0.65rem 0.75rem',
    borderRadius: 8,
    border: '1px solid rgba(234, 179, 8, 0.55)',
    background: 'rgba(234, 179, 8, 0.09)',
  };
}

function ScheduleDiagnosticsPanel({
  schedule: d,
  rules,
}: {
  schedule: TenantBookingScheduleDiagnostics;
  rules?: TenantBookingRulesDiagnostics | null;
}) {
  const row = (label: string, value: string | number | boolean) => (
    <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', fontSize: '0.76rem', marginBottom: '0.2rem' }}>
      <span style={{ color: 'var(--aisbp-muted)', minWidth: 140 }}>{label}</span>
      <span style={{ fontWeight: 600, color: 'var(--aisbp-text-secondary)' }}>{String(value)}</span>
    </div>
  );
  const idsPreview =
    d.scheduleAssociatedCalendarIds.length <= 2
      ? d.scheduleAssociatedCalendarIds.join(', ') || '—'
      : `${d.scheduleAssociatedCalendarIds.slice(0, 2).join(', ')} +${d.scheduleAssociatedCalendarIds.length - 2}`;
  const devPayload = { schedule: d, rules: rules ?? null };
  return (
    <div style={scheduleDiagBoxStyle()} role="region" aria-label="Schedule diagnostics">
      <div style={{ fontSize: '0.78rem', fontWeight: 700, marginBottom: '0.45rem', color: '#92400e' }}>
        Schedule diagnostics
      </div>
      {row('Calendar reachable', d.calendarReachable ? 'Yes' : 'No')}
      {row('Calendar type', d.calendarType?.trim() ? d.calendarType : '—')}
      {row(
        'Active',
        d.active === null || d.active === undefined ? '—' : d.active ? 'Yes' : 'No',
      )}
      {row('Team members', d.teamMembersCount)}
      {row('Open hours (calendar object)', d.openHoursCount)}
      {row('Event calendar schedule', d.eventCalendarScheduleFound ? 'Found' : 'Not found')}
      {row('User schedule (search)', d.userScheduleFound ? 'Found' : 'Not found')}
      {row('Rules count', d.scheduleRulesCount)}
      {row('Schedule timezone', d.scheduleTimezone ?? '—')}
      {row('Selected calendar in schedule', d.selectedCalendarInSchedule ? 'Yes' : 'No')}
      {row('Associated calendar ids', idsPreview)}
      {d.warnings.length > 0 ? (
        <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.1rem', fontSize: '0.74rem', color: '#92400e', lineHeight: 1.45 }}>
          {d.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      ) : null}
      <p style={{ ...availabilityHintStyle(), marginTop: '0.55rem', color: '#92400e' }}>
        What to fix in CRM: Open CRM → Calendars → selected calendar → Availability. Create or apply an availability schedule,
        assign staff, and save.
      </p>

      {rules ? (
        <>
          <hr style={{ margin: '0.75rem 0', border: 'none', borderTop: '1px solid rgba(234, 179, 8, 0.35)' }} />
          <div style={{ fontSize: '0.78rem', fontWeight: 700, marginBottom: '0.45rem', color: '#92400e' }}>
            Booking rules diagnostics
          </div>
          {row('Slot duration (min)', rules.slotDuration ?? '—')}
          {row('Slot interval (min)', rules.slotInterval ?? '—')}
          {row('Capacity / appointments per slot', rules.appointmentsPerSlot ?? '—')}
          {row('Buffer', rules.bufferSummary)}
          {row('Minimum notice', rules.minNoticeSummary)}
          {row('Booking window / date range', rules.bookingWindowSummary)}
          {row('Meeting location present', rules.meetingLocationPresent ? 'Yes' : 'No')}
          {row('Meeting location type', rules.meetingLocationType?.trim() ? rules.meetingLocationType : '—')}
          {row('Conflict checking', rules.conflictCheckSummary)}
          {row('Form attached', rules.formAttached ? 'Yes' : 'No')}
          {row('Consent required', rules.consentRequired ? 'Yes' : 'No')}
          {row('Payment required', rules.paymentRequired ? 'Yes' : 'No')}
          {row('Services incomplete hint', rules.servicesIncompleteHint ? 'Yes' : 'No')}
          {rules.warnings.length > 0 ? (
            <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.1rem', fontSize: '0.74rem', color: '#92400e', lineHeight: 1.45 }}>
              {rules.warnings.map((w, i) => (
                <li key={`r-${i}`}>{w}</li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}

      {process.env.NODE_ENV === 'development' ? (
        <details style={{ marginTop: '0.65rem' }}>
          <summary style={{ cursor: 'pointer', fontSize: '0.72rem', color: 'var(--aisbp-muted)', userSelect: 'none' }}>
            Show CRM diagnostic summary
          </summary>
          <pre
            style={{
              marginTop: '0.45rem',
              padding: '0.5rem',
              fontSize: '0.65rem',
              lineHeight: 1.35,
              overflow: 'auto',
              maxHeight: 280,
              background: 'rgba(0,0,0,0.06)',
              borderRadius: 6,
              color: 'var(--aisbp-text-secondary)',
            }}
          >
            {JSON.stringify(devPayload, null, 2)}
          </pre>
        </details>
      ) : null}
    </div>
  );
}

function btn(kind: 'primary' | 'secondary' | 'danger', disabled: boolean): CSSProperties {
  const base =
    kind === 'primary' ? mvpPrimaryButtonStyle : kind === 'danger' ? mvpDangerButtonStyle : mvpSecondaryButtonStyle;
  return {
    ...base,
    opacity: disabled ? 0.58 : 1,
    cursor: disabled ? 'not-allowed' : 'pointer',
    whiteSpace: 'nowrap',
  };
}

function formatHttpErrorDetail(e: unknown): string {
  if (!isApiHttpError(e)) return e instanceof Error ? e.message : 'Request failed';
  const body = e.body;
  if (typeof body === 'object' && body !== null) {
    const o = body as Record<string, unknown>;
    if (Array.isArray(o['message'])) {
      return o['message'].map(String).join('; ');
    }
    if (typeof o['message'] === 'string' && o['message'].trim()) return o['message'];
  }
  return e.message;
}

/** Prefer widget-compatible month row, then more slots, then tighter range rank. */
function pickWinningProbeVariant(
  variants: TenantFreeSlotsProbeVariant[],
): TenantFreeSlotsProbeVariant | null {
  const widgetMonthWinners = variants.filter(
    v => v.hostMode === 'leadconnectorBackendWidget' && v.rangeMode === 'month' && v.slotsReturned > 0,
  );
  if (widgetMonthWinners.length > 0) {
    return widgetMonthWinners.reduce((best, v) => (v.slotsReturned > best.slotsReturned ? v : best));
  }
  const winners = variants.filter(v => v.slotsReturned > 0);
  if (winners.length === 0) return null;
  const rangeRank = (m: string) => {
    if (m === 'month') return 0;
    if (m === 'fullLocalDay') return 1;
    return 2;
  };
  return winners.reduce((best, v) => {
    if (v.slotsReturned > best.slotsReturned) return v;
    if (v.slotsReturned < best.slotsReturned) return best;
    if (rangeRank(v.rangeMode) < rangeRank(best.rangeMode)) return v;
    return best;
  });
}

function formatProbeFirstFewSlots(v: TenantFreeSlotsProbeVariant): string {
  if (!v.firstFewSlots?.length) return '—';
  return v.firstFewSlots
    .map(s => (s.startTime.length > 28 ? `${s.startTime.slice(0, 25)}…` : s.startTime))
    .join(', ');
}

function productionEnvFromWinningVariant(v: TenantFreeSlotsProbeVariant): { key: string; value: string }[] {
  if (v.hostMode === 'leadconnectorBackendWidget' && v.rangeMode === 'month') {
    return [
      { key: 'GHL_FREE_SLOTS_HOST_MODE', value: 'widget_backend' },
      { key: 'GHL_FREE_SLOTS_RANGE_MODE', value: 'month' },
      { key: 'GHL_FREE_SLOTS_SEND_SEATS_PER_SLOT', value: v.sendSeatsPerSlot ? 'true' : 'false' },
      { key: 'GHL_FREE_SLOTS_CHANNEL', value: 'APP' },
      { key: 'GHL_FREE_SLOTS_SOURCE', value: 'WEB_USER' },
      { key: 'GHL_FREE_SLOTS_API_VERSION', value: v.version },
      { key: 'GHL_FREE_SLOTS_TIMESTAMP_UNIT', value: 'ms' },
      { key: 'GHL_FREE_SLOTS_INCLUDE_TIMEZONE', value: 'true' },
      { key: 'GHL_FREE_SLOTS_RETRY_USER_PARAM', value: 'userId' },
      { key: 'GHL_FREE_SLOTS_WIDGET_USE_BEARER', value: 'false' },
    ];
  }
  const retryParam = v.userParamMode === 'userIds' ? 'userIds' : 'userId';
  const rangeEnv =
    v.rangeMode === 'selectedToDayEnd'
      ? 'selected_to_day_end'
      : v.rangeMode === 'month'
        ? 'month'
        : 'day';
  return [
    { key: 'GHL_FREE_SLOTS_HOST_MODE', value: 'services_api' },
    { key: 'GHL_FREE_SLOTS_RANGE_MODE', value: rangeEnv },
    { key: 'GHL_FREE_SLOTS_SEND_SEATS_PER_SLOT', value: 'false' },
    { key: 'GHL_FREE_SLOTS_CHANNEL', value: 'APP' },
    { key: 'GHL_FREE_SLOTS_SOURCE', value: 'WEB_USER' },
    { key: 'GHL_FREE_SLOTS_API_VERSION', value: v.version },
    { key: 'GHL_FREE_SLOTS_TIMESTAMP_UNIT', value: v.timestampUnit },
    { key: 'GHL_FREE_SLOTS_INCLUDE_TIMEZONE', value: v.timezoneIncluded ? 'true' : 'false' },
    { key: 'GHL_FREE_SLOTS_RETRY_USER_PARAM', value: retryParam },
  ];
}

export function AutomationBookingPanel() {
  const params = useParams();
  const tenantId = params['tenantId'] as string;
  const { token } = useAuth();

  const [loadErr, setLoadErr] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [bookingLoading, setBookingLoading] = useState(true);
  const [booking, setBooking] = useState<TenantBookingSettings | null>(null);
  type CalendarOption = { id: string; name: string };
  const [calendars, setCalendars] = useState<CalendarOption[]>([]);
  const [slotDate, setSlotDate] = useState(() => todayIsoDate());
  const [slotTime, setSlotTime] = useState('');

  const [syncStatus, setSyncStatus] = useState('');
  const [testCalendarStatus, setTestCalendarStatus] = useState('');
  const [availabilityMain, setAvailabilityMain] = useState('');
  const [availabilityHint, setAvailabilityHint] = useState('');
  const [availabilityExtra, setAvailabilityExtra] = useState('');
  const [availabilityOk, setAvailabilityOk] = useState(false);
  const [saveSettingsStatus, setSaveSettingsStatus] = useState('');

  const [calendarForTest, setCalendarForTest] = useState('');
  const [testConnectionOk, setTestConnectionOk] = useState(false);
  const [calendarScheduleDiag, setCalendarScheduleDiag] = useState<TenantBookingScheduleDiagnostics | null>(null);
  const [calendarRulesDiag, setCalendarRulesDiag] = useState<TenantBookingRulesDiagnostics | null>(null);
  const [slotsScheduleDiag, setSlotsScheduleDiag] = useState<TenantBookingScheduleDiagnostics | null>(null);
  const [slotsRulesDiag, setSlotsRulesDiag] = useState<TenantBookingRulesDiagnostics | null>(null);
  const [probeResult, setProbeResult] = useState<TenantFreeSlotsProbeResult | null>(null);
  const [probeErr, setProbeErr] = useState('');
  const didInitTestCalendar = useRef(false);

  const loadBooking = useCallback(async () => {
    if (!token || !tenantId) return;
    setBookingLoading(true);
    try {
      const b = await getTenantBookingSettings(token, tenantId);
      setBooking(b);
      setLoadErr('');
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : 'Failed to load booking settings');
    } finally {
      setBookingLoading(false);
    }
  }, [token, tenantId]);

  useEffect(() => {
    void loadBooking();
  }, [loadBooking]);

  useEffect(() => {
    didInitTestCalendar.current = false;
  }, [tenantId]);

  useEffect(() => {
    if (!booking || didInitTestCalendar.current) return;
    setCalendarForTest(booking.defaultGhlCalendarId?.trim() ?? '');
    didInitTestCalendar.current = true;
  }, [booking]);

  const toggleCore = (key: string, field: 'enabled' | 'required', on: boolean) => {
    setBooking(prev => {
      if (!prev) return prev;
      const cur = prev.coreFieldsJson[key] ?? { enabled: false, required: false };
      const next = { ...cur, [field]: on };
      if (field === 'required' && on) next.enabled = true;
      return {
        ...prev,
        coreFieldsJson: { ...prev.coreFieldsJson, [key]: next },
      };
    });
  };

  const saveBookingModule = async () => {
    if (!token || !tenantId || !booking) return;
    setBusy('save-booking');
    setSaveSettingsStatus('');
    try {
      const next = await patchTenantBookingSettings(token, tenantId, {
        enabled: booking.enabled,
        bookingMode: booking.bookingMode,
        defaultGhlCalendarId: booking.defaultGhlCalendarId,
        defaultGhlCalendarName: booking.defaultGhlCalendarName,
        coreFieldsJson: booking.coreFieldsJson,
        customFieldsJson: booking.customFieldsJson,
        maxBookingsPerSlot: booking.maxBookingsPerSlot,
      });
      setBooking(next);
      setCalendarForTest(next.defaultGhlCalendarId?.trim() ?? '');
      setSaveSettingsStatus('Saved.');
    } catch (e) {
      setSaveSettingsStatus(formatHttpErrorDetail(e));
    } finally {
      setBusy(null);
    }
  };

  const onSyncCalendars = async () => {
    if (!token || !tenantId) return;
    setBusy('sync-cal');
    setSyncStatus('');
    try {
      const r = await syncTenantCalendars(token, tenantId);
      setCalendars(r.calendars);
      if (r.error) setSyncStatus(`Could not sync calendars: ${r.error}`);
      else setSyncStatus(`Loaded ${r.calendars.length} calendars from CRM.`);
    } catch (e) {
      setSyncStatus(`Could not sync calendars: ${formatHttpErrorDetail(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const useTestCalendarAsDefault = () => {
    if (!booking) return;
    const id = calendarForTest.trim();
    if (!id) return;
    const hit = calendars.find(c => c.id === id);
    setBooking({
      ...booking,
      defaultGhlCalendarId: id,
      defaultGhlCalendarName: hit?.name ?? null,
    });
  };

  const onTestCal = async () => {
    if (!token || !tenantId || !booking) return;
    if (!calendarForTest.trim()) {
      setTestCalendarStatus('Select a calendar first.');
      setTestConnectionOk(false);
      return;
    }
    setBusy('test-cal');
    setTestCalendarStatus('');
    setCalendarScheduleDiag(null);
    setCalendarRulesDiag(null);
    try {
      const r = await testTenantBookingCalendar(token, tenantId, { calendarId: calendarForTest.trim() });
      setTestConnectionOk(r.ok);
      setTestCalendarStatus(r.ok ? r.message : r.message);
      setCalendarScheduleDiag(r.scheduleDiagnostics ?? null);
      setCalendarRulesDiag(r.bookingRulesDiagnostics ?? null);
      if (r.calendars?.length) setCalendars(r.calendars);
    } catch (e) {
      setTestConnectionOk(false);
      setTestCalendarStatus(formatHttpErrorDetail(e));
      setCalendarScheduleDiag(null);
      setCalendarRulesDiag(null);
    } finally {
      setBusy(null);
    }
  };

  const onTestSlots = async () => {
    if (!token || !tenantId || !booking) return;
    if (!calendarForTest.trim()) {
      setAvailabilityMain('Select a calendar first.');
      setAvailabilityHint('');
      setAvailabilityExtra('');
      setAvailabilityOk(false);
      return;
    }
    const dateStr = (slotDate || todayIsoDate()).trim();
    const path = `/tenants/${tenantId}/booking-settings/test-slots`;
    const payload = {
      selectedDate: dateStr,
      selectedTime: slotTime.trim(),
      calendarId: calendarForTest.trim(),
    };
    if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
      console.debug('[AISBP Booking] check availability', {
        selectedDate: payload.selectedDate,
        selectedTime: payload.selectedTime || '(full day in CRM TZ)',
        calendarId: payload.calendarId,
        endpoint: `${getApiBaseUrl()}${path}`,
        note: 'Backend maps to Unix ms for GHL free-slots; may retry with a staff user id when the CRM returns zero slots.',
      });
    }
    setBusy('test-slots');
    setAvailabilityMain('');
    setAvailabilityHint('');
    setAvailabilityExtra('');
    setAvailabilityOk(false);
    setSlotsScheduleDiag(null);
    setSlotsRulesDiag(null);
    try {
      const r = await testTenantBookingSlots(token, tenantId, payload);
      const rawCount = (r.slots ?? []).length;
      let rows = r.slots ?? [];
      if (slotTime.trim()) {
        rows = filterSlotsAfterLocalStart(rows, dateStr, slotTime);
      }
      const n = rows.length;
      if (r.error) {
        setSlotsScheduleDiag(null);
        setSlotsRulesDiag(null);
        setAvailabilityOk(false);
        setAvailabilityMain(
          `GHL: ${r.error}${n > 0 ? ` — still showing ${n} parsed slot(s).` : ''}`,
        );
        return;
      }
      if (n === 0) {
        const schedDiag = r.scheduleDiagnostics ?? calendarScheduleDiag ?? null;
        setSlotsScheduleDiag(schedDiag);
        setSlotsRulesDiag(r.bookingRulesDiagnostics ?? calendarRulesDiag ?? null);
        setAvailabilityOk(false);
        if (rawCount === 0) {
          setAvailabilityMain(AVAILABILITY_ZERO_MAIN);
          setAvailabilityHint(availabilityZeroHint(schedDiag));
          if (testConnectionOk && r.emptyWithoutError) {
            setAvailabilityExtra(AVAILABILITY_EXTRA_WHEN_TEST_OK);
          }
        } else {
          setAvailabilityMain(
            `No slots matched your starting time after filtering — the CRM returned ${rawCount} slot(s) for this date range. Try clearing the time field or choosing an earlier or later start.`,
          );
          setAvailabilityHint(availabilityZeroHint(schedDiag));
        }
        return;
      }
      setSlotsScheduleDiag(null);
      setSlotsRulesDiag(null);
      setAvailabilityOk(true);
      setAvailabilityMain(`Returned ${n} available slot(s). Not a booking confirmation.`);
      setAvailabilityHint('');
      setAvailabilityExtra('');
    } catch (e) {
      setSlotsScheduleDiag(null);
      setSlotsRulesDiag(null);
      setAvailabilityOk(false);
      setAvailabilityMain(`Could not check availability: ${formatHttpErrorDetail(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const onProbeFreeSlots = async () => {
    if (!token || !tenantId) return;
    if (!calendarForTest.trim()) {
      setProbeErr('Select a calendar first.');
      return;
    }
    setBusy('probe-slots');
    setProbeErr('');
    setProbeResult(null);
    try {
      const r = await probeTenantBookingFreeSlots(token, tenantId, {
        calendarId: calendarForTest.trim(),
        selectedDate: (slotDate || todayIsoDate()).trim(),
        selectedTime: slotTime.trim() || undefined,
      });
      setProbeResult(r);
    } catch (e) {
      setProbeErr(formatHttpErrorDetail(e));
    } finally {
      setBusy(null);
    }
  };

  const addCustomField = () => {
    setBooking(prev => {
      if (!prev) return prev;
      const id = globalThis.crypto?.randomUUID?.() ?? `cf_${Date.now()}`;
      const row: CustomBookingField = {
        id,
        label: 'New question',
        fieldType: 'short_text',
        required: false,
        displayOrder: prev.customFieldsJson.length,
      };
      return { ...prev, customFieldsJson: [...prev.customFieldsJson, row] };
    });
  };

  const updateCustomField = (id: string, patch: Partial<CustomBookingField>) => {
    setBooking(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        customFieldsJson: prev.customFieldsJson.map(f => (f.id === id ? { ...f, ...patch } : f)),
      };
    });
  };

  const removeCustomField = (id: string) => {
    setBooking(prev => {
      if (!prev) return prev;
      return { ...prev, customFieldsJson: prev.customFieldsJson.filter(f => f.id !== id) };
    });
  };

  const calendarOptions = useMemo<CalendarOption[]>(() => calendars, [calendars]);

  const syncCalendarsHint = calendars.length === 0 ? 'Sync calendars from CRM above to load the list.' : null;

  const modeHint = BOOKING_MODE_OPTIONS.find(m => m.value === booking?.bookingMode)?.hint ?? '';
  const dim = busy !== null;
  const noTestCalendar = !calendarForTest.trim();

  const winningProbeVariant = useMemo(
    () => (probeResult?.variants?.length ? pickWinningProbeVariant(probeResult.variants) : null),
    [probeResult],
  );
  const winningEnvLines = useMemo(
    () => (winningProbeVariant ? productionEnvFromWinningVariant(winningProbeVariant) : []),
    [winningProbeVariant],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {loadErr ? <ErrorBanner message={loadErr} /> : null}

      {bookingLoading || !booking ? (
        <SectionCard title="Booking assistant" subtitle="Loading…" accent="muted">
          <LoadingBlock />
        </SectionCard>
      ) : (
        <>
          <SectionCard
            title="Calendar tools"
            subtitle="Use these tools to confirm CRM calendar access before enabling live booking workflows."
            accent="muted"
          >
            <div style={cardStyle()}>
              <div style={subsectionTitleStyle()}>1. Sync calendars from CRM</div>
              <button type="button" disabled={dim} onClick={() => void onSyncCalendars()} style={btn('secondary', dim)}>
                Sync calendars from CRM
              </button>
              {syncStatus ? (
                <p style={statusLineStyle()} role="status">
                  {syncStatus}
                </p>
              ) : null}
            </div>

            <div style={cardStyle()}>
              <div style={subsectionTitleStyle()}>2. Calendar to test</div>
              <label style={{ ...mvpLabelStyle, display: 'block', maxWidth: 480 }}>
                Calendar
                <select
                  value={calendarForTest}
                  onChange={e => setCalendarForTest(e.target.value)}
                  style={{ ...mvpSelectStyle, marginTop: '0.35rem', width: '100%' }}
                >
                  <option value="">— Select —</option>
                  {calendarOptions.map((c: CalendarOption) => (
                    <option key={c.id} value={c.id}>
                      {c.name || c.id}
                    </option>
                  ))}
                </select>
              </label>
              {syncCalendarsHint ? (
                <p style={{ ...statusLineStyle(), marginTop: '0.45rem' }}>{syncCalendarsHint}</p>
              ) : null}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  disabled={dim || noTestCalendar}
                  onClick={useTestCalendarAsDefault}
                  style={btn('secondary', dim || noTestCalendar)}
                >
                  Use selected calendar as default
                </button>
              </div>
              <p style={{ ...statusLineStyle(), marginTop: '0.45rem' }}>
                This selection is used for Test and Check below. Use the button to copy it to Booking settings (save to persist).
              </p>
            </div>

            <div style={cardStyle()}>
              <div style={subsectionTitleStyle()}>3. Test calendar connection</div>
              <button
                type="button"
                disabled={dim || noTestCalendar}
                onClick={() => void onTestCal()}
                style={btn('secondary', dim || noTestCalendar)}
              >
                Test calendar connection
              </button>
              {testCalendarStatus ? (
                <p style={statusLineStyle()} role="status">
                  {testCalendarStatus}
                </p>
              ) : null}
              {calendarScheduleDiag ? (
                <ScheduleDiagnosticsPanel schedule={calendarScheduleDiag} rules={calendarRulesDiag} />
              ) : null}
            </div>

            <div style={cardStyle()}>
              <div style={subsectionTitleStyle()}>4. Check calendar availability</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.65rem', alignItems: 'flex-end' }}>
                <label style={{ ...mvpLabelStyle, margin: 0 }}>
                  Date
                  <input
                    type="date"
                    value={slotDate}
                    onChange={e => setSlotDate(e.target.value)}
                    style={{ ...mvpInputStyle, display: 'block', marginTop: '0.35rem' }}
                  />
                </label>
                <label style={{ ...mvpLabelStyle, margin: 0 }}>
                  Starting time
                  <input
                    type="time"
                    step={300}
                    value={slotTime}
                    onChange={e => setSlotTime(e.target.value)}
                    style={{ ...mvpInputStyle, display: 'block', marginTop: '0.35rem' }}
                  />
                </label>
                <button
                  type="button"
                  disabled={dim || noTestCalendar}
                  onClick={() => void onTestSlots()}
                  style={btn('primary', dim || noTestCalendar)}
                >
                  Check calendar availability
                </button>
              </div>

              {noTestCalendar ? (
                <p style={{ ...statusLineStyle(), marginTop: '0.55rem', fontWeight: 600 }} role="status">
                  Select a calendar first.
                </p>
              ) : (
                <p style={{ ...statusLineStyle(), marginTop: '0.55rem' }}>Uses your CRM calendar timezone.</p>
              )}
              {availabilityMain ? (
                <p
                  style={{
                    ...statusLineStyle(),
                    marginTop: '0.5rem',
                    fontWeight: availabilityOk ? 600 : 500,
                    color: availabilityOk ? 'rgb(22 101 52)' : 'var(--aisbp-text-secondary)',
                  }}
                  role="status"
                >
                  {availabilityMain}
                </p>
              ) : null}
              {availabilityHint ? <p style={availabilityHintStyle()}>{availabilityHint}</p> : null}
              {availabilityExtra ? <p style={availabilityHintStyle()}>{availabilityExtra}</p> : null}
              {slotsScheduleDiag ? (
                <details style={{ marginTop: '0.55rem' }}>
                  <summary
                    style={{
                      cursor: 'pointer',
                      fontSize: '0.78rem',
                      fontWeight: 600,
                      color: 'var(--aisbp-text-secondary)',
                    }}
                  >
                    Troubleshooting details
                  </summary>
                  <div style={{ marginTop: '0.45rem' }}>
                    <ScheduleDiagnosticsPanel schedule={slotsScheduleDiag} rules={slotsRulesDiag} />
                  </div>
                  {slotsRulesDiag?.meetingLocationPresent === false ? (
                    <p style={{ ...availabilityHintStyle(), marginTop: '0.45rem' }}>
                      Meeting location was not found in the CRM API response. If booking links work in GHL, this can
                      usually be ignored.
                    </p>
                  ) : null}
                </details>
              ) : null}

              {SHOW_BOOKING_DIAGNOSTICS ? (
                <details
                  style={{
                    marginTop: '0.65rem',
                    paddingTop: '0.65rem',
                    borderTop: '1px solid var(--aisbp-border)',
                  }}
                >
                  <summary
                    style={{
                      cursor: 'pointer',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      color: 'var(--aisbp-text-secondary)',
                      marginBottom: '0.35rem',
                    }}
                  >
                    Advanced diagnostics (API probe)
                  </summary>
                  <div>
                    <p style={{ ...statusLineStyle(), marginTop: 0, marginBottom: '0.45rem' }}>
                      Tries multiple GHL <code style={{ fontSize: '0.75rem' }}>free-slots</code> request shapes
                      (version, timestamp unit, user query param, timezone). Uses the calendar and date/time above.
                    </p>
                    <button
                      type="button"
                      disabled={dim || noTestCalendar}
                      onClick={() => void onProbeFreeSlots()}
                      style={btn('secondary', dim || noTestCalendar)}
                    >
                      {busy === 'probe-slots' ? 'Probing…' : 'Run API probe'}
                    </button>
                    {probeErr ? (
                      <p style={{ ...statusLineStyle(), marginTop: '0.45rem', color: '#b45309' }} role="alert">
                        {probeErr}
                      </p>
                    ) : null}
                    {probeResult?.message ? (
                      <p style={{ ...availabilityHintStyle(), marginTop: '0.5rem', color: '#92400e', fontWeight: 600 }}>
                        {probeResult.message}
                      </p>
                    ) : null}
                    {winningProbeVariant ? (
                      <div
                        style={{
                          marginTop: '0.55rem',
                          padding: '0.6rem 0.7rem',
                          borderRadius: 8,
                          border: '1px solid rgba(34, 197, 94, 0.45)',
                          background: 'rgba(34, 197, 94, 0.1)',
                        }}
                        role="status"
                      >
                        <p
                          style={{
                            margin: 0,
                            fontSize: '0.8rem',
                            fontWeight: 700,
                            color: 'rgb(22 101 52)',
                          }}
                        >
                          Suggested backend env (strongest probe row)
                        </p>
                        <p style={{ ...statusLineStyle(), marginTop: '0.35rem', marginBottom: '0.4rem' }}>
                          Default production is <code style={{ fontSize: '0.7rem' }}>services_api</code> +{' '}
                          <code style={{ fontSize: '0.7rem' }}>day</code>. This row had {winningProbeVariant.slotsReturned}{' '}
                          slot{winningProbeVariant.slotsReturned === 1 ? '' : 's'} ({winningProbeVariant.hostMode},{' '}
                          {winningProbeVariant.rangeMode}, {winningProbeVariant.variantName}).
                        </p>
                        {winningProbeVariant.hostMode === 'servicesApi' &&
                        winningProbeVariant.userParamMode === 'none' ? (
                          <p
                            style={{ ...availabilityHintStyle(), marginTop: 0, marginBottom: '0.45rem', color: '#166534' }}
                          >
                            That probe row did not send a staff user query param.{' '}
                            <code style={{ fontSize: '0.7rem' }}>GHL_FREE_SLOTS_RETRY_USER_PARAM</code> is the usual retry
                            shape; confirm with your GHL account if retries should differ.
                          </p>
                        ) : null}
                        <ul
                          style={{
                            margin: 0,
                            paddingLeft: '1.1rem',
                            fontSize: '0.74rem',
                            lineHeight: 1.55,
                            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                            color: 'var(--aisbp-text-secondary)',
                          }}
                        >
                          {winningEnvLines.map(row => (
                            <li key={row.key} style={{ marginBottom: '0.15rem' }}>
                              <span style={{ fontWeight: 600 }}>{row.key}</span>={row.value}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {probeResult && probeResult.variants.length > 0 ? (
                      <div style={{ marginTop: '0.55rem', overflowX: 'auto' }}>
                        <p style={{ ...subsectionTitleStyle(), marginBottom: '0.35rem' }}>Tested variants</p>
                        <table
                          style={{
                            width: '100%',
                            borderCollapse: 'collapse',
                            fontSize: '0.68rem',
                          }}
                        >
                          <thead>
                            <tr style={{ textAlign: 'left', color: 'var(--aisbp-muted)' }}>
                              <th style={{ padding: '0.22rem 0.3rem' }}>hostMode</th>
                              <th style={{ padding: '0.22rem 0.3rem' }}>rangeMode</th>
                              <th style={{ padding: '0.22rem 0.3rem' }}>seats</th>
                              <th style={{ padding: '0.22rem 0.3rem' }}>version</th>
                              <th style={{ padding: '0.22rem 0.3rem' }}>unit</th>
                              <th style={{ padding: '0.22rem 0.3rem' }}>user</th>
                              <th style={{ padding: '0.22rem 0.3rem' }}>TZ q</th>
                              <th style={{ padding: '0.22rem 0.3rem' }}>HTTP</th>
                              <th style={{ padding: '0.22rem 0.3rem' }} title="Coarse HTTP body shape">
                                raw
                              </th>
                              <th style={{ padding: '0.22rem 0.3rem' }} title="ISO-like strings detected in payload">
                                ISO#
                              </th>
                              <th style={{ padding: '0.22rem 0.3rem' }} title="Slots after parser">
                                parsed#
                              </th>
                              <th style={{ padding: '0.22rem 0.3rem' }} title="Parser shapeSummary">
                                parse
                              </th>
                              <th style={{ padding: '0.22rem 0.3rem' }}>#</th>
                              <th style={{ padding: '0.22rem 0.3rem', minWidth: 120 }}>firstFewSlots</th>
                            </tr>
                          </thead>
                          <tbody>
                            {probeResult.variants.map((v, i) => (
                              <tr
                                key={i}
                                title={v.variantName}
                                style={{
                                  background: v.slotsReturned > 0 ? 'rgba(34, 197, 94, 0.22)' : undefined,
                                  boxShadow: v.slotsReturned > 0 ? 'inset 3px 0 0 0 rgb(22 163 74)' : undefined,
                                  borderTop: '1px solid var(--aisbp-border)',
                                }}
                              >
                                <td style={{ padding: '0.28rem 0.3rem', whiteSpace: 'nowrap' }}>
                                  {v.hostMode === 'leadconnectorBackendWidget'
                                    ? 'leadconnectorBackendWidget'
                                    : 'servicesApi'}
                                </td>
                                <td style={{ padding: '0.28rem 0.3rem' }}>{v.rangeMode}</td>
                                <td style={{ padding: '0.28rem 0.3rem' }}>{v.sendSeatsPerSlot ? 'true' : 'false'}</td>
                                <td style={{ padding: '0.28rem 0.3rem' }}>{v.version}</td>
                                <td style={{ padding: '0.28rem 0.3rem' }}>{v.timestampUnit}</td>
                                <td style={{ padding: '0.28rem 0.3rem' }}>{v.userParamMode}</td>
                                <td style={{ padding: '0.28rem 0.3rem' }}>{v.timezoneIncluded ? 'yes' : 'no'}</td>
                                <td style={{ padding: '0.28rem 0.3rem' }}>{v.httpStatus ?? '—'}</td>
                                <td
                                  style={{
                                    padding: '0.28rem 0.3rem',
                                    maxWidth: 88,
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                  }}
                                  title={v.rawResponseShape ?? ''}
                                >
                                  {(v.rawResponseShape ?? '—').length > 14
                                    ? `${(v.rawResponseShape ?? '—').slice(0, 12)}…`
                                    : (v.rawResponseShape ?? '—')}
                                </td>
                                <td style={{ padding: '0.28rem 0.3rem' }}>{v.rawIsoStringCount ?? 0}</td>
                                <td style={{ padding: '0.28rem 0.3rem' }}>{v.parsedSlotsReturned ?? v.slotsReturned}</td>
                                <td
                                  style={{
                                    padding: '0.28rem 0.3rem',
                                    maxWidth: 100,
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                  }}
                                  title={v.responseShape}
                                >
                                  {(v.responseShape ?? '—').length > 12
                                    ? `${(v.responseShape ?? '—').slice(0, 10)}…`
                                    : (v.responseShape ?? '—')}
                                </td>
                                <td
                                  style={{
                                    padding: '0.28rem 0.3rem',
                                    fontWeight: v.slotsReturned > 0 ? 800 : 700,
                                    color: v.slotsReturned > 0 ? 'rgb(22 101 52)' : undefined,
                                  }}
                                >
                                  {v.slotsReturned}
                                </td>
                                <td style={{ padding: '0.28rem 0.3rem', color: 'var(--aisbp-muted)', lineHeight: 1.35 }}>
                                  {formatProbeFirstFewSlots(v)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <p style={{ ...statusLineStyle(), marginTop: '0.5rem' }} title={probeResult.crmTimezoneUsed}>
                          CRM tz used: {probeResult.crmTimezoneUsed}
                          {probeResult.teamUserIdProbe ? ` · team user: ${probeResult.teamUserIdProbe}` : ''}
                        </p>
                      </div>
                    ) : null}
                  </div>
                </details>
              ) : null}
            </div>
          </SectionCard>

          <SectionCard
            title="Booking settings"
            subtitle="Configure how AISBP collects booking details — confirmation still depends on your CRM."
            accent="muted"
          >
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.85rem' }}>
              <input
                type="checkbox"
                checked={booking.enabled}
                onChange={e => setBooking({ ...booking, enabled: e.target.checked })}
              />
              <span style={{ fontWeight: 600 }}>Enable booking assistant</span>
            </label>

            <label style={{ ...mvpLabelStyle, display: 'block', marginBottom: '0.85rem' }}>
              Default calendar
              <select
                value={booking.defaultGhlCalendarId ?? ''}
                onChange={e => {
                  const id = e.target.value || null;
                  const hit = calendarOptions.find((c: CalendarOption) => c.id === id);
                  setBooking({
                    ...booking,
                    defaultGhlCalendarId: id,
                    defaultGhlCalendarName: hit?.name ?? null,
                  });
                }}
                style={{ ...mvpSelectStyle, marginTop: '0.35rem', width: '100%', maxWidth: 420 }}
              >
                <option value="">— Select —</option>
                {calendarOptions.map((c: CalendarOption) => (
                  <option key={c.id} value={c.id}>
                    {c.name || c.id}
                  </option>
                ))}
              </select>
            </label>
            <p style={{ fontSize: '0.78rem', color: 'var(--aisbp-muted)', marginTop: '0.35rem', lineHeight: 1.45, marginBottom: '0.85rem' }}>
              AISBP uses this calendar for booking-related workflows.
            </p>
            {syncCalendarsHint ? (
              <p style={{ fontSize: '0.76rem', color: 'var(--aisbp-muted)', marginTop: '-0.5rem', marginBottom: '0.85rem' }}>
                {syncCalendarsHint}
              </p>
            ) : null}

            <label style={{ ...mvpLabelStyle, display: 'block', marginBottom: '0.35rem' }}>Booking mode</label>
            <select
              value={booking.bookingMode}
              onChange={e => setBooking({ ...booking, bookingMode: e.target.value as TenantBookingMode })}
              style={{ ...mvpSelectStyle, maxWidth: '100%', marginBottom: '0.5rem' }}
            >
              {BOOKING_MODE_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <p style={{ fontSize: '0.78rem', color: 'var(--aisbp-muted)', lineHeight: 1.45, marginBottom: '0.85rem' }}>{modeHint}</p>

            <p style={{ fontSize: '0.82rem', fontWeight: 600, margin: '0 0 0.5rem' }}>Core fields</p>
            <div style={{ overflowX: 'auto', marginBottom: '1rem' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--aisbp-border)' }}>
                    <th style={{ padding: '0.35rem' }}>Field</th>
                    <th style={{ padding: '0.35rem' }}>Ask</th>
                    <th style={{ padding: '0.35rem' }}>Required</th>
                  </tr>
                </thead>
                <tbody>
                  {CORE_FIELDS.map(row => {
                    const st = booking.coreFieldsJson[row.key] ?? { enabled: false, required: false };
                    return (
                      <tr key={row.key} style={{ borderBottom: '1px solid var(--aisbp-border)' }}>
                        <td style={{ padding: '0.4rem 0.35rem' }}>{row.label}</td>
                        <td style={{ padding: '0.4rem 0.35rem' }}>
                          <input
                            type="checkbox"
                            checked={st.enabled}
                            onChange={e => toggleCore(row.key, 'enabled', e.target.checked)}
                          />
                        </td>
                        <td style={{ padding: '0.4rem 0.35rem' }}>
                          <input
                            type="checkbox"
                            checked={st.required}
                            disabled={!st.enabled}
                            onChange={e => toggleCore(row.key, 'required', e.target.checked)}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <p style={{ fontSize: '0.82rem', fontWeight: 600, margin: '0 0 0.5rem' }}>Custom fields</p>
            {booking.customFieldsJson.length === 0 ? (
              <p style={{ fontSize: '0.8rem', color: 'var(--aisbp-muted)', margin: '0 0 0.5rem' }}>None yet.</p>
            ) : null}
            {booking.customFieldsJson.map(cf => (
              <div key={cf.id} style={{ ...cardStyle(), padding: '0.65rem 0.85rem' }}>
                <input
                  value={cf.label}
                  onChange={e => updateCustomField(cf.id, { label: e.target.value })}
                  placeholder="Label"
                  style={{ ...mvpInputStyle, width: '100%', marginBottom: '0.35rem' }}
                />
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
                  <select
                    value={
                      (CUSTOM_TYPES as readonly string[]).includes(cf.fieldType) ? cf.fieldType : 'short_text'
                    }
                    onChange={e => updateCustomField(cf.id, { fieldType: e.target.value })}
                    style={{ ...mvpSelectStyle, padding: '0.35rem' }}
                  >
                    {CUSTOM_TYPES.map(t => (
                      <option key={t} value={t}>
                        {CUSTOM_FIELD_TYPE_LABELS[t]}
                      </option>
                    ))}
                  </select>
                  <label style={{ fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <input
                      type="checkbox"
                      checked={cf.required}
                      onChange={e => updateCustomField(cf.id, { required: e.target.checked })}
                    />
                    Required
                  </label>
                  <button type="button" disabled={dim} onClick={() => removeCustomField(cf.id)} style={btn('danger', dim)}>
                    Remove
                  </button>
                </div>
                {cf.fieldType === 'single_select' ? (
                  <textarea
                    value={(cf.options ?? []).join('\n')}
                    onChange={e =>
                      updateCustomField(cf.id, {
                        options: e.target.value
                          .split('\n')
                          .map(s => s.trim())
                          .filter(Boolean),
                      })
                    }
                    placeholder="One option per line"
                    rows={3}
                    style={{ ...mvpInputStyle, width: '100%', marginTop: '0.35rem', fontSize: '0.8rem' }}
                  />
                ) : null}
              </div>
            ))}
            <button type="button" disabled={dim} onClick={() => addCustomField()} style={{ ...btn('secondary', dim), marginBottom: '1rem' }}>
              Add custom field
            </button>

            <label style={{ ...mvpLabelStyle, display: 'block', maxWidth: 200 }}>
              Parallel bookings per slot
              <input
                type="number"
                min={1}
                value={booking.maxBookingsPerSlot}
                onChange={e =>
                  setBooking({ ...booking, maxBookingsPerSlot: Math.max(1, Number(e.target.value) || 1) })
                }
                style={{ ...mvpInputStyle, marginTop: '0.35rem', maxWidth: 120 }}
              />
            </label>
            <p style={{ fontSize: '0.76rem', color: 'var(--aisbp-muted)', lineHeight: 1.45, marginTop: '0.5rem', marginBottom: '0.85rem' }}>
              Default is 1. Higher capacity is stored for future CRM-backed counting; AISBP will not invent extra availability.
            </p>

            <button type="button" disabled={dim} onClick={() => void saveBookingModule()} style={btn('primary', dim)}>
              Save booking settings
            </button>
            {saveSettingsStatus ? (
              <p style={{ ...statusLineStyle(), marginTop: '0.55rem' }} role="status">
                {saveSettingsStatus}
              </p>
            ) : null}
          </SectionCard>
        </>
      )}
    </div>
  );
}
