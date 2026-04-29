'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  createTenantTagRule,
  deleteTenantTagRule,
  getTenantBookingSettings,
  getTenantFollowUpSettings,
  getTenantTagRules,
  getTenantTaggingSettings,
  patchTenantBookingSettings,
  patchTenantFollowUpSettings,
  patchTenantTagRule,
  patchTenantTaggingSettings,
  syncTenantCalendars,
  syncTenantGhlTags,
  testIntentTagOnContact,
  testTenantBookingSlots,
  testTenantTagRulesMatch,
  testTenantBookingCalendar,
  type CustomBookingField,
  type FollowUpStepSetting,
  type TagConfidenceThreshold,
  type TagMatchMode,
  type TenantBookingMode,
  type TenantBookingSettings,
  type TenantFollowUpSettings,
  type TenantTagRule,
  type TenantTaggingSettings,
} from '@/lib/api';
import { ErrorBanner, LoadingBlock, SectionCard } from '@/components/app/mvp-ui';

const BOOKING_MODE_OPTIONS: { value: TenantBookingMode; label: string }[] = [
  { value: 'COLLECT_DETAILS_ONLY', label: 'Collect details only' },
  { value: 'CHECK_AVAILABILITY', label: 'Check availability' },
  { value: 'BOOK_AFTER_CONFIRMATION', label: 'Book after customer confirms slot' },
];

const CORE_FIELD_OPTS: { key: string; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'phone', label: 'Phone' },
  { key: 'email', label: 'Email' },
  { key: 'service', label: 'Service' },
  { key: 'preferred_date', label: 'Preferred date' },
  { key: 'preferred_time', label: 'Preferred time' },
  { key: 'first_visit', label: 'First visit' },
];

const MATCH_MODE_OPTS: { value: TagMatchMode; label: string }[] = [
  { value: 'AI', label: 'AI' },
  { value: 'KEYWORD', label: 'Keyword' },
  { value: 'HYBRID', label: 'Hybrid' },
];

const CONF_OPTS: { value: TagConfidenceThreshold; label: string }[] = [
  { value: 'LOW', label: 'Low' },
  { value: 'NORMAL', label: 'Normal' },
  { value: 'HIGH', label: 'High' },
];

const CUSTOM_TYPES = ['short_text', 'long_text', 'yes_no', 'single_choice', 'date', 'time'] as const;

function cardStyle(): CSSProperties {
  return {
    border: '1px solid var(--aisbp-border)',
    borderRadius: 10,
    padding: '0.85rem 1rem',
    marginBottom: '0.75rem',
    background: 'var(--aisbp-surface)',
  };
}

