'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import {
  getAgencyAiConfig,
  listTenantBotProfiles,
  listKbVaults,
  createTenantBotProfile,
  updateTenantBotProfile,
  activateTenantBotProfile,
  duplicateTenantBotProfile,
  deleteTenantBotProfile,
  type KbVaultRow,
  type SubaccountBehaviorPolicy,
  type TenantBotProfileRow,
} from '@/lib/api';
import {
  KNOWLEDGE_ACCESS_ALL_VAULTS,
  KNOWLEDGE_ACCESS_SELECTED_VAULTS,
  KNOWLEDGE_SCOPE_ALL_WORKSPACE,
  activeAssistantVaultsSummary,
  formatProfileUpdatedAt,
} from '@/lib/assistant-profiles-ui';
import {
  ErrorBanner,
  LoadingBlock,
  PageHeader,
  SuccessBanner,
  mvpFieldHint,
  mvpInputStyle,
  mvpLabelStyle,
  mvpPrimaryButtonStyle,
} from '@/components/app/mvp-ui';
import { countWords } from '@/lib/prompt-text-stats';

const DEFAULT_NEW_PROFILE = 'New profile';

const textareaStyle = {
  ...mvpInputStyle,
  minHeight: '96px',
  resize: 'vertical' as const,
  fontFamily: 'inherit',
  fontSize: '0.9rem',
  lineHeight: 1.45,
  whiteSpace: 'pre-wrap' as const,
  overflowWrap: 'break-word' as const,
};

const LIVE_DELETE_HINT = 'Set another profile active before deleting this one.';

const sectionCard: CSSProperties = {
  border: '1px solid rgba(226, 232, 240, 0.9)',
  borderRadius: 12,
  padding: '1.05rem 1.15rem',
  marginBottom: '1.15rem',
  background: 'var(--aisbp-surface, #fff)',
  boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
};

const expandModalOverlay: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(15, 23, 42, 0.48)',
  zIndex: 60,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
};

const expandModalPanel: CSSProperties = {
  background: 'var(--aisbp-modal-bg, #fff)',
  borderRadius: 16,
  width: 'min(720px, 100%)',
  maxHeight: 'min(82vh, 640px)',
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
  maxWidth: '100%',
  boxShadow: '0 24px 48px rgba(15, 23, 42, 0.2)',
  border: '1px solid var(--aisbp-modal-border, #e2e8f0)',
};

const sectionTitleStyle: CSSProperties = {
  fontSize: '0.95rem',
  fontWeight: 700,
  margin: '0 0 0.75rem',
  color: 'var(--aisbp-text-heading, #0f172a)',
};

const expandTextBtn: CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: 'var(--aisbp-text-secondary, #334155)',
  fontSize: '0.8rem',
  fontWeight: 600,
  cursor: 'pointer',
  textDecoration: 'underline',
  textUnderlineOffset: 2,
  padding: '0.15rem 0.25rem',
};

const secondaryBtnStyle: CSSProperties = {
  padding: '0.45rem 0.85rem',
  borderRadius: '8px',
  border: '1px solid rgba(226, 232, 240, 0.95)',
  background: 'var(--aisbp-surface, #fff)',
  color: 'var(--aisbp-text-secondary, #334155)',
  fontSize: '0.85rem',
  fontWeight: 600,
  cursor: 'pointer',
};

const deleteBtnStyle: CSSProperties = {
  padding: '0.32rem 0.5rem',
  borderRadius: '6px',
  border: 'none',
  background: 'transparent',
  color: 'var(--aisbp-muted, #94a3b8)',
  fontSize: '0.78rem',
  fontWeight: 500,
  cursor: 'pointer',
};

function profileListCardStyle(selected: boolean): CSSProperties {
  return {
    padding: '0.75rem 0.85rem',
    borderRadius: 12,
    border: '1px solid rgba(226, 232, 240, 0.92)',
    borderLeftWidth: 3,
    borderLeftStyle: 'solid',
    borderLeftColor: selected ? 'rgba(37, 99, 235, 0.65)' : 'transparent',
    background: selected ? 'rgba(248, 250, 252, 0.98)' : 'var(--aisbp-surface, #fff)',
    boxShadow: selected ? '0 1px 4px rgba(15, 23, 42, 0.05)' : '0 1px 2px rgba(15, 23, 42, 0.03)',
  };
}

function LiveBadge({ large }: { large?: boolean }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: large ? '0.28rem 0.65rem' : '0.15rem 0.5rem',
        borderRadius: '8px',
        fontSize: large ? '0.8rem' : '0.72rem',
        fontWeight: 800,
        letterSpacing: '0.03em',
        background: 'rgba(34, 197, 94, 0.18)',
        color: 'rgb(21, 128, 61)',
        border: '1px solid rgba(34, 197, 94, 0.45)',
      }}
    >
      Live
    </span>
  );
}

function DraftBadge() {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '0.15rem 0.5rem',
        borderRadius: '8px',
        fontSize: '0.72rem',
        fontWeight: 700,
        letterSpacing: '0.02em',
        background: 'var(--aisbp-stat-tile-bg, #f1f5f9)',
        color: 'var(--aisbp-muted, #64748b)',
      }}
    >
      Draft
    </span>
  );
}

const TEMP_PRESETS = { precise: 0.35, balanced: 0.7, creative: 1.2 } as const;
type TempPreset = keyof typeof TEMP_PRESETS;

const LENGTH_PRESETS = [
  { value: '400', tokens: 400, label: 'Shorter (~400 tokens)' },
  { value: '800', tokens: 800, label: 'Balanced (~800 tokens)' },
  { value: '1500', tokens: 1500, label: 'Longer (~1500 tokens)' },
  { value: 'custom', tokens: 0, label: 'Custom' },
] as const;

