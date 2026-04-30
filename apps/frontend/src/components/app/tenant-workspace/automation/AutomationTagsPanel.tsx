'use client';

import type { CSSProperties } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import {
  createTenantTagRule,
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
  type TagRuleTestMatchResult,
  type TenantTagRule,
  type TenantTaggingSettings,
} from '@/lib/api';
import { ErrorBanner, LoadingBlock, SectionCard } from '@/components/app/mvp-ui';

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

function cardStyle(): CSSProperties {
  return {
    border: '1px solid var(--aisbp-border)',
    borderRadius: 10,
    padding: '0.85rem 1rem',
    marginBottom: '0.75rem',
    background: 'var(--aisbp-surface)',
  };
}

export function AutomationTagsPanel() {
  const params = useParams();
  const tenantId = params['tenantId'] as string;
  const { token } = useAuth();

  const [loadErr, setLoadErr] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [tagsLoading, setTagsLoading] = useState(true);
  const [tagging, setTagging] = useState<TenantTaggingSettings | null>(null);
  const [rules, setRules] = useState<TenantTagRule[]>([]);
  const [approvedTags, setApprovedTags] = useState<{ id?: string; name: string }[]>([]);
  const [tagsBanner, setTagsBanner] = useState('');
  const [kwDraft, setKwDraft] = useState<Record<string, string>>({});

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
    setTagsBanner('');
    try {
      const next = await patchTenantTaggingSettings(token, tenantId, {
        automaticTaggingEnabled: tagging.automaticTaggingEnabled,
      });
      setTagging(next);
      setTagsBanner('Saved.');
    } catch (e) {
      setTagsBanner(e instanceof Error ? e.message : 'Save failed');
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
    setTagsBanner('');
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
        ruleDescription: 'Describe when this CRM tag should apply.',
        crmTagName: approvedTags[0]?.name ?? 'tag',
        enabled: true,
        autoApply: false,
        matchMode: 'AI',
        confidenceThreshold: 'NORMAL',
        priority: 0,
        keywords: [],
      });
      setRules(prev => [...prev, rule]);
      setTagsBanner('Rule created — edit and save.');
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
    setTestMatchResult(null);
    try {
      const r = await testTenantTagRulesMatch(token, tenantId, { message: testMatchMsg.trim() });
      setTestMatchResult(r);
    } catch (e) {
      setTagsBanner(e instanceof Error ? e.message : 'Match request failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {loadErr ? <ErrorBanner message={loadErr} /> : null}

      <SectionCard
        title="Automatic tagging"
        subtitle="Rules define valid CRM tags only — the assistant cannot invent tags outside this list."
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
                Downstream automation uses enabled rules with Auto apply and passing confidence. Customer-facing replies never
                expose internal tags.
              </p>
              <div style={{ marginTop: '0.65rem' }}>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void saveTaggingToggle()}
                  style={{ padding: '0.45rem 0.85rem', borderRadius: 8, fontWeight: 600, cursor: busy ? 'wait' : 'pointer' }}
                >
                  Save
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
                No rules yet. Sync CRM tags, add a rule, then map it to a CRM tag name.
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
                {(rule.matchMode === 'KEYWORD' || rule.matchMode === 'HYBRID') && (
                  <>
                    <label style={{ fontSize: '0.78rem', display: 'block', marginBottom: '0.35rem' }}>
                      Keyword phrases (optional, one per line). Used before falling back to description tokens.
                    </label>
                    <textarea
                      value={kwDraft[rule.id] ?? rule.keywords.join('\n')}
                      onChange={e => setKwDraft(prev => ({ ...prev, [rule.id]: e.target.value }))}
                      placeholder="e.g. oily scalp&#10;dandruff"
                      rows={3}
                      style={{ width: '100%', padding: '0.4rem 0.5rem', borderRadius: 8, marginBottom: '0.5rem', fontSize: '0.85rem' }}
                    />
                  </>
                )}
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
                    Confidence threshold
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
                Shows which enabled rules align with a sample message and why. AI mode requires an agency OpenAI key.
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
                Run test
              </button>
              {testMatchResult ? (
                <div style={{ marginTop: '0.75rem', fontSize: '0.82rem' }}>
                  <p style={{ fontWeight: 600, margin: '0 0 0.35rem' }}>Matched rules</p>
                  {testMatchResult.hits.length === 0 ? (
                    <p style={{ color: 'var(--aisbp-muted)', margin: 0 }}>No scores returned.</p>
                  ) : (
                    <ul style={{ margin: 0, paddingLeft: '1.1rem', lineHeight: 1.5 }}>
                      {testMatchResult.hits.map(h => (
                        <li key={h.ruleId} style={{ marginBottom: '0.5rem' }}>
                          <strong>{h.ruleName}</strong> — {h.matchMode} — score {h.confidence} ({h.confidenceLabel})
                          {h.passesThreshold ? ' · passes threshold' : ' · below threshold'}
                          <div style={{ fontSize: '0.78rem', color: 'var(--aisbp-muted)' }}>{h.why}</div>
                        </li>
                      ))}
                    </ul>
                  )}
                  {testMatchResult.tagsToApply.length > 0 ? (
                    <p style={{ marginTop: '0.65rem' }}>
                      <strong>Tags that would apply (auto rules):</strong> {testMatchResult.tagsToApply.join(', ')}
                    </p>
                  ) : (
                    <p style={{ marginTop: '0.65rem', fontSize: '0.78rem', color: 'var(--aisbp-muted)' }}>
                      No CRM tags would be applied automatically for this sample (requires auto apply + threshold).
                    </p>
                  )}
                </div>
              ) : null}
            </div>

            <div style={cardStyle()}>
              <p style={{ fontSize: '0.82rem', fontWeight: 600, margin: '0 0 0.5rem' }}>Smoke test — apply tag to contact</p>
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
    </div>
  );
}
