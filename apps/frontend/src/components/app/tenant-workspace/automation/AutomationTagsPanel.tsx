'use client';

import type { CSSProperties } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import {
  createTenantCrmTag,
  createTenantTagRule,
  deleteTenantCrmTag,
  deleteTenantTagRule,
  getTenantTagRules,
  getTenantTaggingSettings,
  patchTenantTagRule,
  patchTenantTaggingSettings,
  syncTenantGhlTags,
  testIntentTagOnContact,
  testTenantTagRulesMatch,
  type TagConfidenceThreshold,
  type TagMatchMode,
  type TagRuleMatchHit,
  type TagRuleTestMatchResult,
  type TenantTagRule,
  type TenantTaggingSettings,
} from '@/lib/api';
import {
  EmptyState,
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

const MATCH_MODE_OPTS: { value: TagMatchMode; label: string; short: string }[] = [
  { value: 'AI', label: 'AI', short: 'AI' },
  { value: 'KEYWORD', label: 'Keyword', short: 'Keyword' },
  { value: 'HYBRID', label: 'Hybrid', short: 'Hybrid' },
];

const CONF_OPTS: { value: TagConfidenceThreshold; label: string }[] = [
  { value: 'LOW', label: 'Low' },
  { value: 'NORMAL', label: 'Normal' },
  { value: 'HIGH', label: 'High' },
];

function matchModeShort(mode: TagMatchMode): string {
  return MATCH_MODE_OPTS.find(o => o.value === mode)?.short ?? mode;
}

function confidenceLabelPretty(t: TagConfidenceThreshold): string {
  return CONF_OPTS.find(o => o.value === t)?.label ?? 'Normal';
}

function cardShell(): CSSProperties {
  return {
    border: '1px solid var(--aisbp-border)',
    borderRadius: 10,
    padding: '0.85rem 1rem',
    background: 'var(--aisbp-surface)',
  };
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

type ApprovedTag = { id?: string; name: string };

function tagOptionValue(t: ApprovedTag): string {
  if (t.id?.trim()) return `id:${t.id}`;
  return `name:${encodeURIComponent(t.name.trim())}`;
}

function parseTagOptionValue(v: string): { tagId?: string; tagName?: string } {
  if (v.startsWith('id:')) return { tagId: v.slice(3) };
  if (v.startsWith('name:')) return { tagName: decodeURIComponent(v.slice(5)) };
  return {};
}

export function AutomationTagsPanel() {
  const params = useParams();
  const tenantId = params['tenantId'] as string;
  const { token, user } = useAuth();
  const isAgencyStaff = Boolean(user?.agencyRole);

  const [loadErr, setLoadErr] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [tagsLoading, setTagsLoading] = useState(true);
  const [tagging, setTagging] = useState<TenantTaggingSettings | null>(null);
  const [rules, setRules] = useState<TenantTagRule[]>([]);
  const [approvedTags, setApprovedTags] = useState<ApprovedTag[]>([]);
  const [feedback, setFeedback] = useState('');
  const [kwDraft, setKwDraft] = useState<Record<string, string>>({});

  const [expandedRules, setExpandedRules] = useState<Record<string, boolean>>({});

  const [newTagName, setNewTagName] = useState('');
  const [deleteTagValue, setDeleteTagValue] = useState('');
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  const [testContactId, setTestContactId] = useState('');
  const [testTagName, setTestTagName] = useState('');
  const [testMatchMsg, setTestMatchMsg] = useState('');
  const [testMatchResult, setTestMatchResult] = useState<TagRuleTestMatchResult | null>(null);

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
      setLoadErr('');
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : 'Failed to load tagging settings');
    } finally {
      setTagsLoading(false);
    }
  }, [token, tenantId]);

  useEffect(() => {
    void loadTags();
  }, [loadTags]);

  const saveTaggingToggle = async () => {
    if (!token || !tenantId || !tagging) return;
    setBusy('save-tag-toggle');
    setFeedback('');
    try {
      const next = await patchTenantTaggingSettings(token, tenantId, {
        automaticTaggingEnabled: tagging.automaticTaggingEnabled,
      });
      setTagging(next);
      setFeedback('Saved.');
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(null);
    }
  };

  const updateLocalRule = (id: string, patch: Partial<TenantTagRule>) => {
    setRules(prev => prev.map(r => (r.id === id ? { ...r, ...patch } : r)));
  };

  const parseKeywords = (ruleId: string, rule: TenantTagRule): string[] => {
    const raw = kwDraft[ruleId] ?? rule.keywords.join('\n');
    return raw
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean);
  };

  const saveRule = async (rule: TenantTagRule) => {
    if (!token || !tenantId) return;
    setBusy(`save-rule-${rule.id}`);
    setFeedback('');
    try {
      const keywords =
        rule.matchMode === 'KEYWORD' || rule.matchMode === 'HYBRID' ? parseKeywords(rule.id, rule) : rule.keywords;
      const { rule: next } = await patchTenantTagRule(token, tenantId, rule.id, {
        enabled: rule.enabled,
        autoApply: rule.autoApply,
        ruleName: rule.ruleName,
        ruleDescription: rule.ruleDescription,
        keywords,
        crmTagId: rule.crmTagId,
        crmTagName: rule.crmTagName,
        matchMode: rule.matchMode,
        confidenceThreshold: rule.confidenceThreshold,
      });
      setRules(prev => prev.map(r => (r.id === next.id ? next : r)));
      setExpandedRules(prev => ({ ...prev, [rule.id]: false }));
      setFeedback('Rule saved.');
    } catch (e) {
      setExpandedRules(prev => ({ ...prev, [rule.id]: true }));
      setFeedback(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(null);
    }
  };

  const addRule = async () => {
    if (!token || !tenantId) return;
    setBusy('add-rule');
    setFeedback('');
    try {
      const { rule } = await createTenantTagRule(token, tenantId, {
        ruleName: 'New rule',
        ruleDescription: 'Describe when this CRM tag should apply.',
        crmTagName: approvedTags[0]?.name ?? 'tag',
        enabled: true,
        autoApply: false,
        matchMode: 'AI',
        confidenceThreshold: 'NORMAL',
        keywords: [],
      });
      setRules(prev => [...prev, rule]);
      setExpandedRules(prev => ({ ...prev, [rule.id]: true }));
      setFeedback('Rule created — edit and save.');
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : 'Create failed');
    } finally {
      setBusy(null);
    }
  };

  const removeRule = async (id: string) => {
    if (!token || !tenantId) return;
    if (!globalThis.confirm?.('Delete this rule?')) return;
    setBusy(`del-${id}`);
    setFeedback('');
    try {
      await deleteTenantTagRule(token, tenantId, id);
      setRules(prev => prev.filter(r => r.id !== id));
      setExpandedRules(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setFeedback('Rule deleted.');
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setBusy(null);
    }
  };

  const onSyncTags = async () => {
    if (!token || !tenantId) return;
    setBusy('sync-tags');
    setFeedback('');
    try {
      const r = await syncTenantGhlTags(token, tenantId);
      setApprovedTags(r.tags);
      if (r.error) setFeedback(`Synced with warning: ${r.error}`);
      else setFeedback(`Loaded ${r.tags.length} tags from CRM.`);
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : 'Sync failed');
    } finally {
      setBusy(null);
    }
  };

  const onCreateTag = async () => {
    if (!token || !tenantId) return;
    const name = newTagName.trim();
    if (!name) {
      setFeedback('Enter a tag name.');
      return;
    }
    const dup = approvedTags.some(t => t.name.trim().toLowerCase() === name.toLowerCase());
    if (dup) {
      setFeedback('That tag name already exists in your synced list.');
      return;
    }
    setBusy('create-tag');
    setFeedback('');
    try {
      await createTenantCrmTag(token, tenantId, { name });
      setNewTagName('');
      const r = await syncTenantGhlTags(token, tenantId);
      setApprovedTags(r.tags);
      setFeedback(r.error ? `Created — sync warning: ${r.error}` : 'Tag created and list refreshed.');
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : 'Create failed');
    } finally {
      setBusy(null);
    }
  };

  const requestDeleteTag = () => {
    if (!deleteTagValue.trim()) {
      setFeedback('Select a CRM tag to delete.');
      return;
    }
    setDeleteConfirmOpen(true);
    setDeleteConfirmText('');
  };

  const cancelDeleteTag = () => {
    setDeleteConfirmOpen(false);
    setDeleteConfirmText('');
  };

  const confirmDeleteTag = async () => {
    if (!token || !tenantId || deleteConfirmText.trim() !== 'DELETE') return;
    const parsed = parseTagOptionValue(deleteTagValue);
    setBusy('delete-tag');
    setFeedback('');
    try {
      await deleteTenantCrmTag(token, tenantId, parsed);
      setDeleteConfirmOpen(false);
      setDeleteConfirmText('');
      setDeleteTagValue('');
      const r = await syncTenantGhlTags(token, tenantId);
      setApprovedTags(r.tags);
      setFeedback(r.error ? `Deleted — sync warning: ${r.error}` : 'Tag deleted and list refreshed.');
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setBusy(null);
    }
  };

  const onTestTag = async () => {
    if (!token || !tenantId || !testContactId.trim() || !testTagName.trim()) {
      setFeedback('Enter a CRM contact ID and choose a tag.');
      return;
    }
    setBusy('test-tag');
    setFeedback('');
    try {
      const r = await testIntentTagOnContact(token, tenantId, {
        contactId: testContactId.trim(),
        tagName: testTagName.trim(),
      });
      setFeedback(r.success ? (r.message ?? 'OK') : (r.error ?? 'Failed'));
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : 'Test failed');
    } finally {
      setBusy(null);
    }
  };

  const onTestMatch = async () => {
    if (!token || !tenantId || !testMatchMsg.trim()) {
      setFeedback('Enter a sample customer message to test.');
      return;
    }
    setBusy('test-match');
    setTestMatchResult(null);
    try {
      const r = await testTenantTagRulesMatch(token, tenantId, { message: testMatchMsg.trim() });
      setTestMatchResult(r);
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : 'Match request failed');
    } finally {
      setBusy(null);
    }
  };

  const toggleRule = (id: string) => {
    setExpandedRules(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const expandAllRules = () => {
    setExpandedRules(prev => {
      const next = { ...prev };
      for (const r of rules) next[r.id] = true;
      return next;
    });
  };

  const collapseAllRules = () => setExpandedRules({});

  const dim = busy !== null;

  const renderMatchHit = (h: TagRuleMatchHit, index: number, total: number) => {
    const tag = h.crmTagName.trim() || '—';
    const conf = confidenceLabelPretty(h.confidenceLabel);
    const auto = h.autoApply ?? false;
    return (
      <div
        key={h.ruleId}
        style={{
          marginBottom: index < total - 1 ? '0.85rem' : 0,
          paddingBottom: index < total - 1 ? '0.85rem' : 0,
          borderBottom: index < total - 1 ? '1px solid var(--aisbp-border)' : 'none',
        }}
      >
        <div style={{ fontWeight: 700 }}>{h.ruleName || 'Untitled rule'}</div>
        <div style={{ fontSize: '0.82rem', marginTop: '0.25rem', lineHeight: 1.5 }}>
          <div>
            Tag: <span style={{ fontFamily: 'ui-monospace, monospace' }}>{tag}</span>
          </div>
          <div>Confidence: {conf}</div>
          <div style={{ color: 'var(--aisbp-muted)', marginTop: '0.25rem' }}>Reason: {h.why}</div>
          {auto ? (
            <div style={{ marginTop: '0.45rem', fontWeight: 650 }}>
              Would apply tag: <span style={{ fontFamily: 'ui-monospace, monospace' }}>{tag}</span>
            </div>
          ) : (
            <div style={{ marginTop: '0.45rem', fontWeight: 650, color: 'var(--aisbp-muted)' }}>Matched, but Auto apply is off.</div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {loadErr ? <ErrorBanner message={loadErr} /> : null}

      <SectionCard
        title="Automatic tagging"
        subtitle="Enable or disable automatic tagging for the active assistant profile. Tag rules reference synced CRM tags from the workspace connection."
        accent="default"
      >
        <p style={{ fontSize: '0.84rem', color: 'var(--aisbp-muted)', lineHeight: 1.55, margin: '0 0 0.85rem' }}>
          Tag rules currently apply across this workspace.
        </p>
        {tagsLoading || !tagging ? (
          <LoadingBlock />
        ) : (
          <>
            <label style={{ ...mvpLabelStyle, display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 650 }}>
              <input
                type="checkbox"
                checked={tagging.automaticTaggingEnabled}
                onChange={e => setTagging({ ...tagging, automaticTaggingEnabled: e.target.checked })}
              />
              Enable automatic tagging
            </label>
            <div style={{ marginTop: '0.65rem' }}>
              <button type="button" disabled={dim} onClick={() => void saveTaggingToggle()} style={btn('primary', dim)}>
                Save
              </button>
            </div>
          </>
        )}
      </SectionCard>

      <SectionCard
        title="CRM tags"
        subtitle="Workspace resource: synced from the connected CRM. Tag rules are saved under Assistant → Automation."
        accent="muted"
      >
        <p style={{ fontSize: '0.84rem', color: 'var(--aisbp-muted)', lineHeight: 1.55, margin: '0 0 0.85rem' }}>
          CRM tags are synced from the workspace connection. Tag rules currently apply across this workspace.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <button type="button" disabled={dim} onClick={() => void onSyncTags()} style={btn('secondary', dim)}>
            Sync CRM tags
          </button>

          <div style={{ ...cardShell(), display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end' }}>
            <label style={{ ...mvpLabelStyle, flex: '1 1 200px', margin: 0 }}>
              New tag name
              <input
                value={newTagName}
                onChange={e => setNewTagName(e.target.value)}
                placeholder="e.g. follow_up_needed"
                style={{ ...mvpInputStyle, marginTop: '0.35rem', width: '100%' }}
              />
            </label>
            <button type="button" disabled={dim || !newTagName.trim()} onClick={() => void onCreateTag()} style={btn('primary', dim || !newTagName.trim())}>
              Create tag
            </button>
          </div>

          <div style={cardShell()}>
            <label style={{ ...mvpLabelStyle, display: 'block', marginBottom: '0.35rem' }}>Delete tag</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
              <select
                value={deleteTagValue}
                onChange={e => {
                  setDeleteTagValue(e.target.value);
                  setDeleteConfirmOpen(false);
                  setDeleteConfirmText('');
                }}
                style={{ ...mvpSelectStyle, minWidth: 200, flex: '1 1 180px' }}
              >
                <option value="">— Select tag —</option>
                {approvedTags.map(t => (
                  <option key={`del-${tagOptionValue(t)}`} value={tagOptionValue(t)}>
                    {t.name}
                  </option>
                ))}
              </select>
              <button type="button" disabled={dim || !deleteTagValue} onClick={requestDeleteTag} style={btn('danger', dim || !deleteTagValue)}>
                Delete tag
              </button>
            </div>
            {deleteConfirmOpen ? (
              <div
                style={{
                  marginTop: '0.75rem',
                  padding: '0.75rem',
                  borderRadius: 8,
                  border: '1px solid var(--aisbp-border)',
                  background: 'var(--aisbp-card-subtle, #f8f9fb)',
                }}
              >
                <p style={{ margin: '0 0 0.5rem', fontSize: '0.84rem', lineHeight: 1.5 }}>
                  This will delete the tag from CRM. This may affect existing CRM contacts and automations. Type DELETE to confirm.
                </p>
                <input
                  value={deleteConfirmText}
                  onChange={e => setDeleteConfirmText(e.target.value)}
                  placeholder="DELETE"
                  style={{ ...mvpInputStyle, width: '100%', maxWidth: 280, marginBottom: '0.5rem' }}
                />
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <button type="button" onClick={cancelDeleteTag} style={btn('secondary', false)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={dim || deleteConfirmText.trim() !== 'DELETE'}
                    onClick={() => void confirmDeleteTag()}
                    style={btn('danger', dim || deleteConfirmText.trim() !== 'DELETE')}
                  >
                    Confirm delete
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Tag rules" subtitle="Each rule maps one approved CRM tag. If multiple rules match, all matching tags can apply." accent="default">
        {tagsLoading ? (
          <LoadingBlock />
        ) : (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem', alignItems: 'center' }}>
              <button type="button" disabled={dim} onClick={() => void addRule()} style={btn('primary', dim)}>
                Add rule
              </button>
              <button type="button" disabled={dim || rules.length === 0} onClick={expandAllRules} style={btn('secondary', dim || rules.length === 0)}>
                Expand all
              </button>
              <button type="button" disabled={dim || rules.length === 0} onClick={collapseAllRules} style={btn('secondary', dim || rules.length === 0)}>
                Collapse all
              </button>
            </div>

            {rules.length === 0 ? (
              <EmptyState
                title="No tag rules yet."
                detail="Add your first rule to let AISBP apply approved CRM tags automatically."
              />
            ) : (
              rules.map(rule => {
                const open = expandedRules[rule.id] ?? false;
                const mm = matchModeShort(rule.matchMode);
                const cf = confidenceLabelPretty(rule.confidenceThreshold);
                const headerSummary = `${mm} · ${cf} confidence`;
                const statusBits = [
                  rule.enabled ? 'Enabled' : 'Disabled',
                  rule.autoApply ? 'Auto apply' : 'Manual apply',
                ].join(' · ');

                return (
                  <div key={rule.id} style={{ ...cardShell(), marginBottom: '0.65rem', padding: 0, overflow: 'hidden' }}>
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => toggleRule(rule.id)}
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        padding: '0.75rem 1rem',
                        border: 'none',
                        background: open ? 'var(--aisbp-card-subtle, #f8fafc)' : 'transparent',
                        cursor: 'pointer',
                        font: 'inherit',
                        display: 'flex',
                        flexWrap: 'wrap',
                        alignItems: 'center',
                        gap: '0.5rem 1rem',
                      }}
                    >
                      <span style={{ fontWeight: 800, flex: '1 1 140px' }}>{rule.ruleName || 'Untitled rule'}</span>
                      <span style={{ fontSize: '0.78rem', color: 'var(--aisbp-muted)', flex: '1 1 180px' }}>
                        Tag:{' '}
                        <span style={{ fontFamily: 'ui-monospace, monospace', color: 'var(--aisbp-text)' }}>
                          {rule.crmTagName?.trim() || '—'}
                        </span>
                      </span>
                      <span style={{ fontSize: '0.78rem', color: 'var(--aisbp-muted)' }}>{headerSummary}</span>
                      <span style={{ fontSize: '0.78rem', color: 'var(--aisbp-muted)' }}>{statusBits}</span>
                      <span style={{ fontWeight: 700, color: '#2563eb', marginLeft: 'auto' }}>{open ? 'Collapse' : 'Expand'}</span>
                    </button>

                    {open ? (
                      <div style={{ padding: '0.75rem 1rem 1rem', borderTop: '1px solid var(--aisbp-border)' }}>
                        <label style={{ ...mvpLabelStyle, display: 'block' }}>
                          Rule name
                          <input
                            value={rule.ruleName}
                            onChange={e => updateLocalRule(rule.id, { ruleName: e.target.value })}
                            style={{ ...mvpInputStyle, marginTop: '0.35rem', width: '100%' }}
                          />
                        </label>
                        <label style={{ ...mvpLabelStyle, display: 'block', marginTop: '0.65rem' }}>
                          Description / when this tag should be applied
                          <textarea
                            value={rule.ruleDescription}
                            onChange={e => updateLocalRule(rule.id, { ruleDescription: e.target.value })}
                            rows={3}
                            style={{ ...mvpInputStyle, marginTop: '0.35rem', width: '100%', resize: 'vertical' }}
                          />
                        </label>
                        {(rule.matchMode === 'KEYWORD' || rule.matchMode === 'HYBRID') && (
                          <label style={{ ...mvpLabelStyle, display: 'block', marginTop: '0.65rem' }}>
                            Keyword phrases (optional, one per line)
                            <textarea
                              value={kwDraft[rule.id] ?? rule.keywords.join('\n')}
                              onChange={e => setKwDraft(prev => ({ ...prev, [rule.id]: e.target.value }))}
                              placeholder="e.g. oily scalp"
                              rows={3}
                              style={{ ...mvpInputStyle, marginTop: '0.35rem', width: '100%', resize: 'vertical', fontSize: '0.85rem' }}
                            />
                          </label>
                        )}
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                            gap: '0.65rem',
                            marginTop: '0.65rem',
                          }}
                        >
                          <label style={{ ...mvpLabelStyle }}>
                            CRM tag
                            <select
                              value={rule.crmTagName}
                              onChange={e => updateLocalRule(rule.id, { crmTagName: e.target.value })}
                              style={{ ...mvpSelectStyle, display: 'block', width: '100%', marginTop: '0.35rem' }}
                            >
                              <option value="">—</option>
                              {approvedTags.map(t => (
                                <option key={`${t.name}-${t.id ?? ''}`} value={t.name}>
                                  {t.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label style={{ ...mvpLabelStyle }}>
                            Match mode
                            <select
                              value={rule.matchMode}
                              onChange={e => updateLocalRule(rule.id, { matchMode: e.target.value as TagMatchMode })}
                              style={{ ...mvpSelectStyle, display: 'block', width: '100%', marginTop: '0.35rem' }}
                            >
                              {MATCH_MODE_OPTS.map(o => (
                                <option key={o.value} value={o.value}>
                                  {o.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label style={{ ...mvpLabelStyle }}>
                            Confidence threshold
                            <select
                              value={rule.confidenceThreshold}
                              onChange={e =>
                                updateLocalRule(rule.id, { confidenceThreshold: e.target.value as TagConfidenceThreshold })
                              }
                              style={{ ...mvpSelectStyle, display: 'block', width: '100%', marginTop: '0.35rem' }}
                            >
                              {CONF_OPTS.map(o => (
                                <option key={o.value} value={o.value}>
                                  {o.label}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                        <label style={{ ...mvpLabelStyle, display: 'flex', alignItems: 'center', gap: '0.45rem', marginTop: '0.65rem' }}>
                          <input
                            type="checkbox"
                            checked={rule.enabled}
                            onChange={e => updateLocalRule(rule.id, { enabled: e.target.checked })}
                          />
                          Enabled
                        </label>
                        <label style={{ ...mvpLabelStyle, display: 'flex', alignItems: 'center', gap: '0.45rem', marginTop: '0.35rem' }}>
                          <input
                            type="checkbox"
                            checked={rule.autoApply}
                            onChange={e => updateLocalRule(rule.id, { autoApply: e.target.checked })}
                          />
                          Auto apply
                        </label>
                        <div style={{ marginTop: '0.75rem', display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                          <button type="button" disabled={dim} onClick={() => void saveRule(rule)} style={btn('primary', dim)}>
                            Save rule
                          </button>
                          <button type="button" disabled={dim} onClick={() => void removeRule(rule.id)} style={btn('danger', dim)}>
                            Delete rule
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </>
        )}
      </SectionCard>

      <SectionCard
        title="Test classifier"
        subtitle="Paste a sample customer message to see which enabled tag rules would match."
        accent="muted"
      >
        <textarea
          value={testMatchMsg}
          onChange={e => setTestMatchMsg(e.target.value)}
          placeholder="Paste a customer message…"
          rows={4}
          style={{ ...mvpInputStyle, width: '100%', marginBottom: '0.65rem', resize: 'vertical' }}
        />
        <button type="button" disabled={dim} onClick={() => void onTestMatch()} style={btn('primary', dim)}>
          Run test
        </button>
        {testMatchResult ? (
          <div style={{ marginTop: '0.85rem', fontSize: '0.88rem' }}>
            <p style={{ fontWeight: 700, margin: '0 0 0.5rem' }}>Matched rules</p>
            {testMatchResult.hits.length === 0 ? (
              <p style={{ color: 'var(--aisbp-muted)', margin: 0 }}>No matching rules found.</p>
            ) : (
              <div>
                {testMatchResult.hits.map((h, i, arr) => renderMatchHit(h, i, arr.length))}
              </div>
            )}
          </div>
        ) : null}
      </SectionCard>

      {isAgencyStaff ? (
        <SectionCard
          title="Agency smoke test"
          subtitle="Agency-only tool. This applies the selected tag directly in GHL."
          accent="muted"
        >
          <p style={{ margin: '0 0 0.65rem', fontSize: '0.85rem', color: 'var(--aisbp-muted)', lineHeight: 1.45 }}>
            Apply a CRM tag to a test contact
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.65rem', alignItems: 'flex-end' }}>
            <label style={{ ...mvpLabelStyle, display: 'flex', flexDirection: 'column', gap: '0.35rem', minWidth: 200 }}>
              Contact ID
              <input
                value={testContactId}
                onChange={e => setTestContactId(e.target.value)}
                placeholder="CRM contact id"
                style={mvpInputStyle}
              />
            </label>
            <label style={{ ...mvpLabelStyle, display: 'flex', flexDirection: 'column', gap: '0.35rem', minWidth: 200 }}>
              CRM tag
              <select
                value={testTagName}
                onChange={e => setTestTagName(e.target.value)}
                style={mvpSelectStyle}
              >
                <option value="">—</option>
                {approvedTags.map(t => (
                  <option key={`smoke-${t.name}`} value={t.name}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" disabled={dim} onClick={() => void onTestTag()} style={btn('primary', dim)}>
              Apply test tag
            </button>
          </div>
        </SectionCard>
      ) : null}

      {feedback ? (
        <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--aisbp-muted)' }} role="status">
          {feedback}
        </p>
      ) : null}
    </div>
  );
}
