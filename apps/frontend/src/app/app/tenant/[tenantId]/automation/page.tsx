'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  getIntentTagRules,
  getTenantBookingSettings,
  patchIntentTagRules,
  patchTenantBookingSettings,
  syncTenantCalendars,
  syncTenantGhlTags,
  testIntentTagOnContact,
  testTenantBookingCalendar,
  testTenantBookingSlots,
  type IntentTagRule,
  type TenantBookingMode,
  type TenantBookingSettings,
} from '@/lib/api';
import { ErrorBanner, LoadingBlock, PageHeader, SectionCard } from '@/components/app/mvp-ui';

type TabId = 'booking' | 'tags' | 'handover';

const BOOKING_MODE_OPTIONS: { value: TenantBookingMode; label: string }[] = [
  { value: 'COLLECT_DETAILS_ONLY', label: 'Collect details only' },
  { value: 'CHECK_AVAILABILITY', label: 'Check availability' },
  { value: 'BOOK_AFTER_CONFIRMATION', label: 'Book after user confirms slot' },
];

const REQUIRED_FIELD_OPTS: { key: string; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'phone', label: 'Phone' },
  { key: 'service', label: 'Service' },
  { key: 'preferred_date', label: 'Preferred date' },
  { key: 'preferred_time', label: 'Preferred time' },
  { key: 'first_visit', label: 'First visit' },
  { key: 'hair_length', label: 'Hair length' },
  { key: 'colour_preference', label: 'Colour preference' },
  { key: 'notes', label: 'Notes' },
];

const INTENT_LABELS: Record<string, string> = {
  booking_interest: 'Booking interest',
  colour_interest: 'Colour interest',
  scalp_interest: 'Scalp interest',
  complaint_service_issue: 'Complaint / service issue',
  price_question: 'Price question',
  hot_lead: 'Hot lead',
};

const tabBtn = (active: boolean): CSSProperties => ({
  padding: '0.45rem 0.85rem',
  borderRadius: '10px',
  border: active ? '1px solid var(--aisbp-border, #e2e8f0)' : '1px solid transparent',
  background: active ? 'var(--aisbp-surface, #fff)' : 'transparent',
  fontWeight: active ? 700 : 600,
  cursor: 'pointer',
  fontSize: '0.85rem',
  color: active ? 'var(--aisbp-text-heading, #0f172a)' : 'var(--aisbp-muted, #64748b)',
});

