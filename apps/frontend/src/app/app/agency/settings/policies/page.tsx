'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { listAgencyPolicies, upsertAgencyPolicy, type AgencyPolicyRow } from '@/lib/api';
import {
  EmptyState,
  ErrorBanner,
  LoadingBlock,
  PageHeader,
  SectionCard,
  StatusPill,
  SuccessBanner,
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
  const [loadKey, setLoadKey] = useState(0);
  const [bootstrapErr, setBootstrapErr] = useState('');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async (preferredName?: string) => {
    if (!token || !user?.agencyId) return;
    const data = await listAgencyPolicies(token, user.agencyId);
    setRows(data);
    const pick = preferredName
      ? data.find(d => d.name === preferredName) ?? data[0]
      : data[0];
    if (pick) {
      setSelectedId(pick.id);
      setName(pick.name);
      setContent(pick.content);
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
    setOk('');
    setErr('');
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!token || !user?.agencyId) return;
    setErr('');
    setOk('');
    setSaving(true);
    try {
      await upsertAgencyPolicy(token, {
        agencyId: user.agencyId,
        name: name.trim() || 'default',
        content,
        isDefault: true,
      });
      setOk('Saved');
      await load(name.trim() || 'default');
    } catch (er) {
      setErr(er instanceof Error ? er.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader title="Master Prompt" eyebrow="Agency account" />
      <p style={{ fontSize: '0.83rem', color: '#64748b', margin: '0 0 1rem', lineHeight: 1.45, maxWidth: '40rem' }}>
        Global instructions for your agency: how replies are structured, spacing, formatting, and house rules. This layer is
        applied <strong>before</strong> each subaccount’s own bot instructions (persona, goals, and business context).
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

          <SectionCard title="Policy versions" subtitle="Select to edit.">
            {rows.length === 0 ? (
              <EmptyState title="No Master Prompt yet" detail="Create a “default” entry in the editor below." />
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

          <SectionCard title="Editor" subtitle="Plain text or markdown.">
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
                <p style={mvpFieldHint}>Identifier for this policy record.</p>
              </div>

              <div>
                <label style={mvpLabelStyle}>
                  Master Prompt
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

              <button
                type="submit"
                disabled={saving}
                style={{ ...mvpPrimaryButtonStyle, width: 'fit-content', opacity: saving ? 0.8 : 1 }}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </form>
          </SectionCard>
        </>
      )}
    </div>
  );
}
