'use client';

import type { CSSProperties } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import {
  getTenantBookingSettings,
  patchTenantBookingSettings,
  syncTenantCalendars,
  testTenantBookingCalendar,
  testTenantBookingSlots,
  type CustomBookingField,
  type TenantBookingMode,
  type TenantBookingSettings,
} from '@/lib/api';
import { ErrorBanner, LoadingBlock, SectionCard } from '@/components/app/mvp-ui';

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

function cardStyle(): CSSProperties {
  return {
    border: '1px solid var(--aisbp-border)',
    borderRadius: 10,
    padding: '0.85rem 1rem',
    marginBottom: '0.75rem',
    background: 'var(--aisbp-surface)',
  };
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
  const [slotStart, setSlotStart] = useState('');
  const [slotEnd, setSlotEnd] = useState('');
  const [slotTz, setSlotTz] = useState('');
  const [bookingBanner, setBookingBanner] = useState('');

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
    setBookingBanner('');
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
      setBookingBanner('Saved.');
    } catch (e) {
      setBookingBanner(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(null);
    }
  };

  const onSyncCalendars = async () => {
    if (!token || !tenantId) return;
    setBusy('sync-cal');
    setBookingBanner('');
    try {
      const r = await syncTenantCalendars(token, tenantId);
      setCalendars(r.calendars);
      if (r.error) setBookingBanner(`Synced with warning: ${r.error}`);
      else setBookingBanner(`Loaded ${r.calendars.length} calendars from CRM.`);
    } catch (e) {
      setBookingBanner(e instanceof Error ? e.message : 'Sync failed');
    } finally {
      setBusy(null);
    }
  };

  const onTestCal = async () => {
    if (!token || !tenantId) return;
    setBusy('test-cal');
    setBookingBanner('');
    try {
      const r = await testTenantBookingCalendar(token, tenantId);
      setBookingBanner(r.ok ? r.message : r.message);
      if (r.calendars?.length) setCalendars(r.calendars);
    } catch (e) {
      setBookingBanner(e instanceof Error ? e.message : 'Test failed');
    } finally {
      setBusy(null);
    }
  };

  const onTestSlots = async () => {
    if (!token || !tenantId) return;
    setBusy('test-slots');
    setBookingBanner('');
    try {
      const body =
        slotStart.trim() || slotEnd.trim() || slotTz.trim()
          ? {
              startDate: slotStart.trim() || undefined,
              endDate: slotEnd.trim() || undefined,
              timezone: slotTz.trim() || undefined,
            }
          : undefined;
      const r = await testTenantBookingSlots(token, tenantId, body);
      const n = r.slots?.length ?? 0;
      const extra = r.error ? ` (${r.error})` : '';
      setBookingBanner(`Returned ${n} sample slots${extra}. Times come from CRM — not a booking confirmation.`);
    } catch (e) {
      setBookingBanner(e instanceof Error ? e.message : 'Test failed');
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

  const bookingHint = !booking?.defaultGhlCalendarId?.trim()
    ? 'Choose a default calendar and pass Test calendar before relying on availability checks.'
    : null;

  const capacityNote =
    booking && booking.maxBookingsPerSlot > 1
      ? 'Capacity above 1 is stored for when CRM-backed counting exists — extra slots are never invented.'
      : null;

  const modeHint = BOOKING_MODE_OPTIONS.find(m => m.value === booking?.bookingMode)?.hint ?? '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {loadErr ? <ErrorBanner message={loadErr} /> : null}

      <SectionCard
        title="Booking assistant"
        subtitle="One default CRM calendar. This area configures intake only — it does not finalize bookings unless your CRM flow does."
        accent="muted"
      >
        {bookingLoading ? (
          <LoadingBlock />
        ) : booking ? (
          <>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.85rem' }}>
              <input
                type="checkbox"
                checked={booking.enabled}
                onChange={e => setBooking({ ...booking, enabled: e.target.checked })}
              />
              <span style={{ fontWeight: 600 }}>Enable booking assistant</span>
            </label>

            <div style={cardStyle()}>
              <div style={{ fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.06em', color: 'var(--aisbp-muted)', marginBottom: '0.35rem' }}>
                STEP 1 — SYNC CALENDARS
              </div>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void onSyncCalendars()}
                style={{ padding: '0.45rem 0.75rem', borderRadius: 8, cursor: busy ? 'wait' : 'pointer' }}
              >
                Sync calendars from CRM
              </button>
            </div>

            <div style={cardStyle()}>
              <div style={{ fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.06em', color: 'var(--aisbp-muted)', marginBottom: '0.35rem' }}>
                STEP 2 — DEFAULT CALENDAR
              </div>
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
                style={{ maxWidth: '100%', padding: '0.45rem 0.5rem', borderRadius: 8 }}
              >
                <option value="">— Select —</option>
                {calendarOptions.map((c: CalendarOption) => (
                  <option key={c.id} value={c.id}>
                    {c.name || c.id}
                  </option>
                ))}
              </select>
              <p style={{ fontSize: '0.76rem', color: 'var(--aisbp-muted)', marginTop: '0.35rem' }}>
                Demo scope uses this calendar only.
              </p>
            </div>

            <div style={cardStyle()}>
              <div style={{ fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.06em', color: 'var(--aisbp-muted)', marginBottom: '0.35rem' }}>
                STEP 3 — TEST CALENDAR CONNECTION
              </div>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void onTestCal()}
                style={{ padding: '0.45rem 0.75rem', borderRadius: 8, cursor: busy ? 'wait' : 'pointer' }}
              >
                Test calendar
              </button>
              {bookingHint ? (
                <p style={{ fontSize: '0.76rem', color: 'var(--aisbp-muted)', marginTop: '0.35rem' }}>{bookingHint}</p>
              ) : null}
            </div>

            <div style={cardStyle()}>
              <div style={{ fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.06em', color: 'var(--aisbp-muted)', marginBottom: '0.35rem' }}>
                STEP 4 — PARALLEL BOOKINGS PER SLOT
              </div>
              <input
                type="number"
                min={1}
                value={booking.maxBookingsPerSlot}
                onChange={e =>
                  setBooking({ ...booking, maxBookingsPerSlot: Math.max(1, Number(e.target.value) || 1) })
                }
                style={{ padding: '0.35rem', borderRadius: 8, maxWidth: 120 }}
              />
              {capacityNote ? (
                <p style={{ fontSize: '0.76rem', color: 'var(--aisbp-muted)', marginTop: '0.35rem', lineHeight: 1.45 }}>{capacityNote}</p>
              ) : null}
            </div>

            <div style={cardStyle()}>
              <div style={{ fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.06em', color: 'var(--aisbp-muted)', marginBottom: '0.35rem' }}>
                STEP 5 — SAMPLE AVAILABILITY (DATES / TIMEZONE)
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end' }}>
                <label style={{ fontSize: '0.78rem' }}>
                  Start date
                  <input
                    type="date"
                    value={slotStart}
                    onChange={e => setSlotStart(e.target.value)}
                    style={{ display: 'block', marginTop: '0.25rem', padding: '0.35rem', borderRadius: 8 }}
                  />
                </label>
                <label style={{ fontSize: '0.78rem' }}>
                  End date
                  <input
                    type="date"
                    value={slotEnd}
                    onChange={e => setSlotEnd(e.target.value)}
                    style={{ display: 'block', marginTop: '0.25rem', padding: '0.35rem', borderRadius: 8 }}
                  />
                </label>
                <label style={{ fontSize: '0.78rem' }}>
                  Timezone (optional)
                  <input
                    value={slotTz}
                    onChange={e => setSlotTz(e.target.value)}
                    placeholder="e.g. Australia/Sydney"
                    style={{ display: 'block', marginTop: '0.25rem', padding: '0.35rem', borderRadius: 8, minWidth: 160 }}
                  />
                </label>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void onTestSlots()}
                  style={{ padding: '0.45rem 0.75rem', borderRadius: 8, cursor: busy ? 'wait' : 'pointer' }}
                >
                  Check slots
                </button>
              </div>
            </div>

            <div style={cardStyle()}>
              <div style={{ fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.06em', color: 'var(--aisbp-muted)', marginBottom: '0.35rem' }}>
                STEP 6 — BOOKING MODE &amp; FIELDS
              </div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.35rem' }}>Booking mode</label>
              <select
                value={booking.bookingMode}
                onChange={e => setBooking({ ...booking, bookingMode: e.target.value as TenantBookingMode })}
                style={{ maxWidth: '100%', padding: '0.45rem 0.5rem', borderRadius: 8, marginBottom: '0.5rem' }}
              >
                {BOOKING_MODE_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <p style={{ fontSize: '0.78rem', color: 'var(--aisbp-muted)', lineHeight: 1.45, marginBottom: '0.85rem' }}>{modeHint}</p>

              <p style={{ fontSize: '0.82rem', fontWeight: 600, margin: '0 0 0.5rem' }}>Core fields</p>
              <div style={{ overflowX: 'auto' }}>
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

              <p style={{ fontSize: '0.82rem', fontWeight: 600, margin: '1rem 0 0.5rem' }}>Custom fields</p>
              {booking.customFieldsJson.length === 0 ? (
                <p style={{ fontSize: '0.8rem', color: 'var(--aisbp-muted)', margin: '0 0 0.5rem' }}>None yet.</p>
              ) : null}
              {booking.customFieldsJson.map(cf => (
                <div key={cf.id} style={{ ...cardStyle(), padding: '0.65rem 0.85rem' }}>
                  <input
                    value={cf.label}
                    onChange={e => updateCustomField(cf.id, { label: e.target.value })}
                    placeholder="Label"
                    style={{ width: '100%', padding: '0.35rem', borderRadius: 6, marginBottom: '0.35rem' }}
                  />
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
                    <select
                      value={cf.fieldType}
                      onChange={e => updateCustomField(cf.id, { fieldType: e.target.value })}
                      style={{ padding: '0.35rem', borderRadius: 6 }}
                    >
                      {CUSTOM_TYPES.map(t => (
                        <option key={t} value={t}>
                          {t}
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
                    <button type="button" onClick={() => removeCustomField(cf.id)} style={{ fontSize: '0.78rem' }}>
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
                      style={{ width: '100%', marginTop: '0.35rem', padding: '0.35rem', borderRadius: 6, fontSize: '0.8rem' }}
                    />
                  ) : null}
                </div>
              ))}
              <button type="button" onClick={() => addCustomField()} style={{ marginBottom: '0.75rem', padding: '0.4rem 0.65rem', borderRadius: 8 }}>
                Add custom field
              </button>
            </div>

            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void saveBookingModule()}
              style={{ padding: '0.5rem 1rem', borderRadius: 8, fontWeight: 600, cursor: busy ? 'wait' : 'pointer' }}
            >
              Save booking settings
            </button>
            {bookingBanner ? (
              <p style={{ marginTop: '0.75rem', fontSize: '0.85rem', color: 'var(--aisbp-muted)' }}>{bookingBanner}</p>
            ) : null}
          </>
        ) : null}
      </SectionCard>
    </div>
  );
}