export default function TenantAutomationPage() {
  const params = useParams();
  const tenantId = params['tenantId'] as string;
  const { token } = useAuth();

  const [tab, setTab] = useState<TabId>('booking');
  const [loadErr, setLoadErr] = useState('');
  const [bookingLoading, setBookingLoading] = useState(true);
  const [booking, setBooking] = useState<TenantBookingSettings | null>(null);
  const [calendars, setCalendars] = useState<{ id: string; name: string }[]>([]);
  const [tagsLoading, setTagsLoading] = useState(false);
  const [rules, setRules] = useState<IntentTagRule[]>([]);
  const [approvedTags, setApprovedTags] = useState<{ id?: string; name: string }[]>([]);
  const [bookingBanner, setBookingBanner] = useState('');
  const [tagsBanner, setTagsBanner] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const [testContactId, setTestContactId] = useState('');
  const [testTagName, setTestTagName] = useState('');

  const loadBooking = useCallback(async () => {
    if (!token || !tenantId) return;
    setBookingLoading(true);
    setLoadErr('');
    try {
      const b = await getTenantBookingSettings(token, tenantId);
      setBooking(b);
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : 'Failed to load booking settings');
    } finally {
      setBookingLoading(false);
    }
  }, [token, tenantId]);

  const loadRules = useCallback(async () => {
    if (!token || !tenantId) return;
    setTagsLoading(true);
    setLoadErr('');
    try {
      const r = await getIntentTagRules(token, tenantId);
      setRules(r.rules);
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : 'Failed to load intent tags');
    } finally {
      setTagsLoading(false);
    }
  }, [token, tenantId]);

  useEffect(() => {
    void loadBooking();
  }, [loadBooking]);

  useEffect(() => {
    if (tab === 'tags') void loadRules();
  }, [tab, loadRules]);

  const toggleRequired = useCallback(
    (key: string, on: boolean) => {
      setBooking((prev) => {
        if (!prev) return prev;
        const set = new Set(prev.requiredFieldsJson);
        if (on) set.add(key);
        else set.delete(key);
        return { ...prev, requiredFieldsJson: [...set] };
      });
    },
    [],
  );

  const saveBooking = async () => {
    if (!token || !tenantId || !booking) return;
    setBusy('save-booking');
    setBookingBanner('');
    try {
      const next = await patchTenantBookingSettings(token, tenantId, {
        enabled: booking.enabled,
        bookingMode: booking.bookingMode,
        defaultGhlCalendarId: booking.defaultGhlCalendarId,
        defaultGhlCalendarName: booking.defaultGhlCalendarName,
        requiredFieldsJson: booking.requiredFieldsJson,
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
      else setBookingBanner(`Loaded ${r.calendars.length} calendars.`);
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
      const r = await testTenantBookingSlots(token, tenantId);
      const n = r.slots?.length ?? 0;
      const extra = r.error ? ` (${r.error})` : '';
      setBookingBanner(`Sample slots: ${n}${extra}`);
    } catch (e) {
      setBookingBanner(e instanceof Error ? e.message : 'Test failed');
    } finally {
      setBusy(null);
    }
  };

  const onSyncTags = async () => {
    if (!token || !tenantId) return;
    setBusy('sync-tags');
    setTagsBanner('');
    try {
      const r = await syncTenantGhlTags(token, tenantId);
      setApprovedTags(r.tags);
      if (r.error) setTagsBanner(`Synced with warning: ${r.error}`);
      else setTagsBanner(`Loaded ${r.tags.length} tags from GHL.`);
    } catch (e) {
      setTagsBanner(e instanceof Error ? e.message : 'Sync failed');
    } finally {
      setBusy(null);
    }
  };

  const updateRule = (intentKey: string, patch: Partial<IntentTagRule>) => {
    setRules((prev) => prev.map((x) => (x.intentKey === intentKey ? { ...x, ...patch } : x)));
  };

  const saveRules = async () => {
    if (!token || !tenantId) return;
    setBusy('save-tags');
    setTagsBanner('');
    try {
      const next = await patchIntentTagRules(token, tenantId, rules);
      setRules(next.rules);
      setTagsBanner('Saved.');
    } catch (e) {
      setTagsBanner(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(null);
    }
  };

  const onTestTag = async () => {
    if (!token || !tenantId || !testContactId.trim() || !testTagName.trim()) {
      setTagsBanner('Enter a GHL contact ID and choose a tag.');
      return;
    }
    setBusy('test-tag');
    setTagsBanner('');
    try {
      const r = await testIntentTagOnContact(token, tenantId, {
        contactId: testContactId.trim(),
        tagName: testTagName.trim(),
      });
      setTagsBanner(r.success ? (r.message ?? 'OK') : (r.error ?? 'Failed'));
    } catch (e) {
      setTagsBanner(e instanceof Error ? e.message : 'Test failed');
    } finally {
      setBusy(null);
    }
  };

  const calendarOptions = useMemo(() => calendars, [calendars]);

  return (
    <div style={{ maxWidth: 920 }}>
      <PageHeader title="Automation" eyebrow="Advanced" />
      <p style={{ fontSize: '0.88rem', color: 'var(--aisbp-muted)', margin: '0 0 1rem', lineHeight: 1.5, maxWidth: 720 }}>
        Configure booking capture, GHL tags by intent, and (soon) handover alerts.
      </p>

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        {(['booking', 'tags', 'handover'] as const).map((id) => (
          <button key={id} type="button" style={tabBtn(tab === id)} onClick={() => setTab(id)}>
            {id === 'booking' ? 'Booking' : id === 'tags' ? 'Tags' : 'Handover'}
          </button>
        ))}
      </div>

      {loadErr ? <ErrorBanner message={loadErr} /> : null}

      {tab === 'booking' ? (
        <>
          {bookingLoading ? (
            <LoadingBlock />
          ) : booking ? (
            <>
              <SectionCard title="Booking automation" subtitle="Uses your connected GHL location (CRM tab).">
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                  <input
                    type="checkbox"
                    checked={booking.enabled}
                    onChange={(e) => setBooking({ ...booking, enabled: e.target.checked })}
                  />
                  <span>Booking enabled</span>
                </label>

                <div style={{ marginBottom: '0.75rem' }}>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.35rem' }}>
                    Booking mode
                  </label>
                  <select
                    value={booking.bookingMode}
                    onChange={(e) =>
                      setBooking({ ...booking, bookingMode: e.target.value as TenantBookingMode })
                    }
                    style={{ maxWidth: '100%', padding: '0.45rem 0.5rem', borderRadius: 8 }}
                  >
                    {BOOKING_MODE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void onSyncCalendars()}
                    style={{ padding: '0.45rem 0.75rem', borderRadius: 8, cursor: busy ? 'wait' : 'pointer' }}
                  >
                    Sync calendars from GHL
                  </button>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void onTestCal()}
                    style={{ padding: '0.45rem 0.75rem', borderRadius: 8, cursor: busy ? 'wait' : 'pointer' }}
                  >
                    Test calendar
                  </button>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void onTestSlots()}
                    style={{ padding: '0.45rem 0.75rem', borderRadius: 8, cursor: busy ? 'wait' : 'pointer' }}
                  >
                    Check sample slots
                  </button>
                </div>

                <div style={{ marginBottom: '0.75rem' }}>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.35rem' }}>
                    Default calendar
                  </label>
                  <select
                    value={booking.defaultGhlCalendarId ?? ''}
                    onChange={(e) => {
                      const id = e.target.value || null;
                      const hit = calendarOptions.find((c) => c.id === id);
                      setBooking({
                        ...booking,
                        defaultGhlCalendarId: id,
                        defaultGhlCalendarName: hit?.name ?? null,
                      });
                    }}
                    style={{ maxWidth: '100%', padding: '0.45rem 0.5rem', borderRadius: 8 }}
                  >
                    <option value="">— Select —</option>
                    {calendarOptions.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name || c.id}
                      </option>
                    ))}
                  </select>
                  <p style={{ fontSize: '0.78rem', color: 'var(--aisbp-muted)', marginTop: '0.35rem' }}>
                    Sync calendars first, then pick the default for availability checks.
                  </p>
                </div>

                <p style={{ fontSize: '0.82rem', fontWeight: 600, margin: '0 0 0.5rem' }}>Required fields</p>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                    gap: '0.35rem 0.75rem',
                  }}
                >
                  {REQUIRED_FIELD_OPTS.map((f) => (
                    <label key={f.key} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.85rem' }}>
                      <input
                        type="checkbox"
                        checked={booking.requiredFieldsJson.includes(f.key)}
                        onChange={(e) => toggleRequired(f.key, e.target.checked)}
                      />
                      {f.label}
                    </label>
                  ))}
                </div>

                <div style={{ marginTop: '1rem' }}>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void saveBooking()}
                    style={{ padding: '0.5rem 1rem', borderRadius: 8, fontWeight: 600, cursor: busy ? 'wait' : 'pointer' }}
                  >
                    Save booking settings
                  </button>
                </div>
                {bookingBanner ? (
                  <p style={{ marginTop: '0.75rem', fontSize: '0.85rem', color: 'var(--aisbp-muted)' }}>{bookingBanner}</p>
                ) : null}
              </SectionCard>
            </>
          ) : null}
        </>
      ) : null}

      {tab === 'tags' ? (
        <>
          {tagsLoading ? (
            <LoadingBlock />
          ) : (
            <SectionCard
              title="Intent tags"
              subtitle="Map intents to existing GHL tags. Sync tags first — only tags from your location can be used."
            >
              <div style={{ marginBottom: '0.75rem' }}>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void onSyncTags()}
                  style={{ padding: '0.45rem 0.75rem', borderRadius: 8, cursor: busy ? 'wait' : 'pointer' }}
                >
                  Sync tags from GHL
                </button>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                  <thead>
                    <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--aisbp-border)' }}>
                      <th style={{ padding: '0.5rem 0.35rem' }}>Intent</th>
                      <th style={{ padding: '0.5rem 0.35rem' }}>GHL tag</th>
                      <th style={{ padding: '0.5rem 0.35rem' }}>Auto apply</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rules.map((row) => (
                      <tr key={row.intentKey} style={{ borderBottom: '1px solid var(--aisbp-border)' }}>
                        <td style={{ padding: '0.5rem 0.35rem', verticalAlign: 'middle' }}>
                          {INTENT_LABELS[row.intentKey] ?? row.intentKey}
                        </td>
                        <td style={{ padding: '0.5rem 0.35rem' }}>
                          <select
                            value={row.tagName}
                            onChange={(e) => updateRule(row.intentKey, { tagName: e.target.value })}
                            style={{ maxWidth: 220, padding: '0.35rem', borderRadius: 6 }}
                          >
                            <option value="">—</option>
                            {approvedTags.map((t) => (
                              <option key={`${t.name}-${t.id ?? ''}`} value={t.name}>
                                {t.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td style={{ padding: '0.5rem 0.35rem' }}>
                          <input
                            type="checkbox"
                            checked={row.enabled && row.triggerMode === 'AUTO'}
                            onChange={(e) => {
                              const on = e.target.checked;
                              updateRule(row.intentKey, {
                                enabled: on,
                                triggerMode: on ? 'AUTO' : 'OFF',
                              });
                            }}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{ marginTop: '1rem' }}>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void saveRules()}
                  style={{ padding: '0.5rem 1rem', borderRadius: 8, fontWeight: 600, cursor: busy ? 'wait' : 'pointer' }}
                >
                  Save tag rules
                </button>
              </div>

              <hr style={{ margin: '1.25rem 0', border: 'none', borderTop: '1px solid var(--aisbp-border)' }} />

              <p style={{ fontSize: '0.82rem', fontWeight: 600, marginBottom: '0.5rem' }}>Test tag</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.8rem' }}>
                  Contact ID
                  <input
                    value={testContactId}
                    onChange={(e) => setTestContactId(e.target.value)}
                    placeholder="GHL contact id"
                    style={{ padding: '0.4rem 0.5rem', borderRadius: 8, minWidth: 200 }}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.8rem' }}>
                  Tag
                  <select
                    value={testTagName}
                    onChange={(e) => setTestTagName(e.target.value)}
                    style={{ padding: '0.4rem 0.5rem', borderRadius: 8, minWidth: 180 }}
                  >
                    <option value="">—</option>
                    {approvedTags.map((t) => (
                      <option key={`test-${t.name}`} value={t.name}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void onTestTag()}
                  style={{ padding: '0.45rem 0.75rem', borderRadius: 8, cursor: busy ? 'wait' : 'pointer' }}
                >
                  Apply test tag
                </button>
              </div>

              {tagsBanner ? (
                <p style={{ marginTop: '0.75rem', fontSize: '0.85rem', color: 'var(--aisbp-muted)' }}>{tagsBanner}</p>
              ) : null}
            </SectionCard>
          )}
        </>
      ) : null}

      {tab === 'handover' ? (
        <SectionCard title="Handover" subtitle="Human takeover workflows">
          <p style={{ margin: 0, fontSize: '0.9rem', lineHeight: 1.5, color: 'var(--aisbp-muted)' }}>
            Coming soon: pause AI and notify your team when a complaint or urgent request is detected.
          </p>
        </SectionCard>
      ) : null}
    </div>
  );
}
