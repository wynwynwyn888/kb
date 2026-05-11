'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState, type CSSProperties } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { updateWorkspaceClientProfile, updateWorkspaceSettings, type WorkspaceBotMode } from '@/lib/api';
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

const twoColGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))',
  gap: '1.1rem',
  alignItems: 'start',
};

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
    isAgencyWorkspace,
    clientContactName,
    clientContactPhone,
    clientContactEmail,
  } = useTenantSettings();

  const [nameDraft, setNameDraft] = useState('');
  const [nameSaving, setNameSaving] = useState(false);
  const [nameMsg, setNameMsg] = useState('');
  const [nameErr, setNameErr] = useState('');

  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactSaving, setContactSaving] = useState(false);
  const [contactMsg, setContactMsg] = useState('');
  const [contactErr, setContactErr] = useState('');

  useEffect(() => {
    setNameDraft((tenantName ?? '').trim() ? (tenantName ?? '') : '');
  }, [tenantName]);

  useEffect(() => {
    setContactName(clientContactName ?? '');
    setContactPhone(clientContactPhone ?? '');
    setContactEmail(clientContactEmail ?? '');
  }, [clientContactName, clientContactPhone, clientContactEmail]);

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

  const clientContactComplete = Boolean(
    (clientContactPhone && String(clientContactPhone).trim()) || (clientContactEmail && String(clientContactEmail).trim()),
  );
  const clientContactSummaryLabel = clientContactComplete ? 'Complete' : 'Missing';

  const onSaveContact = async () => {
    if (!token || !tenantId || !canRenameWorkspace) return;
    setContactSaving(true);
    setContactMsg('');
    setContactErr('');
    try {
      await updateWorkspaceClientProfile(token, tenantId, {
        clientContactName: contactName.trim() || null,
        clientContactPhone: contactPhone.trim() || null,
        clientContactEmail: contactEmail.trim() || null,
      });
      setContactMsg('Contact details saved.');
      emitTenantWorkspaceMetaChanged(tenantId);
      reload();
    } catch (e) {
      setContactErr(e instanceof Error ? e.message : 'Could not save contact details');
    } finally {
      setContactSaving(false);
    }
  };

  return (
    <div style={twoColGrid}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem', minWidth: 0 }}>
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

        {canRenameWorkspace && token && tenantId ? (
          <div id="workspace-details" style={{ scrollMarginTop: '1rem' }}>
            <SectionCard
              title="Workspace details"
              subtitle="Display name shown in the dashboard and workspace switcher."
              accent="muted"
            >
              {nameMsg ? <SuccessBanner message={nameMsg} /> : null}
              {nameErr ? (
                <p style={{ fontSize: '0.84rem', color: 'var(--aisbp-text, #b91c1c)', margin: '0 0 0.65rem' }}>{nameErr}</p>
              ) : null}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', maxWidth: '100%' }}>
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
                  {nameSaving ? 'Saving…' : 'Save name'}
                </button>
              </div>
            </SectionCard>
          </div>
        ) : null}

        {!isAgencyWorkspace && canRenameWorkspace && token && tenantId ? (
          <SectionCard
            title="Client contact details"
            subtitle="Used for low-credit alerts, account notes, and workspace records. You can update these details anytime."
            accent="muted"
          >
            {contactMsg ? <SuccessBanner message={contactMsg} /> : null}
            {contactErr ? (
              <p style={{ fontSize: '0.84rem', color: 'var(--aisbp-text, #b91c1c)', margin: '0 0 0.65rem' }}>{contactErr}</p>
            ) : null}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <label style={mvpLabelStyle}>
                Client contact name
                <input
                  value={contactName}
                  onChange={e => {
                    setContactName(e.target.value);
                    setContactMsg('');
                    setContactErr('');
                  }}
                  disabled={contactSaving}
                  autoComplete="off"
                  style={mvpInputStyle}
                />
              </label>
              <label style={mvpLabelStyle}>
                Client phone number
                <input
                  value={contactPhone}
                  onChange={e => {
                    setContactPhone(e.target.value);
                    setContactMsg('');
                    setContactErr('');
                  }}
                  disabled={contactSaving}
                  autoComplete="off"
                  style={mvpInputStyle}
                />
              </label>
              <label style={mvpLabelStyle}>
                Client email
                <input
                  type="email"
                  value={contactEmail}
                  onChange={e => {
                    setContactEmail(e.target.value);
                    setContactMsg('');
                    setContactErr('');
                  }}
                  disabled={contactSaving}
                  autoComplete="off"
                  style={mvpInputStyle}
                />
              </label>
              <button
                type="button"
                disabled={contactSaving}
                style={{ ...mvpPrimaryButtonStyle, width: 'fit-content' }}
                onClick={() => void onSaveContact()}
              >
                {contactSaving ? 'Saving…' : 'Save contact details'}
              </button>
            </div>
          </SectionCard>
        ) : null}

        {isAgencyWorkspace && canRenameWorkspace ? (
          <SectionCard
            title="Client contact details"
            subtitle="This internal agency workspace does not use client contact fields. Add contacts on each client workspace instead."
            accent="muted"
          >
            <p style={{ margin: 0, fontSize: '0.86rem', color: 'var(--aisbp-muted, #64748b)', lineHeight: 1.5 }}>
              Low-credit warning delivery uses the agency workspace CRM connection and the client contact details stored on
              each billable workspace.
            </p>
          </SectionCard>
        ) : null}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem', minWidth: 0 }}>
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
            <p style={{ fontSize: '0.84rem', color: 'var(--aisbp-text, #b91c1c)', margin: 0 }}>{ghlLoadErr}</p>
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

        <SectionCard title="Setup summary" subtitle="Quick overview of how this workspace is configured." accent="default">
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
              {
                label: 'Client contact',
                value: isAgencyWorkspace ? (
                  <span style={{ color: 'var(--aisbp-muted, #64748b)' }}>N/A (agency workspace)</span>
                ) : (
                  <StatusPill label={clientContactSummaryLabel} tone={clientContactComplete ? 'ok' : 'warn'} />
                ),
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
      </div>
    </div>
  );
}
