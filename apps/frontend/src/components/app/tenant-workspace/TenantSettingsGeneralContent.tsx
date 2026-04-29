'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { updateWorkspaceSettings, type WorkspaceBotMode } from '@/lib/api';
import { emitTenantWorkspaceMetaChanged } from '@/lib/workspace-events';
import {
  KeyValueRows,
  SectionCard,
  StatusPill,
  SuccessBanner,
  appFloatingSecondaryButtonStyle,
  mvpInputStyle,
  mvpLabelStyle,
  mvpPrimaryButtonStyle,
} from '@/components/app/mvp-ui';
import { WorkspaceBotModeSection } from './WorkspaceBotModeSection';
import { useTenantSettings } from './tenant-settings-context';

export function TenantSettingsGeneralContent() {
  const params = useParams();
  const tenantId = params['tenantId'] as string;
  const { token } = useAuth();
  const {
    base,
    reload,
    tenantName,
    tenantStatus,
    botMode,
    promptConfigSnap,
    ghl,
    ghlLoadErr,
    canRenameWorkspace,
  } = useTenantSettings();

  const [nameDraft, setNameDraft] = useState('');
  const [nameSaving, setNameSaving] = useState(false);
  const [nameMsg, setNameMsg] = useState('');
  const [nameErr, setNameErr] = useState('');

  useEffect(() => {
    setNameDraft((tenantName ?? '').trim() ? (tenantName ?? '') : '');
  }, [tenantName]);

  const aiModeLabel = botMode === 'off' ? 'Off' : botMode === 'suggestive' ? 'Suggestive' : 'Auto';

  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.1rem', alignItems: 'stretch', marginBottom: '1.1rem' }}>
        <div style={{ flex: '2 1 340px', minWidth: 0 }}>
          {token && tenantId ? (
            <WorkspaceBotModeSection
              mode={botMode}
              disabled={!token}
              onChange={async (m: WorkspaceBotMode) => {
                await updateWorkspaceSettings(token, tenantId, { botMode: m });
                reload();
              }}
            />
          ) : null}
        </div>
        <div style={{ flex: '1 1 280px', minWidth: 0 }}>
          <SectionCard title="CRM connection" subtitle="Connection status and saved location for this workspace." accent="muted">
            {ghlLoadErr ? (
              <p style={{ fontSize: '0.84rem', color: '#b91c1c', margin: 0 }}>{ghlLoadErr}</p>
            ) : ghl ? (
              <div>
                <KeyValueRows
                  rows={[
                    {
                      label: 'Status',
                      value: (
                        <StatusPill
                          label={ghl.status}
                          tone={ghl.status === 'CONNECTED' ? 'ok' : ghl.status === 'DISCONNECTED' ? 'neutral' : 'warn'}
                        />
                      ),
                    },
                    { label: 'Location', value: ghl.ghlLocationId?.trim() ? 'Saved' : 'Not saved' },
                    { label: 'Verified', value: ghl.verifiedAt ? ghl.verifiedAt : '—' },
                  ]}
                />
                <div style={{ marginTop: '0.85rem' }}>
                  <Link href={`${base}/ghl-status`} style={appFloatingSecondaryButtonStyle}>
                    Manage CRM
                  </Link>
                </div>
              </div>
            ) : (
              <p style={{ fontSize: '0.84rem', color: 'var(--aisbp-muted, #64748b)', margin: 0 }}>CRM is not connected yet.</p>
            )}
          </SectionCard>
        </div>
      </div>

      {canRenameWorkspace && token && tenantId ? (
        <div id="workspace-rename" style={{ scrollMarginTop: '1rem', marginBottom: '1.1rem' }}>
          <SectionCard title="Workspace name" subtitle="Renaming is limited to agency staff so client-facing lists stay tidy." accent="muted">
            {nameMsg ? <SuccessBanner message={nameMsg} /> : null}
            {nameErr ? <p style={{ fontSize: '0.84rem', color: '#b91c1c', margin: '0 0 0.65rem' }}>{nameErr}</p> : null}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', maxWidth: '420px' }}>
              <label style={mvpLabelStyle}>
                Display name
                <input
                  type="text"
                  value={nameDraft}
                  onChange={e => {
                        setNameDraft(e.target.value);
                        setNameMsg('');
                        setNameErr('');
                      }}
                  disabled={nameSaving}
                  autoComplete="off"
                  style={mvpInputStyle}
                  aria-label="Workspace display name"
                />
              </label>
              <button
                type="button"
                disabled={nameSaving || !nameDraft.trim() || nameDraft.trim() === (tenantName ?? '').trim()}
                style={{ ...mvpPrimaryButtonStyle, width: 'fit-content', opacity: nameSaving ? 0.85 : 1 }}
                onClick={async () => {
                  if (!token || !nameDraft.trim()) return;
                  setNameSaving(true);
                  setNameMsg('');
                  setNameErr('');
                  try {
                    const updated = await updateWorkspaceSettings(token, tenantId, {
                      name: nameDraft.trim(),
                    });
                    setNameDraft(updated.name);
                    setNameMsg('Workspace name saved.');
                    emitTenantWorkspaceMetaChanged(tenantId);
                    reload();
                  } catch (e) {
                    setNameErr(e instanceof Error ? e.message : 'Could not save name');
                  } finally {
                    setNameSaving(false);
                  }
                }}
              >
                {nameSaving ? 'Saving…' : 'Save name'}
              </button>
            </div>
          </SectionCard>
        </div>
      ) : null}

      <SectionCard title="Bot status" subtitle="Details for this workspace." accent="default">
        <KeyValueRows
          rows={[
            { label: 'Workspace', value: tenantName ?? '—' },
            {
              label: 'Account',
              value: tenantStatus ? <StatusPill label={tenantStatus} tone="neutral" /> : '—',
            },
            {
              label: 'AI mode',
              value: <StatusPill label={aiModeLabel} tone={botMode === 'off' ? 'neutral' : 'ok'} />,
            },
            {
              label: 'Bot instructions',
              value: promptConfigSnap ? `${promptConfigSnap.name}${promptConfigSnap.isActive ? ' (active)' : ''}` : 'Not configured yet',
            },
            {
              label: 'Reply style',
              value: promptConfigSnap != null ? String(promptConfigSnap.temperature) : '—',
            },
            {
              label: 'Model override',
              value: promptConfigSnap?.modelOverride?.trim() || '—',
            },
          ]}
        />
        <div style={{ marginTop: '0.85rem' }}>
          <Link href={`${base}/goals`} style={appFloatingSecondaryButtonStyle}>
            Open bot instructions
          </Link>
        </div>
      </SectionCard>

      <div style={{ marginTop: '1rem' }}>
        <SectionCard title="Automation" subtitle="Configure CRM tags, booking calendar, and escalation behavior." accent="muted">
          <Link href={`${base}/settings/automation`} style={appFloatingSecondaryButtonStyle}>
            Open automation settings
          </Link>
        </SectionCard>
      </div>
    </>
  );
}
