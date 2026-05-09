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
import {
  assistantProfileSetupLabel,
  clientAiRepliesShortLabel,
  clientCrmStatusSummary,
  crmLastCheckedIso,
  formatWorkspaceSettingsDateTime,
  ghlLocationDisplayLabel,
  knowledgeSetupLabel,
  replyStyleLabelFromTemperature,
} from '@/lib/workspace-settings-display';
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
    botMode,
    promptConfigSnap,
    ghl,
    ghlLoadErr,
    canRenameWorkspace,
    knowledgeSetupStatus,
  } = useTenantSettings();

  const [nameDraft, setNameDraft] = useState('');
  const [nameSaving, setNameSaving] = useState(false);
  const [nameMsg, setNameMsg] = useState('');
  const [nameErr, setNameErr] = useState('');

  useEffect(() => {
    setNameDraft((tenantName ?? '').trim() ? (tenantName ?? '') : '');
  }, [tenantName]);

  const aiSummary = clientAiRepliesShortLabel(botMode);
  const replyStyleSummary =
    promptConfigSnap != null ? replyStyleLabelFromTemperature(Number(promptConfigSnap.temperature)) : 'Needs setup';
  const crmSummary = ghl && !ghlLoadErr ? clientCrmStatusSummary(ghl) : ghlLoadErr ? 'Could not load' : 'Not connected';
  const crmPillTone =
    ghl && !ghlLoadErr
      ? ghl.status === 'CONNECTED'
        ? 'ok'
        : ghl.status === 'DISCONNECTED'
          ? 'neutral'
          : 'warn'
      : 'neutral';

  const crmCardTitle = ghl && !ghlLoadErr && ghl.status === 'CONNECTED' ? 'Connected CRM' : 'CRM Connection';

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
          <SectionCard
            title={crmCardTitle}
            subtitle={
              ghl && !ghlLoadErr && ghl.status === 'CONNECTED'
                ? 'This workspace is connected to its CRM location and ready for live delivery.'
                : 'Link a CRM location so conversations and automations can run end-to-end.'
            }
            accent="muted"
          >
            {ghlLoadErr ? (
              <p style={{ fontSize: '0.84rem', color: '#b91c1c', margin: 0 }}>{ghlLoadErr}</p>
            ) : ghl ? (
              <div>
                <KeyValueRows
                  rows={[
                    {
                      label: 'Status',
                      value: <StatusPill label={crmSummary} tone={crmPillTone} />,
                    },
                    {
                      label: 'Location',
                      value: ghlLocationDisplayLabel(ghl),
                    },
                    {
                      label: 'Last checked',
                      value: formatWorkspaceSettingsDateTime(crmLastCheckedIso(ghl)),
                    },
                  ]}
                />
                <div style={{ marginTop: '0.85rem' }}>
                  <Link href={`${base}/ghl-status`} style={appFloatingSecondaryButtonStyle}>
                    Manage CRM connection
                  </Link>
                </div>
              </div>
            ) : (
              <p style={{ fontSize: '0.84rem', color: 'var(--aisbp-muted, #64748b)', margin: 0 }}>
                No CRM connection has been saved for this workspace yet.
              </p>
            )}
          </SectionCard>
        </div>
      </div>

      {canRenameWorkspace && token && tenantId ? (
        <div id="workspace-details" style={{ scrollMarginTop: '1rem', marginBottom: '1.1rem' }}>
          <SectionCard title="Workspace details" subtitle="Update the display name shown inside this dashboard." accent="muted">
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
                    setNameMsg('Changes saved.');
                    emitTenantWorkspaceMetaChanged(tenantId);
                    reload();
                  } catch (e) {
                    setNameErr(e instanceof Error ? e.message : 'Could not save name');
                  } finally {
                    setNameSaving(false);
                  }
                }}
              >
                {nameSaving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </SectionCard>
        </div>
      ) : null}

      <SectionCard title="Setup summary" subtitle="How this workspace looks at a glance." accent="default">
        <KeyValueRows
          rows={[
            {
              label: 'Assistant profile',
              value: assistantProfileSetupLabel(promptConfigSnap),
            },
            {
              label: 'AI replies',
              value: aiSummary,
            },
            {
              label: 'CRM',
              value: crmSummary,
            },
            {
              label: 'Knowledge vaults',
              value: knowledgeSetupLabel(knowledgeSetupStatus),
            },
            {
              label: 'Reply style',
              value: replyStyleSummary,
            },
          ]}
        />
        <div style={{ marginTop: '0.85rem', display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
          <Link href={`${base}/assistant`} style={appFloatingSecondaryButtonStyle}>
            Assistant
          </Link>
          <Link href={`${base}/knowledge-vaults`} style={appFloatingSecondaryButtonStyle}>
            Knowledge vaults
          </Link>
        </div>
      </SectionCard>
    </>
  );
}