export function TenantAutomationSettingsContent() {
  const params = useParams();
  const tenantId = params['tenantId'] as string;
  const { token } = useAuth();

  const [loadErr, setLoadErr] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const [bookingLoading, setBookingLoading] = useState(true);
  const [booking, setBooking] = useState<TenantBookingSettings | null>(null);
  const [calendars, setCalendars] = useState<{ id: string; name: string }[]>([]);
  const [slotStart, setSlotStart] = useState('');
  const [slotEnd, setSlotEnd] = useState('');
  const [bookingBanner, setBookingBanner] = useState('');

  const [tagging, setTagging] = useState<TenantTaggingSettings | null>(null);
  const [rules, setRules] = useState<TenantTagRule[]>([]);
  const [tagsLoading, setTagsLoading] = useState(true);
  const [approvedTags, setApprovedTags] = useState<{ id?: string; name: string }[]>([]);
  const [tagsBanner, setTagsBanner] = useState('');
  const [testContactId, setTestContactId] = useState('');
  const [testTagName, setTestTagName] = useState('');
  const [testMatchMsg, setTestMatchMsg] = useState('');
  const [testMatchResult, setTestMatchResult] = useState<string>('');

  const [followLoading, setFollowLoading] = useState(true);
  const [followUp, setFollowUp] = useState<TenantFollowUpSettings | null>(null);
  const [followBanner, setFollowBanner] = useState('');

  const loadBooking = useCallback(async () => {
    if (!token || !tenantId) return;
    setBookingLoading(true);
    try {
      const b = await getTenantBookingSettings(token, tenantId);
      setBooking(b);
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : 'Failed to load booking settings');
    } finally {
      setBookingLoading(false);
    }
  }, [token, tenantId]);

  const loadTags = useCallback(async () => {
    if (!token || !tenantId) return;
    setTagsLoading(true);
    try {
      const [tg, r] = await Promise.all([
        getTenantTaggingSettings(token, tenantId),
        getTenantTagRules(token, tenantId),
      ]);
      setTagging(tg);
      setRules(r.rules);
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : 'Failed to load tagging settings');
    } finally {
      setTagsLoading(false);
    }
  }, [token, tenantId]);

  const loadFollowUp = useCallback(async () => {
    if (!token || !tenantId) return;
    setFollowLoading(true);
    try {
      const f = await getTenantFollowUpSettings(token, tenantId);
      setFollowUp(f);
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : 'Failed to load follow-up settings');
    } finally {
      setFollowLoading(false);
    }
  }, [token, tenantId]);

  useEffect(() => {
    void loadBooking();
    void loadTags();
    void loadFollowUp();
  }, [loadBooking, loadTags, loadFollowUp]);

  const toggleCoreField = useCallback((key: string, on: boolean) => {
    setBooking(prev => {
      if (!prev) return prev;
      const set = new Set(prev.coreRequiredFieldsJson);
      if (on) set.add(key);
      else set.delete(key);
      return { ...prev, coreRequiredFieldsJson: [...set] };
    });
  }, []);

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
        coreRequiredFieldsJson: booking.coreRequiredFieldsJson,
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
        slotStart.trim() || slotEnd.trim()
          ? { startDate: slotStart.trim() || undefined, endDate: slotEnd.trim() || undefined }
          : undefined;
      const r = await testTenantBookingSlots(token, tenantId, body);
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
      else setTagsBanner(`Loaded ${r.tags.length} tags from CRM.`);
    } catch (e) {
      setTagsBanner(e instanceof Error ? e.message : 'Sync failed');
    } finally {
      setBusy(null);
    }
  };

  const saveTaggingToggle = async () => {
    if (!token || !tenantId || !tagging) return;
    setBusy('save-tag-toggle');
    setTagsBanner('');
    try {
      const next = await patchTenantTaggingSettings(token, tenantId, {
        automaticTaggingEnabled: tagging.automaticTaggingEnabled,
      });
      setTagging(next);
      setTagsBanner('Tagging preferences saved.');
    } catch (e) {
      setTagsBanner(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(null);
    }
  };

  const updateLocalRule = (id: string, patch: Partial<TenantTagRule>) => {
    setRules(prev => prev.map(r => (r.id === id ? { ...r, ...patch } : r)));
  };

  const saveRule = async (rule: TenantTagRule) => {
    if (!token || !tenantId) return;
    setBusy(`save-rule-${rule.id}`);
    setTagsBanner('');
    try {
      const { rule: next } = await patchTenantTagRule(token, tenantId, rule.id, {
        enabled: rule.enabled,
        autoApply: rule.autoApply,
        ruleName: rule.ruleName,
        ruleDescription: rule.ruleDescription,
        crmTagId: rule.crmTagId,
        crmTagName: rule.crmTagName,
        matchMode: rule.matchMode,
        confidenceThreshold: rule.confidenceThreshold,
        priority: rule.priority,
      });
      setRules(prev => prev.map(r => (r.id === next.id ? next : r)));
      setTagsBanner('Rule saved.');
    } catch (e) {
      setTagsBanner(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(null);
    }
  };

  const addRule = async () => {
    if (!token || !tenantId) return;
    setBusy('add-rule');
    setTagsBanner('');
    try {
      const { rule } = await createTenantTagRule(token, tenantId, {
        ruleName: 'New rule',
        ruleDescription: 'Describe when this tag should apply.',
        crmTagName: approvedTags[0]?.name ?? 'tag',
        enabled: true,
        autoApply: false,
        matchMode: 'AI',
        confidenceThreshold: 'NORMAL',
        priority: 0,
      });
      setRules(prev => [...prev, rule]);
      setTagsBanner('Rule created — edit details and save.');
    } catch (e) {
      setTagsBanner(e instanceof Error ? e.message : 'Create failed');
    } finally {
      setBusy(null);
    }
  };

  const removeRule = async (id: string) => {
    if (!token || !tenantId) return;
    if (!globalThis.confirm?.('Delete this rule?')) return;
    setBusy(`del-${id}`);
    setTagsBanner('');
    try {
      await deleteTenantTagRule(token, tenantId, id);
      setRules(prev => prev.filter(r => r.id !== id));
      setTagsBanner('Rule deleted.');
    } catch (e) {
      setTagsBanner(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setBusy(null);
    }
  };

  const onTestTag = async () => {
    if (!token || !tenantId || !testContactId.trim() || !testTagName.trim()) {
      setTagsBanner('Enter a CRM contact ID and choose a tag.');
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

  const onTestMatch = async () => {
    if (!token || !tenantId || !testMatchMsg.trim()) {
      setTagsBanner('Enter a sample customer message to test.');
      return;
    }
    setBusy('test-match');
    setTestMatchResult('');
    try {
      const r = await testTenantTagRulesMatch(token, tenantId, { message: testMatchMsg.trim() });
      setTestMatchResult(JSON.stringify(r, null, 2));
    } catch (e) {
      setTestMatchResult(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setBusy(null);
    }
  };

  const saveFollowUpModule = async () => {
    if (!token || !tenantId || !followUp) return;
    setBusy('save-follow');
    setFollowBanner('');
    try {
      const next = await patchTenantFollowUpSettings(token, tenantId, followUp);
      setFollowUp(next);
      setFollowBanner('Saved.');
    } catch (e) {
      setFollowBanner(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(null);
    }
  };

  const updateFollowStep = (idx: number, patch: Partial<FollowUpStepSetting>) => {
    setFollowUp(prev => {
      if (!prev) return prev;
      const steps = [...prev.steps];
      const cur = steps[idx];
      if (!cur) return prev;
      steps[idx] = { ...cur, ...patch };
      return { ...prev, steps };
    });
  };

  const addFollowStep = () => {
    setFollowUp(prev => {
      if (!prev) return prev;
      if (prev.steps.length >= 5) return prev;
      const n = prev.steps.length + 1;
      const steps = [
        ...prev.steps,
        {
          stepNumber: n,
          delayAmount: 2,
          delayUnit: 'hours' as const,
          mode: 'fixed' as const,
          fixedMessage: '',
          enabled: true,
        },
      ];
      return { ...prev, steps };
    });
  };

  const removeFollowStep = (idx: number) => {
    setFollowUp(prev => {
      if (!prev) return prev;
      const steps = prev.steps.filter((_, i) => i !== idx).map((s, i) => ({ ...s, stepNumber: i + 1 }));
      return { ...prev, steps };
    });
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

  const calendarOptions = useMemo(() => calendars, [calendars]);

  const bookingReadyHint = !booking?.defaultGhlCalendarId?.trim()
    ? 'Select a default calendar and run Test calendar before relying on availability in production.'
    : null;

  const capacityNote =
    booking && booking.maxBookingsPerSlot > 1
      ? 'Capacity above 1 is stored for future use. The backend will not invent extra slots until CRM appointment counts are wired.'
      : null;

  return (
    <div style={{ maxWidth: 920, display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {loadErr ? <ErrorBanner message={loadErr} /> : null}

      {/* 1. Tags */}
      <SectionCard
        title="Tags"
        subtitle="Configure CRM tag rules. The assistant may only apply tags you define here — it will not invent tags."
        accent="default"
      >
        {tagsLoading || !tagging ? (
          <LoadingBlock />
        ) : (
          <>
            <div style={cardStyle()}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600 }}>
                <input
                  type="checkbox"
                  checked={tagging.automaticTaggingEnabled}
                  onChange={e => setTagging({ ...tagging, automaticTaggingEnabled: e.target.checked })}
                />
                Enable automatic tagging
              </label>
              <p style={{ fontSize: '0.78rem', color: 'var(--aisbp-muted)', margin: '0.5rem 0 0', lineHeight: 1.45 }}>
                When enabled, downstream automation may apply CRM tags only from rules below that have Auto apply on and pass
                confidence checks.
              </p>
              <div style={{ marginTop: '0.65rem' }}>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void saveTaggingToggle()}
                  style={{ padding: '0.45rem 0.85rem', borderRadius: 8, fontWeight: 600, cursor: busy ? 'wait' : 'pointer' }}
                >
                  Save tagging toggle
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void onSyncTags()}
                style={{ padding: '0.45rem 0.75rem', borderRadius: 8, cursor: busy ? 'wait' : 'pointer' }}
              >
                Sync CRM tags
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void addRule()}
                style={{ padding: '0.45rem 0.75rem', borderRadius: 8, cursor: busy ? 'wait' : 'pointer' }}
              >
                Add rule
              </button>
            </div>

            {rules.length === 0 ? (
              <p style={{ fontSize: '0.85rem', color: 'var(--aisbp-muted)', margin: '0 0 0.75rem' }}>
                No rules yet. Sync CRM tags, then add a rule and map it to a tag name.
              </p>
            ) : null}

            {rules.map(rule => (
              <div key={rule.id} style={cardStyle()}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <strong style={{ flex: '1 1 160px' }}>{rule.ruleName || 'Untitled rule'}</strong>
                  <label style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <input
                      type="checkbox"
                      checked={rule.enabled}
                      onChange={e => updateLocalRule(rule.id, { enabled: e.target.checked })}
                    />
                    Enabled
                  </label>
                  <label style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <input
                      type="checkbox"
                      checked={rule.autoApply}
                      onChange={e => updateLocalRule(rule.id, { autoApply: e.target.checked })}
                    />
                    Auto apply
                  </label>
                </div>
                <label style={{ fontSize: '0.78rem', display: 'block', marginBottom: '0.35rem' }}>Rule name</label>
                <input
                  value={rule.ruleName}
                  onChange={e => updateLocalRule(rule.id, { ruleName: e.target.value })}
                  style={{ width: '100%', padding: '0.4rem 0.5rem', borderRadius: 8, marginBottom: '0.5rem' }}
                />
                <label style={{ fontSize: '0.78rem', display: 'block', marginBottom: '0.35rem' }}>
                  When should this tag be applied?
                </label>
                <textarea
                  value={rule.ruleDescription}
                  onChange={e => updateLocalRule(rule.id, { ruleDescription: e.target.value })}
                  rows={3}
                  style={{ width: '100%', padding: '0.4rem 0.5rem', borderRadius: 8, marginBottom: '0.5rem', resize: 'vertical' }}
                />
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '0.5rem' }}>
                  <label style={{ fontSize: '0.78rem' }}>
                    CRM tag
                    <select
                      value={rule.crmTagName}
                      onChange={e => updateLocalRule(rule.id, { crmTagName: e.target.value })}
                      style={{ display: 'block', width: '100%', marginTop: '0.25rem', padding: '0.35rem', borderRadius: 6 }}
                    >
                      <option value="">—</option>
                      {approvedTags.map(t => (
                        <option key={`${t.name}-${t.id ?? ''}`} value={t.name}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label style={{ fontSize: '0.78rem' }}>
                    Match mode
                    <select
                      value={rule.matchMode}
                      onChange={e => updateLocalRule(rule.id, { matchMode: e.target.value as TagMatchMode })}
                      style={{ display: 'block', width: '100%', marginTop: '0.25rem', padding: '0.35rem', borderRadius: 6 }}
                    >
                      {MATCH_MODE_OPTS.map(o => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label style={{ fontSize: '0.78rem' }}>
                    Confidence
                    <select
                      value={rule.confidenceThreshold}
                      onChange={e =>
                        updateLocalRule(rule.id, { confidenceThreshold: e.target.value as TagConfidenceThreshold })
                      }
                      style={{ display: 'block', width: '100%', marginTop: '0.25rem', padding: '0.35rem', borderRadius: 6 }}
                    >
                      {CONF_OPTS.map(o => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label style={{ fontSize: '0.78rem' }}>
                    Priority
                    <input
                      type="number"
                      value={rule.priority}
                      onChange={e => updateLocalRule(rule.id, { priority: Number(e.target.value) })}
                      style={{ display: 'block', width: '100%', marginTop: '0.25rem', padding: '0.35rem', borderRadius: 6 }}
                    />
                  </label>
                </div>
                <div style={{ marginTop: '0.65rem', display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void saveRule(rule)}
                    style={{ padding: '0.4rem 0.75rem', borderRadius: 8, fontWeight: 600, cursor: busy ? 'wait' : 'pointer' }}
                  >
                    Save rule
                  </button>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void removeRule(rule.id)}
                    style={{ padding: '0.4rem 0.75rem', borderRadius: 8, cursor: busy ? 'wait' : 'pointer' }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}

            <div style={cardStyle()}>
              <p style={{ fontSize: '0.82rem', fontWeight: 600, margin: '0 0 0.5rem' }}>Test classifier</p>
              <p style={{ fontSize: '0.78rem', color: 'var(--aisbp-muted)', margin: '0 0 0.5rem', lineHeight: 1.45 }}>
                Matches only enabled rules. AI mode uses your agency OpenAI key when configured.
              </p>
              <textarea
                value={testMatchMsg}
                onChange={e => setTestMatchMsg(e.target.value)}
                placeholder="Paste a customer message…"
                rows={3}
                style={{ width: '100%', padding: '0.45rem 0.5rem', borderRadius: 8, marginBottom: '0.5rem' }}
              />
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void onTestMatch()}
                style={{ padding: '0.45rem 0.75rem', borderRadius: 8, cursor: busy ? 'wait' : 'pointer' }}
              >
                Test match
              </button>
              {testMatchResult ? (
                <pre
                  style={{
                    marginTop: '0.65rem',
                    fontSize: '0.75rem',
                    overflow: 'auto',
                    padding: '0.5rem',
                    borderRadius: 8,
                    background: 'var(--aisbp-bg)',
                  }}
                >
                  {testMatchResult}
                </pre>
              ) : null}
            </div>

            <div style={cardStyle()}>
              <p style={{ fontSize: '0.82rem', fontWeight: 600, margin: '0 0 0.5rem' }}>Smoke test: apply tag to contact</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.8rem' }}>
                  Contact ID
                  <input
                    value={testContactId}
                    onChange={e => setTestContactId(e.target.value)}
                    placeholder="CRM contact id"
                    style={{ padding: '0.4rem 0.5rem', borderRadius: 8, minWidth: 200 }}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.8rem' }}>
                  Tag
                  <select
                    value={testTagName}
                    onChange={e => setTestTagName(e.target.value)}
                    style={{ padding: '0.4rem 0.5rem', borderRadius: 8, minWidth: 180 }}
                  >
                    <option value="">—</option>
                    {approvedTags.map(t => (
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
            </div>

            {tagsBanner ? (
              <p style={{ marginTop: '0.35rem', fontSize: '0.85rem', color: 'var(--aisbp-muted)' }}>{tagsBanner}</p>
            ) : null}
          </>
        )}
      </SectionCard>

      {/* 2. Booking */}
      <SectionCard
        title="Booking"
        subtitle="Assistant behaviour for collecting booking details and calendar checks."
        accent="muted"
      >
        {bookingLoading ? (
          <LoadingBlock />
        ) : booking ? (
          <>
            <p style={{ fontSize: '0.8rem', color: 'var(--aisbp-muted)', margin: '0 0 0.75rem', lineHeight: 1.45 }}>
              Step through CRM calendar setup, test connectivity, then choose which fields the bot should collect.
            </p>
            {bookingReadyHint ? (
              <p style={{ fontSize: '0.78rem', color: 'var(--aisbp-muted)', margin: '0 0 0.75rem', lineHeight: 1.45 }}>
                {bookingReadyHint}
              </p>
            ) : null}

            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <input
                type="checkbox"
                checked={booking.enabled}
                onChange={e => setBooking({ ...booking, enabled: e.target.checked })}
              />
              <span style={{ fontWeight: 600 }}>Enable booking assistant</span>
            </label>

            <div style={{ marginBottom: '1rem' }}>
              <span
                style={{
                  display: 'inline-block',
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                  color: 'var(--aisbp-muted)',
                  marginBottom: '0.35rem',
                }}
              >
                STEP 1 — SYNC CALENDAR LIST
              </span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void onSyncCalendars()}
                  style={{ padding: '0.45rem 0.75rem', borderRadius: 8, cursor: busy ? 'wait' : 'pointer' }}
                >
                  Sync calendars from CRM
                </button>
              </div>
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <span
                style={{
                  display: 'inline-block',
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                  color: 'var(--aisbp-muted)',
                  marginBottom: '0.35rem',
                }}
              >
                STEP 2 — DEFAULT CALENDAR
              </span>
              <select
                value={booking.defaultGhlCalendarId ?? ''}
                onChange={e => {
                  const id = e.target.value || null;
                  const hit = calendarOptions.find(c => c.id === id);
                  setBooking({
                    ...booking,
                    defaultGhlCalendarId: id,
                    defaultGhlCalendarName: hit?.name ?? null,
                  });
                }}
                style={{ maxWidth: '100%', padding: '0.45rem 0.5rem', borderRadius: 8 }}
              >
                <option value="">— Select —</option>
                {calendarOptions.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name || c.id}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <span
                style={{
                  display: 'inline-block',
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                  color: 'var(--aisbp-muted)',
                  marginBottom: '0.35rem',
                }}
              >
                STEP 3 — TEST CALENDAR
              </span>
              <div>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void onTestCal()}
                  style={{ padding: '0.45rem 0.75rem', borderRadius: 8, cursor: busy ? 'wait' : 'pointer' }}
                >
                  Test calendar
                </button>
              </div>
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <span
                style={{
                  display: 'inline-block',
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                  color: 'var(--aisbp-muted)',
                  marginBottom: '0.35rem',
                }}
              >
                STEP 4 — SLOT CAPACITY &amp; SAMPLE AVAILABILITY
              </span>
              <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.35rem' }}>
                Parallel bookings per slot (default 1)
                <input
                  type="number"
                  min={1}
                  value={booking.maxBookingsPerSlot}
                  onChange={e =>
                    setBooking({ ...booking, maxBookingsPerSlot: Math.max(1, Number(e.target.value) || 1) })
                  }
                  style={{ display: 'block', marginTop: '0.25rem', padding: '0.35rem', borderRadius: 8, maxWidth: 120 }}
                />
              </label>
              {capacityNote ? (
                <p style={{ fontSize: '0.76rem', color: 'var(--aisbp-muted)', margin: '0.35rem 0 0.5rem', lineHeight: 1.45 }}>
                  {capacityNote}
                </p>
              ) : null}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end', marginTop: '0.35rem' }}>
                <label style={{ fontSize: '0.78rem' }}>
                  Start date (optional)
                  <input
                    type="date"
                    value={slotStart}
                    onChange={e => setSlotStart(e.target.value)}
                    style={{ display: 'block', marginTop: '0.25rem', padding: '0.35rem', borderRadius: 8 }}
                  />
                </label>
                <label style={{ fontSize: '0.78rem' }}>
                  End date (optional)
                  <input
                    type="date"
                    value={slotEnd}
                    onChange={e => setSlotEnd(e.target.value)}
                    style={{ display: 'block', marginTop: '0.25rem', padding: '0.35rem', borderRadius: 8 }}
                  />
                </label>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void onTestSlots()}
                  style={{ padding: '0.45rem 0.75rem', borderRadius: 8, cursor: busy ? 'wait' : 'pointer' }}
                >
                  Check slot
                </button>
              </div>
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <span
                style={{
                  display: 'inline-block',
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                  color: 'var(--aisbp-muted)',
                  marginBottom: '0.35rem',
                }}
              >
                STEP 5 — BOOKING MODE &amp; FIELDS
              </span>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.35rem' }}>Booking mode</label>
              <select
                value={booking.bookingMode}
                onChange={e => setBooking({ ...booking, bookingMode: e.target.value as TenantBookingMode })}
                style={{ maxWidth: '100%', padding: '0.45rem 0.5rem', borderRadius: 8, marginBottom: '0.75rem' }}
              >
                {BOOKING_MODE_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>

              <p style={{ fontSize: '0.82rem', fontWeight: 600, margin: '0 0 0.5rem' }}>Core fields to collect</p>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                  gap: '0.35rem 0.75rem',
                  marginBottom: '1rem',
                }}
              >
                {CORE_FIELD_OPTS.map(f => (
                  <label key={f.key} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.85rem' }}>
                    <input
                      type="checkbox"
                      checked={booking.coreRequiredFieldsJson.includes(f.key)}
                      onChange={e => toggleCoreField(f.key, e.target.checked)}
                    />
                    {f.label}
                  </label>
                ))}
              </div>

              <p style={{ fontSize: '0.82rem', fontWeight: 600, margin: '0 0 0.5rem' }}>Custom questions</p>
              {booking.customFieldsJson.length === 0 ? (
                <p style={{ fontSize: '0.8rem', color: 'var(--aisbp-muted)', margin: '0 0 0.5rem' }}>
                  No custom questions yet.
                </p>
              ) : null}
              {booking.customFieldsJson.map(cf => (
                <div key={cf.id} style={{ ...cardStyle(), padding: '0.65rem 0.85rem' }}>
                  <input
                    value={cf.label}
                    onChange={e => updateCustomField(cf.id, { label: e.target.value })}
                    placeholder="Label"
                    style={{ width: '100%', padding: '0.35rem', borderRadius: 6, marginBottom: '0.35rem' }}
                  />
                  <input
                    value={cf.helpText ?? ''}
                    onChange={e => updateCustomField(cf.id, { helpText: e.target.value })}
                    placeholder="Help text (optional)"
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
                  {cf.fieldType === 'single_choice' ? (
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
              <button
                type="button"
                onClick={() => addCustomField()}
                style={{ marginBottom: '0.75rem', padding: '0.4rem 0.65rem', borderRadius: 8 }}
              >
                Add custom question
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

      {/* 3. Follow-up */}
      <SectionCard
        title="Follow-up"
        subtitle="Stored settings for future follow-up automation (scheduler not active yet)."
        accent="muted"
      >
        {followLoading || !followUp ? (
          <LoadingBlock />
        ) : (
          <>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.65rem' }}>
              <input
                type="checkbox"
                checked={followUp.enabled}
                onChange={e => setFollowUp({ ...followUp, enabled: e.target.checked })}
              />
              <span style={{ fontWeight: 600 }}>Enable follow-up assistant</span>
            </label>

            <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.65rem' }}>
              Maximum follow-ups (1–5)
              <select
                value={followUp.maxFollowUps}
                onChange={e => setFollowUp({ ...followUp, maxFollowUps: Number(e.target.value) })}
                style={{ display: 'block', marginTop: '0.25rem', padding: '0.4rem', borderRadius: 8 }}
              >
                {[1, 2, 3, 4, 5].map(n => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>

            <p style={{ fontSize: '0.82rem', fontWeight: 600, margin: '0 0 0.35rem' }}>Stop follow-up when</p>
            <div style={{ display: 'grid', gap: '0.35rem', marginBottom: '0.65rem', fontSize: '0.85rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <input
                  type="checkbox"
                  checked={followUp.stopOnCustomerReply}
                  onChange={e => setFollowUp({ ...followUp, stopOnCustomerReply: e.target.checked })}
                />
                Customer replies
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <input
                  type="checkbox"
                  checked={followUp.stopOnBookingCompleted}
                  onChange={e => setFollowUp({ ...followUp, stopOnBookingCompleted: e.target.checked })}
                />
                Booking completed
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <input
                  type="checkbox"
                  checked={followUp.stopOnEscalated}
                  onChange={e => setFollowUp({ ...followUp, stopOnEscalated: e.target.checked })}
                />
                Conversation escalated
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <input
                  type="checkbox"
                  checked={followUp.stopOnOptOut}
                  onChange={e => setFollowUp({ ...followUp, stopOnOptOut: e.target.checked })}
                />
                Customer says stop / not interested
              </label>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginBottom: '0.85rem', fontSize: '0.85rem' }}>
              <input
                type="checkbox"
                checked={followUp.businessHoursOnly}
                onChange={e => setFollowUp({ ...followUp, businessHoursOnly: e.target.checked })}
              />
              Business hours only (stored for future scheduling)
            </label>

            <p style={{ fontSize: '0.82rem', fontWeight: 600, margin: '0 0 0.5rem' }}>Follow-up sequence (max 5 steps)</p>
            {followUp.steps.map((step, idx) => (
              <div key={idx} style={cardStyle()}>
                <div style={{ fontSize: '0.78rem', fontWeight: 700, marginBottom: '0.35rem' }}>Step {step.stepNumber}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center', marginBottom: '0.35rem' }}>
                  <label style={{ fontSize: '0.78rem' }}>
                    After
                    <input
                      type="number"
                      min={1}
                      value={step.delayAmount}
                      onChange={e => updateFollowStep(idx, { delayAmount: Math.max(1, Number(e.target.value) || 1) })}
                      style={{ width: 72, marginLeft: '0.35rem', padding: '0.3rem', borderRadius: 6 }}
                    />
                  </label>
                  <select
                    value={step.delayUnit}
                    onChange={e =>
                      updateFollowStep(idx, { delayUnit: e.target.value as FollowUpStepSetting['delayUnit'] })
                    }
                    style={{ padding: '0.3rem', borderRadius: 6 }}
                  >
                    <option value="minutes">minutes</option>
                    <option value="hours">hours</option>
                    <option value="days">days</option>
                  </select>
                  <span style={{ fontSize: '0.78rem', color: 'var(--aisbp-muted)' }}>of no reply</span>
                </div>
                <label style={{ fontSize: '0.78rem', marginRight: '0.5rem' }}>
                  Mode{' '}
                  <select
                    value={step.mode}
                    onChange={e => updateFollowStep(idx, { mode: e.target.value as 'fixed' | 'ai' })}
                    style={{ padding: '0.3rem', borderRadius: 6 }}
                  >
                    <option value="fixed">Fixed message</option>
                    <option value="ai">AI-generated</option>
                  </select>
                </label>
                {step.mode === 'fixed' ? (
                  <textarea
                    value={step.fixedMessage ?? ''}
                    onChange={e => updateFollowStep(idx, { fixedMessage: e.target.value })}
                    placeholder="Fixed message"
                    rows={2}
                    style={{ width: '100%', marginTop: '0.35rem', padding: '0.35rem', borderRadius: 8 }}
                  />
                ) : (
                  <textarea
                    value={step.aiInstruction ?? ''}
                    onChange={e => updateFollowStep(idx, { aiInstruction: e.target.value })}
                    placeholder="Instruction for AI (stored only)"
                    rows={2}
                    style={{ width: '100%', marginTop: '0.35rem', padding: '0.35rem', borderRadius: 8 }}
                  />
                )}
                <label style={{ fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.35rem' }}>
                  <input
                    type="checkbox"
                    checked={step.enabled}
                    onChange={e => updateFollowStep(idx, { enabled: e.target.checked })}
                  />
                  Step enabled
                </label>
                <button type="button" onClick={() => removeFollowStep(idx)} style={{ marginTop: '0.35rem', fontSize: '0.78rem' }}>
                  Remove step
                </button>
              </div>
            ))}
            {followUp.steps.length < 5 ? (
              <button type="button" onClick={() => addFollowStep()} style={{ marginBottom: '0.75rem', padding: '0.4rem 0.65rem', borderRadius: 8 }}>
                Add step
              </button>
            ) : null}

            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void saveFollowUpModule()}
              style={{ padding: '0.5rem 1rem', borderRadius: 8, fontWeight: 600, cursor: busy ? 'wait' : 'pointer' }}
            >
              Save follow-up settings
            </button>
            {followBanner ? (
              <p style={{ marginTop: '0.65rem', fontSize: '0.85rem', color: 'var(--aisbp-muted)' }}>{followBanner}</p>
            ) : null}
          </>
        )}
      </SectionCard>

      {/* 4. Human escalation */}
      <SectionCard title="Human escalation" subtitle="Minimal status — more controls after Tags and Booking stabilize." accent="muted">
        <p style={{ fontSize: '0.84rem', color: 'var(--aisbp-text-secondary)', lineHeight: 1.55, margin: '0 0 0.65rem' }}>
          <strong>Status:</strong> Basic pause-for-review is available when escalation triggers fire.
        </p>
        <p style={{ fontSize: '0.84rem', color: 'var(--aisbp-text-secondary)', lineHeight: 1.55, margin: '0 0 0.65rem' }}>
          <strong>Team notification:</strong> Not active yet.
        </p>
        <p style={{ fontSize: '0.84rem', color: 'var(--aisbp-text-secondary)', lineHeight: 1.55, margin: 0 }}>
          We will revisit handover after Tags and Booking are stable.
        </p>
      </SectionCard>
    </div>
  );
}
