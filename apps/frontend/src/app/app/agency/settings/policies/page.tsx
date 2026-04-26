'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  deleteAgencyPolicy,
  listAgencyPolicies,
  upsertAgencyPolicy,
  type AgencyPolicyRow,
} from '@/lib/api';
import {
  EmptyState,
  ErrorBanner,
  LoadingBlock,
  PageHeader,
  SectionCard,
  StatusPill,
  SuccessBanner,
  mvpButtonStyle,
  mvpFieldHint,
  mvpInputStyle,
  mvpLabelStyle,
  mvpPrimaryButtonStyle,
} from '@/components/app/mvp-ui';

export default function AgencyPoliciesPage() {
  const { token, user } = useAuth();
  const [rows, setRows] = useState<AgencyPolicyRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState('default');
  const [content, setContent] = useState('');
  const [priority, setPriority] = useState(0);
  const [isDefault, setIsDefault] = useState(true);
  const [loadKey, setLoadKey] = useState(0);
  const [bootstrapErr, setBootstrapErr] = useState('');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async (opts?: { preferredId?: string; preferredName?: string }) => {
    if (!token || !user?.agencyId) return;
    const data = await listAgencyPolicies(token, user.agencyId);
    setRows(data);
    const pick =
      opts?.preferredId != null && opts.preferredId.trim()
        ? (data.find(d => d.id === opts.preferredId) ?? data[0])
        : opts?.preferredName != null
          ? (data.find(d => d.name === opts.preferredName) ?? data[0])
          : data[0];
    if (pick) {
      setSelectedId(pick.id);
      setName(pick.name);
      setContent(pick.content);
      setPriority(pick.priority ?? 0);
      setIsDefault(!!pick.isDefault);
    } else {
      setSelectedId(null);
    }
  };

  useEffect(() => {
    if (!token || !user?.agencyId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setBootstrapErr('');
      try {
        await load();
      } catch (e) {
        if (!cancelled) setBootstrapErr(e instanceof Error ? e.message : 'Failed to load policies');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, user?.agencyId, loadKey]);

  const selectPolicy = (r: AgencyPolicyRow) => {
    setSelectedId(r.id);
    setName(r.name);
    setContent(r.content);
    setPriority(r.priority ?? 0);
    setIsDefault(!!r.isDefault);
    setOk('');
    setErr('');
  };

  const onDeletePolicy = async () => {
    if (!token || !user?.agencyId || !selectedId) return;
    if (!window.confirm('Delete this prompt version? Workspaces will no longer receive these instructions if this version is active.')) return;
    setErr('');
    setOk('');
    setSaving(true);
    try {
      await deleteAgencyPolicy(token, user.agencyId, selectedId);
      setOk('Prompt version deleted');
      setSelectedId(null);
      await load();
    } catch (er) {
      setErr(er instanceof Error ? er.message : 'Delete failed');
    } finally {
      setSaving(false);
    }
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!token || !user?.agencyId) return;
    setErr('');
    setOk('');
    setSaving(true);
    try {
      const saved = await upsertAgencyPolicy(token, {
        agencyId: user.agencyId,
        name: name.trim() || 'default',
        content,
        priority: Number.isFinite(priority) ? Math.trunc(priority) : 0,
        isDefault,
        ...(selectedId ? { policyId: selectedId } : {}),
      });
      setOk('Prompt saved');
      await load({ preferredId: saved.id });
    } catch (er) {
      setErr(er instanceof Error ? er.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader title="Global Prompt" eyebrow="Agency account" />
      <p style={{ fontSize: '0.83rem', color: '#64748b', margin: '0 0 1rem', lineHeight: 1.45, maxWidth: '40rem' }}>
        Set the agency-wide reply standards applied before each workspace’s own bot instructions.
      </p>

      {loading ? (
        <LoadingBlock message="Loading…" />
      ) : bootstrapErr ? (
        <div style={{ marginBottom: '1rem' }}>
          <ErrorBanner message={bootstrapErr} />
          <button
            type="button"
            onClick={() => {
              setBootstrapErr('');
              setLoadKey(k => k + 1);
            }}
            style={{
              marginTop: '0.5rem',
              padding: '0.4rem 0.75rem',
              borderRadius: '6px',
              border: '1px solid #ccc',
              background: '#fff',
              cursor: 'pointer',
              fontSize: '0.85rem',
            }}
          >
            Retry
          </button>
        </div>
      ) : (
        <>
          {err && <ErrorBanner message={err} />}
          {ok && <SuccessBanner message={ok} />}

          <SectionCard title="Prompt versions" subtitle="Select a version to edit.">
            {rows.length === 0 ? (
              <EmptyState title="No Global Prompt yet" detail="Create your first prompt version below." />
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {rows.map(r => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => selectPolicy(r)}
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        padding: '0.65rem 0.75rem',
                        borderRadius: '8px',
                        border: selectedId === r.id ? '2px solid #2563eb' : '1px solid #e5e5e5',
                        background: selectedId === r.id ? '#eff6ff' : '#fafafa',
                        boxShadow: selectedId === r.id ? '0 0 0 3px rgba(37, 99, 235, 0.1)' : 'none',
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', alignItems: 'center' }}>
                        <strong style={{ fontSize: '0.9rem' }}>{r.name}</strong>
                        {r.isDefault ? <StatusPill label="Default" tone="ok" /> : null}
                        {r.priority != null ? (
                          <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Priority {r.priority}</span>
                        ) : null}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard title="Prompt editor" subtitle="Plain text or markdown.">
            <form onSubmit={onSubmit} style={{ maxWidth: '720px', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={mvpLabelStyle}>
                  Name
                  <input
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="default"
                    autoComplete="off"
                    style={mvpInputStyle}
                  />
                </label>
                <p style={mvpFieldHint}>Internal name for this prompt version.</p>
              </div>

              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '1.25rem',
                  alignItems: 'flex-end',
                }}
              >
                <label style={mvpLabelStyle}>
                  Priority
                  <input
                    type="number"
                    value={Number.isFinite(priority) ? priority : 0}
                    onChange={e => setPriority(parseInt(e.target.value, 10) || 0)}
                    min={0}
                    step={1}
                    style={{ ...mvpInputStyle, maxWidth: '8rem' }}
                  />
                </label>
                <label
                  style={{
                    ...mvpLabelStyle,
                    display: 'flex',
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: '0.5rem',
                    cursor: 'pointer',
                    marginBottom: '0.35rem',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isDefault}
                    onChange={e => setIsDefault(e.target.checked)}
                  />
                  <span>Use as default</span>
                </label>
                <p style={{ ...mvpFieldHint, flex: '1 1 100%', margin: 0 }}>
                  When multiple prompts exist, the highest priority becomes active.
                </p>
              </div>

              <div>
                <label style={mvpLabelStyle}>
                  Prompt instructions
                  <textarea
                    value={content}
                    onChange={e => setContent(e.target.value)}
                    rows={14}
                    placeholder="e.g. how to open/close replies, list style, tone guardrails, channel-safe formatting…"
                    style={{
                      ...mvpInputStyle,
                      fontFamily: 'inherit',
                      lineHeight: 1.5,
                      resize: 'vertical',
                      minHeight: '200px',
                    }}
                  />
                </label>
                <p style={mvpFieldHint}>
                  {content.length} characters
                </p>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
                <button
                  type="submit"
                  disabled={saving}
                  style={{ ...mvpPrimaryButtonStyle, width: 'fit-content', opacity: saving ? 0.8 : 1 }}
                >
                  {saving ? 'Saving…' : 'Save prompt'}
                </button>
                {selectedId ? (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={onDeletePolicy}
                    style={{
                      ...mvpButtonStyle,
                      borderColor: '#fecaca',
                      color: '#b91c1c',
                      background: '#fef2f2',
                      cursor: saving ? 'not-allowed' : 'pointer',
                      opacity: saving ? 0.7 : 1,
                    }}
                  >
                    Delete version
                  </button>
                ) : null}
              </div>
            </form>
          </SectionCard>
        </>
      )}
    </div>
  );
}