function inferLengthKey(n: number): (typeof LENGTH_PRESETS)[number]['value'] {
  const targets = [400, 800, 1500] as const;
  let best: (typeof LENGTH_PRESETS)[number]['value'] = 'custom';
  let bestDiff = Infinity;
  for (const t of targets) {
    const d = Math.abs(n - t);
    if (d < bestDiff) {
      bestDiff = d;
      best = String(t) as (typeof LENGTH_PRESETS)[number]['value'];
    }
  }
  if (bestDiff > 350) return 'custom';
  return best;
}

function defaultPolicy(): SubaccountBehaviorPolicy {
  return {
    temperatureMin: 0,
    temperatureMax: 2,
    maxTokensMin: 200,
    maxTokensMax: 4000,
    allowModelOverride: true,
    allowResponseStyleOverride: true,
    allowMaxTokensOverride: true,
  };
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function numToPreset(n: number): TempPreset {
  if (!Number.isFinite(n)) return 'balanced';
  if (n <= 0.5) return 'precise';
  if (n >= 0.95) return 'creative';
  return 'balanced';
}

function sortVaultIds(ids: string[]): string[] {
  return [...ids].filter(Boolean).sort();
}

type FormBaseline = {
  profileName: string;
  description: string;
  persona: string;
  goals: string;
  additional: string;
  toneRules: string;
  bookingBehaviorNotes: string;
  escalationBehaviorNotes: string;
  knowledgeScopeNotes: string;
  knowledgeAccessMode: string;
  selectedVaultIds: string[];
  tempPreset: TempPreset;
  modelOverride: string;
  maxTokens: number;
};

function rowToBaseline(row: TenantBotProfileRow): FormBaseline {
  const mt = row.maxTokens != null && row.maxTokens > 0 ? row.maxTokens : 800;
  const access =
    row.knowledgeAccessMode?.trim() === KNOWLEDGE_ACCESS_SELECTED_VAULTS
      ? KNOWLEDGE_ACCESS_SELECTED_VAULTS
      : KNOWLEDGE_ACCESS_ALL_VAULTS;
  return {
    profileName: row.name,
    description: row.description ?? '',
    persona: row.persona ?? '',
    goals: row.conversationGoals ?? '',
    additional: row.businessNotes ?? '',
    toneRules: row.toneRules ?? '',
    bookingBehaviorNotes: row.bookingBehaviorNotes ?? '',
    escalationBehaviorNotes: row.escalationBehaviorNotes ?? '',
    knowledgeScopeNotes: row.knowledgeScopeNotes ?? '',
    knowledgeAccessMode: access,
    selectedVaultIds: sortVaultIds(row.selectedVaultIds ?? []),
    tempPreset: numToPreset(row.temperature != null ? Number(row.temperature) : 0.7),
    modelOverride: row.modelOverride ?? '',
    maxTokens: mt,
  };
}

function activeProfileLooksEmpty(row: TenantBotProfileRow): boolean {
  const name = row.name?.trim() ?? '';
  const noName = !name || name === DEFAULT_NEW_PROFILE;
  const noBody =
    !(row.persona?.trim()) &&
    !(row.conversationGoals?.trim()) &&
    !(row.businessNotes?.trim()) &&
    !(row.description?.trim());
  return noName && noBody;
}

export function TenantGoalsPanel() {
  const params = useParams();
  const subaccountId = params['tenantId'] as string;
  const { token } = useAuth();
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [profiles, setProfiles] = useState<TenantBotProfileRow[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [profileName, setProfileName] = useState('');
  const [description, setDescription] = useState('');
  const [persona, setPersona] = useState('');
  const [goals, setGoals] = useState('');
  const [additional, setAdditional] = useState('');
  const [toneRules, setToneRules] = useState('');
  const [bookingBehaviorNotes, setBookingBehaviorNotes] = useState('');
  const [escalationBehaviorNotes, setEscalationBehaviorNotes] = useState('');
  const [knowledgeScopeNotes, setKnowledgeScopeNotes] = useState('');
  const [knowledgeAccessMode, setKnowledgeAccessMode] = useState(KNOWLEDGE_ACCESS_ALL_VAULTS);
  const [selectedVaultIds, setSelectedVaultIds] = useState<string[]>([]);
  const [kbVaults, setKbVaults] = useState<KbVaultRow[]>([]);
  const [tempPreset, setTempPreset] = useState<TempPreset>('balanced');
  const [modelOverride, setModelOverride] = useState('');
  const [maxTokens, setMaxTokens] = useState(800);
  const [lengthKey, setLengthKey] = useState<(typeof LENGTH_PRESETS)[number]['value']>('800');
  const [policy, setPolicy] = useState<SubaccountBehaviorPolicy>(defaultPolicy);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [expandField, setExpandField] = useState<null | 'persona' | 'goals' | 'additional'>(null);
  const [expandDraft, setExpandDraft] = useState('');

  const baselineRef = useRef<FormBaseline | null>(null);

  const formSnapshot = useMemo((): FormBaseline => {
    return {
      profileName,
      description,
      persona,
      goals,
      additional,
      toneRules,
      bookingBehaviorNotes,
      escalationBehaviorNotes,
      knowledgeScopeNotes,
      knowledgeAccessMode,
      selectedVaultIds,
      tempPreset,
      modelOverride,
      maxTokens,
    };
  }, [
    profileName,
    description,
    persona,
    goals,
    additional,
    toneRules,
    bookingBehaviorNotes,
    escalationBehaviorNotes,
    knowledgeScopeNotes,
    knowledgeAccessMode,
    selectedVaultIds,
    tempPreset,
    modelOverride,
    maxTokens,
  ]);

  const isDirty =
    baselineRef.current !== null &&
    JSON.stringify(formSnapshot) !== JSON.stringify(baselineRef.current);

  const sortedProfiles = useMemo(() => {
    return [...profiles].sort((a, b) => {
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }, [profiles]);

  const activeProfile = useMemo(() => profiles.find(p => p.isActive) ?? null, [profiles]);
  const selectedRow = useMemo(
    () => profiles.find(p => p.id === selectedProfileId) ?? null,
    [profiles, selectedProfileId],
  );

  const applyRowToForm = (row: TenantBotProfileRow) => {
    setProfileName(row.name);
    setDescription(row.description ?? '');
    setPersona(row.persona ?? '');
    setGoals(row.conversationGoals ?? '');
    setAdditional(row.businessNotes ?? '');
    setToneRules(row.toneRules ?? '');
    setBookingBehaviorNotes(row.bookingBehaviorNotes ?? '');
    setEscalationBehaviorNotes(row.escalationBehaviorNotes ?? '');
    setKnowledgeScopeNotes(row.knowledgeScopeNotes ?? '');
    const access =
      row.knowledgeAccessMode?.trim() === KNOWLEDGE_ACCESS_SELECTED_VAULTS
        ? KNOWLEDGE_ACCESS_SELECTED_VAULTS
        : KNOWLEDGE_ACCESS_ALL_VAULTS;
    setKnowledgeAccessMode(access);
    setSelectedVaultIds(sortVaultIds(row.selectedVaultIds ?? []));
    setTempPreset(numToPreset(row.temperature != null ? Number(row.temperature) : 0.7));
    setModelOverride(row.modelOverride ?? '');
    const mt = row.maxTokens != null && row.maxTokens > 0 ? row.maxTokens : 800;
    setMaxTokens(mt);
    setLengthKey(inferLengthKey(mt));
    baselineRef.current = rowToBaseline(row);
  };

  useEffect(() => {
    if (!token || !subaccountId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr('');
      try {
        const [profileList, agencyCfg, vaultList] = await Promise.all([
          listTenantBotProfiles(token, subaccountId),
          getAgencyAiConfig(token).catch(() => null),
          listKbVaults(token, subaccountId).catch(() => [] as KbVaultRow[]),
        ]);
        if (cancelled) return;

        setKbVaults(Array.isArray(vaultList) ? vaultList : []);

        if (agencyCfg?.subaccountBehaviorPolicy) {
          setPolicy(agencyCfg.subaccountBehaviorPolicy);
        } else {
          setPolicy(defaultPolicy());
        }

        const list = Array.isArray(profileList) ? profileList : [];
        setProfiles(list);
        const chosen = list.find(p => p.isActive) ?? list[0] ?? null;
        if (chosen) {
          setSelectedProfileId(chosen.id);
          applyRowToForm(chosen);
        } else {
          setSelectedProfileId('');
          baselineRef.current = null;
          setProfileName('');
          setDescription('');
          setPersona('');
          setGoals('');
          setAdditional('');
          setToneRules('');
          setBookingBehaviorNotes('');
          setEscalationBehaviorNotes('');
          setKnowledgeScopeNotes('');
          setKnowledgeAccessMode(KNOWLEDGE_ACCESS_ALL_VAULTS);
          setSelectedVaultIds([]);
          setTempPreset('balanced');
          setModelOverride('');
          setMaxTokens(800);
          setLengthKey('800');
        }
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, subaccountId, loadAttempt]);

  const requestSelectProfile = (id: string) => {
    if (id === selectedProfileId) return;
    if (
      isDirty &&
      !window.confirm('You have unsaved changes. Discard them and switch profiles?')
    ) {
      return;
    }
    const row = profiles.find(x => x.id === id);
    if (!row) return;
    setSelectedProfileId(id);
    applyRowToForm(row);
  };

  const onSavePrompt = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!token || !selectedProfileId) return;
    setSaving(true);
    setErr('');
    setOk('');
    try {
      const p = policy;
      const rawT = TEMP_PRESETS[tempPreset];
      const temperature = p.allowResponseStyleOverride ? clamp(rawT, p.temperatureMin, p.temperatureMax) : rawT;
      const tok = p.allowMaxTokensOverride ? clamp(maxTokens, p.maxTokensMin, p.maxTokensMax) : maxTokens;
      const mo = modelOverride.trim();
      await updateTenantBotProfile(token, subaccountId, selectedProfileId, {
        name: profileName.trim() || 'Assistant profile',
        description,
        persona,
        conversationGoals: goals,
        businessNotes: additional,
        toneRules,
        bookingBehaviorNotes,
        escalationBehaviorNotes,
        knowledgeScopeNotes,
        knowledgeAccessMode,
        selectedVaultIds:
          knowledgeAccessMode === KNOWLEDGE_ACCESS_SELECTED_VAULTS ? selectedVaultIds : undefined,
        knowledgeScopeMode:
          knowledgeAccessMode === KNOWLEDGE_ACCESS_SELECTED_VAULTS
            ? 'selected_collections'
            : KNOWLEDGE_SCOPE_ALL_WORKSPACE,
        temperature,
        maxTokens: tok,
        modelOverride: p.allowModelOverride && mo ? mo : null,
      });
      setOk('Changes saved.');
      const [refreshed, vaultList] = await Promise.all([
        listTenantBotProfiles(token, subaccountId),
        listKbVaults(token, subaccountId).catch(() => [] as KbVaultRow[]),
      ]);
      const list = Array.isArray(refreshed) ? refreshed : [];
      setProfiles(list);
      setKbVaults(Array.isArray(vaultList) ? vaultList : []);
      const match = list.find(x => x.id === selectedProfileId) ?? list.find(x => x.isActive) ?? list[0];
      if (match) applyRowToForm(match);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const onNewProfile = async () => {
    if (!token) return;
    if (
      isDirty &&
      !window.confirm('You have unsaved changes. Discard them and create a new profile?')
    ) {
      return;
    }
    setErr('');
    setOk('');
    try {
      const used = new Set(profiles.map(p => p.name));
      let name = DEFAULT_NEW_PROFILE;
      let n = 2;
      while (used.has(name)) {
        name = `${DEFAULT_NEW_PROFILE} (${n})`;
        n += 1;
      }
      const created = await createTenantBotProfile(token, subaccountId, {
        name,
        description: '',
        persona: '',
        conversationGoals: '',
        businessNotes: '',
        toneRules: '',
        bookingBehaviorNotes: '',
        escalationBehaviorNotes: '',
        knowledgeScopeNotes: '',
        knowledgeAccessMode: KNOWLEDGE_ACCESS_ALL_VAULTS,
        selectedVaultIds: [],
        setActive: false,
      });
      const refreshed = await listTenantBotProfiles(token, subaccountId);
      setProfiles(Array.isArray(refreshed) ? refreshed : []);
      setSelectedProfileId(created.id);
      applyRowToForm(created);
      setOk('Draft created. Save your changes, then set active when ready.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not create profile');
    }
  };

  const duplicateProfileById = async (profileId: string) => {
    if (!token) return;
    if (
      isDirty &&
      !window.confirm('You have unsaved changes. Discard them and duplicate this profile?')
    ) {
      return;
    }
    setErr('');
    setOk('');
    try {
      const created = await duplicateTenantBotProfile(token, subaccountId, profileId);
      const refreshed = await listTenantBotProfiles(token, subaccountId);
      setProfiles(Array.isArray(refreshed) ? refreshed : []);
      setSelectedProfileId(created.id);
      applyRowToForm(created);
      setOk('Duplicated as a draft.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Duplicate failed');
    }
  };

  const activateProfileById = async (profileId: string) => {
    if (!token) return;
    if (profileId !== selectedProfileId) {
      if (
        isDirty &&
        !window.confirm(
          'You have unsaved changes on the profile you are editing. Discard them and switch to this profile before making it live?',
        )
      ) {
        return;
      }
    }
    if (
      !window.confirm('This will make this profile live for customer replies across connected channels.')
    ) {
      return;
    }
    setErr('');
    setOk('');
    try {
      await activateTenantBotProfile(token, subaccountId, profileId);
      const refreshed = await listTenantBotProfiles(token, subaccountId);
      const list = Array.isArray(refreshed) ? refreshed : [];
      setProfiles(list);
      const row = list.find(x => x.id === profileId);
      if (row && selectedProfileId === profileId) {
        applyRowToForm(row);
      } else if (row) {
        setSelectedProfileId(profileId);
        applyRowToForm(row);
      }
      setOk('Live assistant updated.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not set active profile');
    }
  };

  const onDeleteProfile = async (profileId: string) => {
    if (!token) return;
    const row = profiles.find(x => x.id === profileId);
    if (!row) return;
    if (row.isActive) return;
    if (profiles.length <= 1) return;
    if (!window.confirm(`Delete assistant profile “${row.name}”? This cannot be undone.`)) return;
    setErr('');
    setOk('');
    try {
      await deleteTenantBotProfile(token, subaccountId, profileId);
      const refreshed = await listTenantBotProfiles(token, subaccountId);
      const list = Array.isArray(refreshed) ? refreshed : [];
      setProfiles(list);
      if (selectedProfileId === profileId) {
        const next = list.find(x => x.isActive) ?? list[0] ?? null;
        if (next) {
          setSelectedProfileId(next.id);
          applyRowToForm(next);
        } else {
          setSelectedProfileId('');
          baselineRef.current = null;
        }
      }
      setOk('Profile deleted.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  const layoutStyleId = 'aisbp-goals-layout-css';

  const showAdvancedModel = policy.allowModelOverride;

  return (
    <div>
      <style
        dangerouslySetInnerHTML={{
          __html: `
#${layoutStyleId} { display: grid; gap: 1.1rem; grid-template-columns: 1fr; align-items: start; }
@media (min-width: 960px) {
  #${layoutStyleId} { grid-template-columns: minmax(240px, 300px) minmax(0, 1fr); }
}
`,
        }}
      />

      <PageHeader title="Bot Instructions" eyebrow="Client workspace" />

      {err && (
        <div style={{ marginBottom: '0.75rem' }}>
          <ErrorBanner message={err} />
          <button
            type="button"
            onClick={() => {
              setErr('');
              setLoadAttempt(a => a + 1);
            }}
            style={{
              marginTop: '0.5rem',
              padding: '0.4rem 0.75rem',
              borderRadius: '6px',
              border: '1px solid var(--aisbp-border-strong, #ccc)',
              background: 'var(--aisbp-surface, #fff)',
              cursor: 'pointer',
              fontSize: '0.85rem',
            }}
          >
            Try again
          </button>
        </div>
      )}
      {ok ? <SuccessBanner message={ok} /> : null}

      {loading && !err ? <LoadingBlock message="Loading…" /> : null}

      {!loading && !err ? (
        <>
          {activeProfile ? (
            <div
              style={{
                ...sectionCard,
                marginBottom: '1rem',
                borderLeft: '4px solid rgb(34, 197, 94)',
                paddingLeft: '1.15rem',
                boxShadow: '0 2px 14px rgba(15, 23, 42, 0.06)',
              }}
            >
              <p
                style={{
                  fontSize: '0.68rem',
                  fontWeight: 700,
                  letterSpacing: '0.07em',
                  textTransform: 'uppercase',
                  color: 'var(--aisbp-muted, #64748b)',
                  margin: '0 0 0.55rem',
                }}
              >
                Active assistant
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.55rem', marginBottom: '0.45rem' }}>
                <span
                  style={{
                    fontSize: '1.55rem',
                    fontWeight: 800,
                    lineHeight: 1.15,
                    color: 'var(--aisbp-text-heading, #0f172a)',
                    letterSpacing: '-0.02em',
                  }}
                >
                  {activeProfile.name.trim() || 'Untitled assistant'}
                </span>
                <LiveBadge large />
              </div>
              {activeProfile.description?.trim() ? (
                <p style={{ fontSize: '0.9rem', color: 'var(--aisbp-text-secondary, #334155)', margin: '0 0 0.65rem', lineHeight: 1.45 }}>
                  {activeProfile.description.trim()}
                </p>
              ) : null}
              <p style={{ fontSize: '0.88rem', color: 'var(--aisbp-text-secondary, #334155)', margin: '0 0 0.5rem', lineHeight: 1.5 }}>
                Used for live customer replies across connected channels.
              </p>
              <p style={{ fontSize: '0.84rem', color: 'var(--aisbp-text-secondary, #475569)', margin: '0 0 0.35rem', fontWeight: 600 }}>
                Vaults:{' '}
                <span style={{ fontWeight: 500 }}>
                  {activeAssistantVaultsSummary(
                    activeProfile.knowledgeAccessMode,
                    activeProfile.selectedVaultIds?.length ?? 0,
                  )}
                </span>
              </p>
              <p style={{ fontSize: '0.78rem', color: 'var(--aisbp-muted, #94a3b8)', margin: '0 0 1rem' }}>
                Last updated {formatProfileUpdatedAt(activeProfile.updatedAt)}
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
                <button type="button" onClick={() => requestSelectProfile(activeProfile.id)} style={secondaryBtnStyle}>
                  Edit profile
                </button>
                <button type="button" onClick={() => duplicateProfileById(activeProfile.id)} style={secondaryBtnStyle}>
                  Duplicate
                </button>
                <button type="button" onClick={onNewProfile} style={secondaryBtnStyle}>
                  Create new profile
                </button>
              </div>
              {activeProfileLooksEmpty(activeProfile) ? (
                <p
                  style={{
                    margin: '0.75rem 0 0',
                    padding: '0.55rem 0.7rem',
                    borderRadius: '8px',
                    background: 'rgba(234, 179, 8, 0.12)',
                    color: 'rgb(113, 63, 18)',
                    fontSize: '0.8rem',
                    lineHeight: 1.45,
                  }}
                >
                  Add persona and goals so this live assistant is ready for customers.
                </p>
              ) : null}
            </div>
          ) : (
            <div style={{ ...sectionCard, marginBottom: '0.75rem' }}>
              <p style={{ margin: '0 0 0.35rem', fontWeight: 700, color: 'var(--aisbp-text-heading, #0f172a)' }}>
                No live assistant
              </p>
              <p style={{ fontSize: '0.85rem', color: 'var(--aisbp-muted, #64748b)', margin: '0 0 0.65rem' }}>
                Set a profile active below, or create a new one.
              </p>
              <button type="button" onClick={onNewProfile} style={secondaryBtnStyle}>
                Create new profile
              </button>
            </div>
          )}

          <div id={layoutStyleId}>
            <aside style={{ minWidth: 0 }}>
              <h2
                style={{
                  fontSize: '0.78rem',
                  fontWeight: 800,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  color: 'var(--aisbp-muted, #64748b)',
                  margin: '0 0 0.5rem',
                }}
              >
                Assistant profiles
              </h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                {sortedProfiles.map(p => {
                  const selected = p.id === selectedProfileId;
                  return (
                    <div key={p.id} style={profileListCardStyle(selected)}>
                      <button
                        type="button"
                        onClick={() => requestSelectProfile(p.id)}
                        style={{
                          display: 'block',
                          width: '100%',
                          textAlign: 'left',
                          padding: 0,
                          marginBottom: '0.45rem',
                          border: 'none',
                          background: 'transparent',
                          cursor: 'pointer',
                          font: 'inherit',
                        }}
                      >
                        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.35rem', marginBottom: '0.25rem' }}>
                          <span style={{ fontWeight: 700, color: 'var(--aisbp-text-heading, #0f172a)', fontSize: '0.9rem' }}>
                            {p.name.trim() || 'Untitled'}
                          </span>
                          {p.isActive ? <LiveBadge /> : <DraftBadge />}
                        </div>
                        {!p.isActive ? (
                          <p style={{ fontSize: '0.72rem', color: 'var(--aisbp-muted, #94a3b8)', margin: '0 0 0.35rem' }}>
                            Not used for live replies
                          </p>
                        ) : null}
                        {p.description?.trim() ? (
                          <p style={{ fontSize: '0.78rem', color: 'var(--aisbp-muted, #64748b)', margin: '0 0 0.35rem', lineHeight: 1.35 }}>
                            {p.description.trim()}
                          </p>
                        ) : null}
                        <p style={{ fontSize: '0.7rem', color: 'var(--aisbp-muted, #94a3b8)', margin: '0 0 0.2rem' }}>
                          Vaults:{' '}
                          {activeAssistantVaultsSummary(
                            p.knowledgeAccessMode,
                            p.selectedVaultIds?.length ?? 0,
                          )}
                        </p>
                        <p style={{ fontSize: '0.7rem', color: 'var(--aisbp-muted, #94a3b8)', margin: 0 }}>
                          Updated {formatProfileUpdatedAt(p.updatedAt)}
                        </p>
                      </button>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', alignItems: 'center' }}>
                        <button
                          type="button"
                          onClick={() => requestSelectProfile(p.id)}
                          style={{ ...secondaryBtnStyle, padding: '0.28rem 0.55rem', fontSize: '0.76rem' }}
                        >
                          Edit profile
                        </button>
                        {!p.isActive ? (
                          <button
                            type="button"
                            onClick={() => activateProfileById(p.id)}
                            style={{ ...secondaryBtnStyle, padding: '0.28rem 0.55rem', fontSize: '0.76rem' }}
                          >
                            Set live
                          </button>
                        ) : (
                          <span
                            style={{
                              fontSize: '0.76rem',
                              color: 'var(--aisbp-muted, #64748b)',
                              fontWeight: 600,
                              padding: '0.28rem 0.35rem',
                            }}
                          >
                            Currently live
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => duplicateProfileById(p.id)}
                          style={{ ...secondaryBtnStyle, padding: '0.28rem 0.55rem', fontSize: '0.76rem' }}
                        >
                          Duplicate
                        </button>
                        <button
                          type="button"
                          disabled={profiles.length <= 1 || p.isActive}
                          title={p.isActive ? LIVE_DELETE_HINT : undefined}
                          aria-label={p.isActive ? LIVE_DELETE_HINT : 'Delete profile'}
                          onClick={() => onDeleteProfile(p.id)}
                          style={{
                            ...deleteBtnStyle,
                            padding: '0.28rem 0.45rem',
                            fontSize: '0.76rem',
                            opacity: p.isActive ? 0.45 : 1,
                            cursor: p.isActive || profiles.length <= 1 ? 'not-allowed' : 'pointer',
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              {isDirty ? (
                <p style={{ fontSize: '0.75rem', color: 'rgb(180, 83, 9)', margin: '0.6rem 0 0', fontWeight: 600 }}>
                  Unsaved changes
                </p>
              ) : null}
            </aside>

            <div style={{ minWidth: 0 }}>
              {!selectedProfileId ? (
                <p style={{ fontSize: '0.88rem', color: 'var(--aisbp-muted, #64748b)' }}>Select a profile to edit.</p>
              ) : (
                <form onSubmit={onSavePrompt}>
                  <div style={sectionCard}>
                    <h3 style={sectionTitleStyle}>Profile details</h3>
                    <div style={{ marginBottom: '0.5rem' }}>
                      {selectedRow?.isActive ? (
                        <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--aisbp-muted, #64748b)' }}>
                          Live assistant <LiveBadge />
                        </span>
                      ) : (
                        <div>
                          <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--aisbp-muted, #64748b)' }}>
                            <DraftBadge />{' '}
                            <span style={{ fontWeight: 600 }}>Not used for live replies</span>
                          </span>
                        </div>
                      )}
                    </div>
                    <div style={{ marginBottom: '0.55rem' }}>
                      <label style={mvpLabelStyle}>Profile name</label>
                      <input
                        style={{ ...mvpInputStyle, maxWidth: '100%' }}
                        value={profileName}
                        onChange={e => setProfileName(e.target.value)}
                        autoComplete="off"
                        aria-label="Profile name"
                      />
                    </div>
                    <div style={{ marginBottom: 0 }}>
                      <label style={mvpLabelStyle}>Description</label>
                      <input
                        style={{ ...mvpInputStyle, maxWidth: '100%' }}
                        value={description}
                        onChange={e => setDescription(e.target.value)}
                        placeholder="Short label for your team"
                        autoComplete="off"
                      />
                      <p style={{ ...mvpFieldHint, marginBottom: 0 }}>Shown in the profile list only.</p>
                    </div>
                  </div>

                  <div style={sectionCard}>
                    <h3 style={sectionTitleStyle}>Persona</h3>
                    <p style={{ ...mvpFieldHint, margin: '-0.25rem 0 0.5rem' }}>How the assistant should sound and behave.</p>
                    <textarea style={textareaStyle} value={persona} onChange={e => setPersona(e.target.value)} aria-label="Persona" />
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 8,
                        marginTop: 8,
                      }}
                    >
                      <span style={{ fontSize: '0.78rem', color: 'var(--aisbp-muted, #64748b)' }}>
                        {countWords(persona)} words
                      </span>
                      <button
                        type="button"
                        style={expandTextBtn}
                        onClick={() => {
                          setExpandDraft(persona);
                          setExpandField('persona');
                        }}
                      >
                        Expand
                      </button>
                    </div>
                  </div>
                  <div style={sectionCard}>
                    <h3 style={sectionTitleStyle}>Conversation goals</h3>
                    <p style={{ ...mvpFieldHint, margin: '-0.25rem 0 0.5rem' }}>What this assistant should try to achieve.</p>
                    <textarea style={textareaStyle} value={goals} onChange={e => setGoals(e.target.value)} aria-label="Conversation goals" />
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 8,
                        marginTop: 8,
                      }}
                    >
                      <span style={{ fontSize: '0.78rem', color: 'var(--aisbp-muted, #64748b)' }}>
                        {countWords(goals)} words
                      </span>
                      <button
                        type="button"
                        style={expandTextBtn}
                        onClick={() => {
                          setExpandDraft(goals);
                          setExpandField('goals');
                        }}
                      >
                        Expand
                      </button>
                    </div>
                  </div>
                  <div style={sectionCard}>
                    <h3 style={sectionTitleStyle}>Business notes</h3>
                    <p style={{ ...mvpFieldHint, margin: '-0.25rem 0 0.5rem' }}>Facts, policies, and context for this workspace.</p>
                    <textarea style={textareaStyle} value={additional} onChange={e => setAdditional(e.target.value)} aria-label="Business notes" />
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 8,
                        marginTop: 8,
                      }}
                    >
                      <span style={{ fontSize: '0.78rem', color: 'var(--aisbp-muted, #64748b)' }}>
                        {countWords(additional)} words
                      </span>
                      <button
                        type="button"
                        style={expandTextBtn}
                        onClick={() => {
                          setExpandDraft(additional);
                          setExpandField('additional');
                        }}
                      >
                        Expand
                      </button>
                    </div>
                  </div>

                  <div style={sectionCard}>
                    <h3 style={sectionTitleStyle}>Knowledge used by this assistant</h3>
                    <p
                      style={{
                        fontSize: '0.82rem',
                        color: 'var(--aisbp-text-secondary, #334155)',
                        margin: '0.35rem 0 0.75rem',
                        lineHeight: 1.45,
                      }}
                    >
                      Vaults are groups of FAQs, notes, and files. Configure vault content under Knowledge.
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                      <label
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: '0.45rem',
                          fontSize: '0.88rem',
                          cursor: 'pointer',
                          color: 'var(--aisbp-text-heading, #0f172a)',
                        }}
                      >
                        <input
                          type="radio"
                          name="knowledge-access-mode"
                          checked={knowledgeAccessMode === KNOWLEDGE_ACCESS_ALL_VAULTS}
                          onChange={() => setKnowledgeAccessMode(KNOWLEDGE_ACCESS_ALL_VAULTS)}
                          style={{ marginTop: '0.2rem' }}
                        />
                        <span>
                          <strong style={{ fontWeight: 700 }}>Use all vaults</strong>
                          <span style={{ display: 'block', fontSize: '0.78rem', color: 'var(--aisbp-muted, #64748b)', marginTop: '0.15rem' }}>
                            Default — search every knowledge vault in this workspace.
                          </span>
                        </span>
                      </label>
                      <label
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: '0.45rem',
                          fontSize: '0.88rem',
                          cursor: 'pointer',
                          color: 'var(--aisbp-text-heading, #0f172a)',
                        }}
                      >
                        <input
                          type="radio"
                          name="knowledge-access-mode"
                          checked={knowledgeAccessMode === KNOWLEDGE_ACCESS_SELECTED_VAULTS}
                          onChange={() => setKnowledgeAccessMode(KNOWLEDGE_ACCESS_SELECTED_VAULTS)}
                          style={{ marginTop: '0.2rem' }}
                        />
                        <span>
                          <strong style={{ fontWeight: 700 }}>Selected vaults</strong>
                          <span style={{ display: 'block', fontSize: '0.78rem', color: 'var(--aisbp-muted, #64748b)', marginTop: '0.15rem' }}>
                            Only the vaults you check below are searched for this assistant.
                          </span>
                        </span>
                      </label>
                    </div>
                    {knowledgeAccessMode === KNOWLEDGE_ACCESS_SELECTED_VAULTS && kbVaults.length === 0 ? (
                      <p
                        style={{
                          margin: '0.75rem 0 0',
                          fontSize: '0.82rem',
                          color: 'var(--aisbp-muted, #64748b)',
                          lineHeight: 1.45,
                        }}
                      >
                        No knowledge vaults yet. Create one in Knowledge Base.
                      </p>
                    ) : null}
                    {knowledgeAccessMode === KNOWLEDGE_ACCESS_SELECTED_VAULTS && kbVaults.length > 0 ? (
                      <div
                        style={{
                          marginTop: '0.75rem',
                          paddingTop: '0.75rem',
                          borderTop: '1px solid rgba(226, 232, 240, 0.85)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.5rem',
                        }}
                      >
                        <p
                          style={{
                            fontSize: '0.72rem',
                            fontWeight: 700,
                            letterSpacing: '0.06em',
                            textTransform: 'uppercase',
                            color: 'var(--aisbp-muted, #64748b)',
                            margin: 0,
                          }}
                        >
                          Choose vaults
                        </p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                          {kbVaults.map(v => {
                            const checked = selectedVaultIds.includes(v.id);
                            return (
                              <label
                                key={v.id}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '0.45rem',
                                  fontSize: '0.85rem',
                                  cursor: 'pointer',
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => {
                                    setSelectedVaultIds(prev => {
                                      const s = new Set(prev);
                                      if (s.has(v.id)) s.delete(v.id);
                                      else s.add(v.id);
                                      return sortVaultIds([...s]);
                                    });
                                  }}
                                />
                                <span>
                                  {v.name}
                                  {v.isDefault ? (
                                    <span style={{ fontSize: '0.72rem', color: 'var(--aisbp-muted, #94a3b8)', marginLeft: '0.35rem' }}>
                                      (default)
                                    </span>
                                  ) : null}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                        {kbVaults.length === 1 ? (
                          <p
                            style={{
                              margin: 0,
                              fontSize: '0.78rem',
                              color: 'var(--aisbp-muted, #64748b)',
                              lineHeight: 1.45,
                            }}
                          >
                            Only one vault exists. Create more vaults in Knowledge Base.
                          </p>
                        ) : null}
                        {selectedVaultIds.length === 0 ? (
                          <p
                            style={{
                              margin: 0,
                              fontSize: '0.8rem',
                              color: 'rgb(154, 52, 18)',
                              lineHeight: 1.45,
                              padding: '0.45rem 0.55rem',
                              borderRadius: 8,
                              background: 'rgba(251, 191, 36, 0.15)',
                              border: '1px solid rgba(251, 191, 36, 0.45)',
                            }}
                          >
                            Select at least one vault or use all vaults.
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  <details style={{ ...sectionCard, marginBottom: '1.15rem' }}>
                    <summary
                      style={{
                        cursor: 'pointer',
                        fontSize: '0.95rem',
                        fontWeight: 700,
                        color: 'var(--aisbp-text-heading, #0f172a)',
                        listStyle: 'none',
                      }}
                    >
                      Advanced
                    </summary>
                    <div style={{ marginTop: '0.65rem', display: 'grid', gap: '0.65rem' }}>
                      <div
                        style={{
                          display: 'grid',
                          gap: '0.65rem',
                          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                        }}
                      >
                        <div>
                          <label style={mvpLabelStyle}>Reply style</label>
                          <select
                            value={tempPreset}
                            onChange={e => setTempPreset(e.target.value as TempPreset)}
                            style={mvpInputStyle}
                            disabled={!policy.allowResponseStyleOverride}
                          >
                            <option value="precise">Precise</option>
                            <option value="balanced">Balanced</option>
                            <option value="creative">Creative</option>
                          </select>
                        </div>
                        <div>
                          <span style={mvpLabelStyle}>Reply length</span>
                          <select
                            value={lengthKey}
                            onChange={e => {
                              const v = e.target.value as (typeof LENGTH_PRESETS)[number]['value'];
                              setLengthKey(v);
                              const opt = LENGTH_PRESETS.find(o => o.value === v);
                              if (opt && opt.value !== 'custom') setMaxTokens(opt.tokens);
                            }}
                            style={mvpInputStyle}
                            disabled={!policy.allowMaxTokensOverride}
                          >
                            {LENGTH_PRESETS.map(o => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label style={mvpLabelStyle}>Maximum reply length</label>
                          <input
                            type="number"
                            value={maxTokens}
                            onChange={e => setMaxTokens(parseInt(e.target.value, 10) || 0)}
                            style={mvpInputStyle}
                            disabled={!policy.allowMaxTokensOverride}
                            min={policy.maxTokensMin}
                            max={policy.maxTokensMax}
                          />
                        </div>
                        {showAdvancedModel ? (
                          <div>
                            <label style={mvpLabelStyle}>Model override</label>
                            <input
                              style={mvpInputStyle}
                              value={modelOverride}
                              onChange={e => setModelOverride(e.target.value)}
                              placeholder="Optional model ID"
                              autoComplete="off"
                            />
                          </div>
                        ) : null}
                      </div>
                      <div>
                        <label style={mvpLabelStyle}>Tone rules</label>
                        <textarea style={textareaStyle} value={toneRules} onChange={e => setToneRules(e.target.value)} aria-label="Tone rules" />
                      </div>
                      <div>
                        <label style={mvpLabelStyle}>Booking behavior</label>
                        <textarea
                          style={textareaStyle}
                          value={bookingBehaviorNotes}
                          onChange={e => setBookingBehaviorNotes(e.target.value)}
                          aria-label="Booking behavior notes"
                        />
                      </div>
                      <div>
                        <label style={mvpLabelStyle}>Escalation behavior</label>
                        <textarea
                          style={textareaStyle}
                          value={escalationBehaviorNotes}
                          onChange={e => setEscalationBehaviorNotes(e.target.value)}
                          aria-label="Escalation behavior notes"
                        />
                      </div>
                      <div>
                        <label style={mvpLabelStyle}>Knowledge vault notes</label>
                        <textarea
                          style={textareaStyle}
                          value={knowledgeScopeNotes}
                          onChange={e => setKnowledgeScopeNotes(e.target.value)}
                          aria-label="Knowledge vault notes"
                        />
                      </div>
                    </div>
                  </details>

                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '0.45rem',
                      alignItems: 'center',
                      marginBottom: '0.5rem',
                    }}
                  >
                    <button type="submit" style={mvpPrimaryButtonStyle} disabled={saving || !selectedProfileId}>
                      {saving ? 'Saving…' : 'Save changes'}
                    </button>
                    {!selectedRow?.isActive ? (
                      <button
                        type="button"
                        onClick={() => selectedProfileId && activateProfileById(selectedProfileId)}
                        style={secondaryBtnStyle}
                        disabled={!selectedProfileId}
                      >
                        Set live
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => selectedProfileId && duplicateProfileById(selectedProfileId)}
                      style={secondaryBtnStyle}
                      disabled={!selectedProfileId}
                    >
                      Duplicate
                    </button>
                    <button
                      type="button"
                      onClick={() => selectedProfileId && onDeleteProfile(selectedProfileId)}
                      style={{
                        ...deleteBtnStyle,
                        opacity: selectedRow?.isActive ? 0.45 : 1,
                        cursor:
                          !selectedProfileId || profiles.length <= 1 || selectedRow?.isActive
                            ? 'not-allowed'
                            : 'pointer',
                      }}
                      disabled={!selectedProfileId || profiles.length <= 1 || Boolean(selectedRow?.isActive)}
                      title={selectedRow?.isActive ? LIVE_DELETE_HINT : undefined}
                      aria-label={selectedRow?.isActive ? LIVE_DELETE_HINT : 'Delete profile'}
                    >
                      Delete
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </>
      ) : null}

      {expandField ? (
        <div
          style={expandModalOverlay}
          role="presentation"
          onClick={e => {
            if (e.target === e.currentTarget) setExpandField(null);
          }}
        >
          <div style={expandModalPanel} role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
            <div
              style={{
                padding: '1rem 1.15rem',
                borderBottom: '1px solid var(--aisbp-modal-divider, #f1f5f9)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
              }}
            >
              <h2 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0, flex: 1, color: 'var(--aisbp-text-heading, #0f172a)' }}>
                {expandField === 'persona'
                  ? 'Persona'
                  : expandField === 'goals'
                    ? 'Conversation goals'
                    : 'Business notes'}
              </h2>
              <button
                type="button"
                onClick={() => setExpandField(null)}
                style={{
                  border: 'none',
                  background: 'var(--aisbp-modal-close-bg, #f1f5f9)',
                  borderRadius: 8,
                  width: 36,
                  height: 36,
                  cursor: 'pointer',
                  fontSize: '1.1rem',
                  lineHeight: 1,
                  color: 'var(--aisbp-muted, #475569)',
                }}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div style={{ padding: '1rem 1.15rem', overflowY: 'auto', flex: 1, minHeight: 0 }}>
              <textarea
                value={expandDraft}
                onChange={e => setExpandDraft(e.target.value)}
                rows={18}
                style={{
                  ...mvpInputStyle,
                  width: '100%',
                  minHeight: 320,
                  resize: 'vertical' as const,
                  fontFamily: 'inherit',
                  fontSize: '0.9rem',
                  lineHeight: 1.5,
                }}
                spellCheck
              />
              <p style={{ fontSize: '0.78rem', color: 'var(--aisbp-muted, #64748b)', margin: '0.65rem 0 0' }}>
                {countWords(expandDraft)} words
              </p>
            </div>
            <div
              style={{
                padding: '0.75rem 1.15rem',
                borderTop: '1px solid var(--aisbp-modal-divider, #f1f5f9)',
                display: 'flex',
                flexWrap: 'wrap',
                gap: '0.5rem',
                justifyContent: 'flex-end',
              }}
            >
              <button type="button" onClick={() => setExpandField(null)} style={secondaryBtnStyle}>
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (expandField === 'persona') setPersona(expandDraft);
                  else if (expandField === 'goals') setGoals(expandDraft);
                  else setAdditional(expandDraft);
                  setExpandField(null);
                }}
                style={mvpPrimaryButtonStyle}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
