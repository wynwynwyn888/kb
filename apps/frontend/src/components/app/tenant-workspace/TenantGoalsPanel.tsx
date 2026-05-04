'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import {
  getAgencyAiConfig,
  listTenantBotProfiles,
  createTenantBotProfile,
  updateTenantBotProfile,
  activateTenantBotProfile,
  duplicateTenantBotProfile,
  deleteTenantBotProfile,
  type SubaccountBehaviorPolicy,
  type TenantBotProfileRow,
} from '@/lib/api';
import {
  KNOWLEDGE_SCOPE_ALL_WORKSPACE,
  KNOWLEDGE_SCOPE_SELECTED_COLLECTIONS,
  formatProfileUpdatedAt,
  knowledgeScopeCardLabel,
  knowledgeScopeSentence,
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

const DEFAULT_NEW_PROFILE = 'New profile';

const textareaStyle = {
  ...mvpInputStyle,
  minHeight: '140px',
  resize: 'vertical' as const,
  fontFamily: 'inherit',
  fontSize: '0.9rem',
  lineHeight: 1.5,
  whiteSpace: 'pre-wrap' as const,
  overflowWrap: 'break-word' as const,
};

const sectionCard = {
  border: '1px solid var(--aisbp-border, #e2e8f0)',
  borderRadius: '10px',
  padding: '1rem 1.1rem',
  marginBottom: '0.85rem',
  background: 'var(--aisbp-surface, #fff)',
};

const secondaryBtnStyle: CSSProperties = {
  padding: '0.45rem 0.85rem',
  borderRadius: '8px',
  border: '1px solid var(--aisbp-border, #e2e8f0)',
  background: 'var(--aisbp-surface, #fff)',
  color: 'var(--aisbp-text-secondary, #334155)',
  fontSize: '0.85rem',
  fontWeight: 600,
  cursor: 'pointer',
};

function LiveBadge() {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '0.15rem 0.5rem',
        borderRadius: '6px',
        fontSize: '0.72rem',
        fontWeight: 700,
        letterSpacing: '0.02em',
        background: 'rgba(34, 197, 94, 0.15)',
        color: 'rgb(22, 101, 52)',
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
        borderRadius: '6px',
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

function countWords(text: string): number {
  const t = text.trim();
  if (!t) return 0;
  return t.split(/\s+/).length;
}

function numToPreset(n: number): TempPreset {
  if (!Number.isFinite(n)) return 'balanced';
  if (n <= 0.5) return 'precise';
  if (n >= 0.95) return 'creative';
  return 'balanced';
}

type PromptSectionField = 'persona' | 'goals' | 'additional';

const PROMPT_SECTION_MODAL_TITLE: Record<PromptSectionField, string> = {
  persona: 'Persona',
  goals: 'Conversation goals',
  additional: 'Business notes',
};

const expandIconBtnStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '2.25rem',
  height: '2.25rem',
  flexShrink: 0,
  borderRadius: '8px',
  border: '1px solid var(--aisbp-border, #e2e8f0)',
  background: 'var(--aisbp-stat-tile-bg, #f8fafc)',
  color: 'var(--aisbp-muted, #64748b)',
  cursor: 'pointer',
};

const wordCountRowStyle: CSSProperties = {
  fontSize: '0.72rem',
  color: 'var(--aisbp-muted, #94a3b8)',
  margin: '0.35rem 0 0',
  textAlign: 'right',
};

function ExpandEditorIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
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
  knowledgeScopeMode: string;
  tempPreset: TempPreset;
  modelOverride: string;
  maxTokens: number;
};

function rowToBaseline(row: TenantBotProfileRow): FormBaseline {
  const mt = row.maxTokens != null && row.maxTokens > 0 ? row.maxTokens : 800;
  const rawScope = row.knowledgeScopeMode?.trim() || KNOWLEDGE_SCOPE_ALL_WORKSPACE;
  const scope =
    rawScope === KNOWLEDGE_SCOPE_SELECTED_COLLECTIONS ? KNOWLEDGE_SCOPE_ALL_WORKSPACE : rawScope;
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
    knowledgeScopeMode: scope,
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
  const [knowledgeScopeMode, setKnowledgeScopeMode] = useState(KNOWLEDGE_SCOPE_ALL_WORKSPACE);
  const [tempPreset, setTempPreset] = useState<TempPreset>('balanced');
  const [modelOverride, setModelOverride] = useState('');
  const [maxTokens, setMaxTokens] = useState(800);
  const [lengthKey, setLengthKey] = useState<(typeof LENGTH_PRESETS)[number]['value']>('800');
  const [policy, setPolicy] = useState<SubaccountBehaviorPolicy>(defaultPolicy);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [promptModal, setPromptModal] = useState<null | { field: PromptSectionField; draft: string }>(null);

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
      knowledgeScopeMode,
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
    knowledgeScopeMode,
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

  useEffect(() => {
    if (!promptModal) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPromptModal(null);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [promptModal]);

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
    const rawScope = row.knowledgeScopeMode?.trim() || KNOWLEDGE_SCOPE_ALL_WORKSPACE;
    setKnowledgeScopeMode(
      rawScope === KNOWLEDGE_SCOPE_SELECTED_COLLECTIONS ? KNOWLEDGE_SCOPE_ALL_WORKSPACE : rawScope,
    );
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
        const [profileList, agencyCfg] = await Promise.all([
          listTenantBotProfiles(token, subaccountId),
          getAgencyAiConfig(token).catch(() => null),
        ]);
        if (cancelled) return;

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
          setKnowledgeScopeMode(KNOWLEDGE_SCOPE_ALL_WORKSPACE);
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
        knowledgeScopeMode,
        temperature,
        maxTokens: tok,
        modelOverride: p.allowModelOverride && mo ? mo : null,
      });
      setOk('Changes saved.');
      const refreshed = await listTenantBotProfiles(token, subaccountId);
      const list = Array.isArray(refreshed) ? refreshed : [];
      setProfiles(list);
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
        knowledgeScopeMode: KNOWLEDGE_SCOPE_ALL_WORKSPACE,
        setActive: false,
      });
      const refreshed = await listTenantBotProfiles(token, subaccountId);
      setProfiles(Array.isArray(refreshed) ? refreshed : []);
      setSelectedProfileId(created.id);
      applyRowToForm(created);
      setOk('Draft profile created. Save when ready, then Set active to use it for live replies.');
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
      setOk('Profile duplicated as a draft.');
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

  const openPromptModal = (field: PromptSectionField) => {
    const draft = field === 'persona' ? persona : field === 'goals' ? goals : additional;
    setPromptModal({ field, draft });
  };

  const applyPromptModal = () => {
    if (!promptModal) return;
    const { field, draft } = promptModal;
    if (field === 'persona') setPersona(draft);
    else if (field === 'goals') setGoals(draft);
    else setAdditional(draft);
    setPromptModal(null);
  };

  const layoutStyleId = 'aisbp-goals-layout-css';

  return (
    <div>
      <style
        dangerouslySetInnerHTML={{
          __html: `
#${layoutStyleId} { display: grid; gap: 1rem; grid-template-columns: 1fr; align-items: start; }
@media (min-width: 960px) {
  #${layoutStyleId} { grid-template-columns: minmax(260px, 320px) minmax(0, 1fr); }
}
`,
        }}
      />

      <PageHeader title="Bot Instructions" eyebrow="Client workspace" />
      <p
        style={{
          fontSize: '0.88rem',
          color: 'var(--aisbp-muted, #64748b)',
          margin: '0 0 1rem',
          lineHeight: 1.5,
          maxWidth: '640px',
        }}
      >
        Define how this workspace’s bot should sound, what it should achieve, and what it must know.
      </p>

      {err && (
        <div style={{ marginBottom: '1rem' }}>
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
                borderColor: 'rgba(34, 197, 94, 0.35)',
                background: 'linear-gradient(180deg, rgba(34, 197, 94, 0.06) 0%, var(--aisbp-surface, #fff) 48%)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  gap: '0.75rem',
                  marginBottom: '0.65rem',
                }}
              >
                <div>
                  <p
                    style={{
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                      color: 'var(--aisbp-muted, #64748b)',
                      margin: '0 0 0.35rem',
                    }}
                  >
                    Active assistant
                  </p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem' }}>
                    <span
                      style={{
                        fontSize: '1.05rem',
                        fontWeight: 800,
                        color: 'var(--aisbp-text-heading, #0f172a)',
                      }}
                    >
                      {activeProfile.name.trim() || 'Untitled assistant'}
                    </span>
                    {activeProfile.description?.trim() ? (
                      <span style={{ fontSize: '0.9rem', color: 'var(--aisbp-muted, #64748b)' }}>
                        — {activeProfile.description.trim()}
                      </span>
                    ) : null}
                    <LiveBadge />
                  </div>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <button
                    type="button"
                    onClick={() => requestSelectProfile(activeProfile.id)}
                    style={secondaryBtnStyle}
                  >
                    Edit active profile
                  </button>
                  <button
                    type="button"
                    onClick={() => duplicateProfileById(activeProfile.id)}
                    style={secondaryBtnStyle}
                  >
                    Duplicate
                  </button>
                  <button type="button" onClick={onNewProfile} style={mvpPrimaryButtonStyle}>
                    Create new profile
                  </button>
                </div>
              </div>
              <p style={{ fontSize: '0.85rem', color: 'var(--aisbp-text-secondary, #334155)', margin: '0 0 0.35rem' }}>
                {knowledgeScopeSentence(activeProfile.knowledgeScopeMode)}
              </p>
              <p style={{ fontSize: '0.8rem', color: 'var(--aisbp-muted, #64748b)', margin: '0 0 0.5rem' }}>
                Used for live replies across connected channels.
              </p>
              <p style={{ fontSize: '0.75rem', color: 'var(--aisbp-muted, #94a3b8)', margin: '0 0 0.35rem' }}>
                Last updated {formatProfileUpdatedAt(activeProfile.updatedAt)}
              </p>
              <p style={{ fontSize: '0.72rem', color: 'var(--aisbp-muted, #94a3b8)', margin: 0, lineHeight: 1.45 }}>
                This profile is used for live replies in this workspace.
              </p>
              {activeProfileLooksEmpty(activeProfile) ? (
                <p
                  style={{
                    margin: '0.75rem 0 0',
                    padding: '0.65rem 0.75rem',
                    borderRadius: '8px',
                    background: 'rgba(234, 179, 8, 0.12)',
                    color: 'rgb(113, 63, 18)',
                    fontSize: '0.82rem',
                    lineHeight: 1.45,
                  }}
                >
                  This live assistant has little or no instruction content yet. Add persona and goals before going live
                  with customers.
                </p>
              ) : null}
            </div>
          ) : (
            <div style={{ ...sectionCard, marginBottom: '1rem' }}>
              <p style={{ margin: '0 0 0.5rem', fontWeight: 700, color: 'var(--aisbp-text-heading, #0f172a)' }}>
                No live assistant
              </p>
              <p style={{ fontSize: '0.85rem', color: 'var(--aisbp-muted, #64748b)', margin: '0 0 0.75rem' }}>
                Choose a profile below and click <strong>Set active</strong>, or create a new profile.
              </p>
              <button type="button" onClick={onNewProfile} style={mvpPrimaryButtonStyle}>
                Create new profile
              </button>
            </div>
          )}

          <div id={layoutStyleId}>
            <aside style={{ minWidth: 0 }}>
              <h2
                style={{
                  fontSize: '0.82rem',
                  fontWeight: 800,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  color: 'var(--aisbp-muted, #64748b)',
                  margin: '0 0 0.65rem',
                }}
              >
                Assistant profiles
              </h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                {sortedProfiles.map(p => {
                  const selected = p.id === selectedProfileId;
                  return (
                    <div
                      key={p.id}
                      style={{
                        padding: '0.75rem 0.85rem',
                        borderRadius: '10px',
                        border: selected
                          ? '2px solid var(--aisbp-accent, #2563eb)'
                          : '1px solid var(--aisbp-border, #e2e8f0)',
                        background: selected ? 'rgba(37, 99, 235, 0.06)' : 'var(--aisbp-surface, #fff)',
                        boxShadow: p.isActive ? '0 1px 0 rgba(34, 197, 94, 0.25)' : undefined,
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => requestSelectProfile(p.id)}
                        style={{
                          display: 'block',
                          width: '100%',
                          textAlign: 'left',
                          padding: 0,
                          marginBottom: '0.5rem',
                          border: 'none',
                          background: 'transparent',
                          cursor: 'pointer',
                          font: 'inherit',
                        }}
                      >
                        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.4rem', marginBottom: '0.35rem' }}>
                          <span style={{ fontWeight: 700, color: 'var(--aisbp-text-heading, #0f172a)', fontSize: '0.92rem' }}>
                            {p.name.trim() || 'Untitled'}
                          </span>
                          {p.isActive ? <LiveBadge /> : <DraftBadge />}
                        </div>
                        {p.description?.trim() ? (
                          <p style={{ fontSize: '0.8rem', color: 'var(--aisbp-muted, #64748b)', margin: '0 0 0.35rem', lineHeight: 1.4 }}>
                            {p.description.trim()}
                          </p>
                        ) : null}
                        <p style={{ fontSize: '0.72rem', color: 'var(--aisbp-muted, #94a3b8)', margin: '0 0 0.35rem' }}>
                          Knowledge: {knowledgeScopeCardLabel(p.knowledgeScopeMode)}
                        </p>
                        <p style={{ fontSize: '0.72rem', color: 'var(--aisbp-muted, #94a3b8)', margin: 0 }}>
                          Updated {formatProfileUpdatedAt(p.updatedAt)}
                        </p>
                      </button>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                        <button
                          type="button"
                          onClick={() => requestSelectProfile(p.id)}
                          style={{ ...secondaryBtnStyle, padding: '0.3rem 0.55rem', fontSize: '0.78rem' }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          disabled={p.isActive}
                          onClick={() => activateProfileById(p.id)}
                          style={{ ...secondaryBtnStyle, padding: '0.3rem 0.55rem', fontSize: '0.78rem' }}
                        >
                          Set active
                        </button>
                        <button
                          type="button"
                          onClick={() => duplicateProfileById(p.id)}
                          style={{ ...secondaryBtnStyle, padding: '0.3rem 0.55rem', fontSize: '0.78rem' }}
                        >
                          Duplicate
                        </button>
                        <button
                          type="button"
                          disabled={profiles.length <= 1 || p.isActive}
                          onClick={() => onDeleteProfile(p.id)}
                          style={{
                            ...secondaryBtnStyle,
                            padding: '0.3rem 0.55rem',
                            fontSize: '0.78rem',
                            color: 'var(--aisbp-danger, #b91c1c)',
                            borderColor: 'rgba(185, 28, 28, 0.35)',
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
                <p style={{ fontSize: '0.78rem', color: 'rgb(180, 83, 9)', margin: '0.75rem 0 0', fontWeight: 600 }}>
                  Unsaved changes on this profile
                </p>
              ) : null}
            </aside>

            <div style={{ minWidth: 0 }}>
              {!selectedProfileId ? (
                <p style={{ fontSize: '0.9rem', color: 'var(--aisbp-muted, #64748b)' }}>Select a profile to edit.</p>
              ) : (
                <form onSubmit={onSavePrompt}>
                  <div style={{ ...sectionCard, marginBottom: '0.75rem' }}>
                    <p style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--aisbp-muted, #64748b)', margin: '0 0 0.5rem' }}>
                      {selectedRow?.isActive ? (
                        <span>
                          Editing live assistant <LiveBadge />
                        </span>
                      ) : (
                        <span>
                          Editing draft <DraftBadge />
                        </span>
                      )}
                    </p>
                    <div style={{ marginBottom: '0.65rem' }}>
                      <label style={mvpLabelStyle}>Profile name</label>
                      <input
                        style={{ ...mvpInputStyle, maxWidth: 'min(100%, 480px)' }}
                        value={profileName}
                        onChange={e => setProfileName(e.target.value)}
                        autoComplete="off"
                        aria-label="Profile name"
                      />
                    </div>
                    <div style={{ marginBottom: '0.5rem' }}>
                      <label style={mvpLabelStyle}>Description</label>
                      <input
                        style={{ ...mvpInputStyle, maxWidth: 'min(100%, 520px)' }}
                        value={description}
                        onChange={e => setDescription(e.target.value)}
                        placeholder="e.g. Salon Concierge"
                        autoComplete="off"
                      />
                      <p style={mvpFieldHint}>For your team only — helps tell assistant profiles apart.</p>
                    </div>
                  </div>

                  <div style={sectionCard}>
                    <h2
                      style={{
                        fontSize: '0.95rem',
                        fontWeight: 800,
                        margin: '0 0 0.5rem',
                        color: 'var(--aisbp-text-heading, #0f172a)',
                      }}
                    >
                      Knowledge scope
                    </h2>
                    <p style={{ fontSize: '0.8rem', color: 'var(--aisbp-muted, #64748b)', margin: '0 0 0.75rem', lineHeight: 1.45 }}>
                      Choose what this assistant profile is allowed to use from the workspace knowledge base.
                    </p>
                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '0.5rem',
                        marginBottom: '0.5rem',
                        cursor: 'pointer',
                        fontSize: '0.88rem',
                      }}
                    >
                      <input
                        type="radio"
                        name="knowledgeScope"
                        checked={knowledgeScopeMode === KNOWLEDGE_SCOPE_ALL_WORKSPACE}
                        onChange={() => setKnowledgeScopeMode(KNOWLEDGE_SCOPE_ALL_WORKSPACE)}
                      />
                      <span>
                        <strong>All workspace knowledge</strong>
                        <span style={{ display: 'block', fontSize: '0.78rem', color: 'var(--aisbp-muted, #94a3b8)', marginTop: '0.15rem' }}>
                          Default — full workspace knowledge base
                        </span>
                      </span>
                    </label>
                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '0.5rem',
                        marginBottom: '0.5rem',
                        cursor: 'not-allowed',
                        opacity: 0.65,
                        fontSize: '0.88rem',
                      }}
                    >
                      <input type="radio" name="knowledgeScope" disabled checked={false} readOnly />
                      <span>
                        <strong>Selected collections — coming soon</strong>
                        <span style={{ display: 'block', fontSize: '0.78rem', color: 'var(--aisbp-muted, #94a3b8)', marginTop: '0.15rem' }}>
                          Restrict to specific collections (not available yet)
                        </span>
                      </span>
                    </label>
                  </div>

                  <div style={sectionCard}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        justifyContent: 'space-between',
                        gap: '0.65rem',
                        marginBottom: '0.5rem',
                      }}
                    >
                      <h2
                        style={{
                          fontSize: '0.95rem',
                          fontWeight: 800,
                          margin: 0,
                          color: 'var(--aisbp-text-heading, #0f172a)',
                          flex: '1 1 auto',
                          minWidth: 0,
                        }}
                      >
                        Persona
                      </h2>
                      <button
                        type="button"
                        onClick={() => openPromptModal('persona')}
                        style={expandIconBtnStyle}
                        aria-label="Open persona editor in a large view"
                        title="Expand editor"
                      >
                        <ExpandEditorIcon />
                      </button>
                    </div>
                    <p style={{ fontSize: '0.8rem', color: 'var(--aisbp-muted, #64748b)', margin: '0 0 0.5rem' }}>
                      Identity, tone, and how the bot should sound.
                    </p>
                    <textarea
                      style={textareaStyle}
                      value={persona}
                      onChange={e => setPersona(e.target.value)}
                      aria-label="Bot Persona"
                    />
                    <p style={wordCountRowStyle}>{countWords(persona)} words</p>
                  </div>
                  <div style={sectionCard}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        justifyContent: 'space-between',
                        gap: '0.65rem',
                        marginBottom: '0.5rem',
                      }}
                    >
                      <h2
                        style={{
                          fontSize: '0.95rem',
                          fontWeight: 800,
                          margin: 0,
                          color: 'var(--aisbp-text-heading, #0f172a)',
                          flex: '1 1 auto',
                          minWidth: 0,
                        }}
                      >
                        Conversation goals
                      </h2>
                      <button
                        type="button"
                        onClick={() => openPromptModal('goals')}
                        style={expandIconBtnStyle}
                        aria-label="Open conversation goals editor in a large view"
                        title="Expand editor"
                      >
                        <ExpandEditorIcon />
                      </button>
                    </div>
                    <p style={{ fontSize: '0.8rem', color: 'var(--aisbp-muted, #64748b)', margin: '0 0 0.5rem' }}>
                      Outcomes, priorities, and what success looks like.
                    </p>
                    <textarea style={textareaStyle} value={goals} onChange={e => setGoals(e.target.value)} aria-label="Conversation goals" />
                    <p style={wordCountRowStyle}>{countWords(goals)} words</p>
                  </div>
                  <div style={sectionCard}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        justifyContent: 'space-between',
                        gap: '0.65rem',
                        marginBottom: '0.5rem',
                      }}
                    >
                      <h2
                        style={{
                          fontSize: '0.95rem',
                          fontWeight: 800,
                          margin: 0,
                          color: 'var(--aisbp-text-heading, #0f172a)',
                          flex: '1 1 auto',
                          minWidth: 0,
                        }}
                      >
                        Business notes
                      </h2>
                      <button
                        type="button"
                        onClick={() => openPromptModal('additional')}
                        style={expandIconBtnStyle}
                        aria-label="Open business notes editor in a large view"
                        title="Expand editor"
                      >
                        <ExpandEditorIcon />
                      </button>
                    </div>
                    <p style={{ fontSize: '0.8rem', color: 'var(--aisbp-muted, #64748b)', margin: '0 0 0.5rem' }}>
                      Guardrails, hours, products, or anything else the bot should know.
                    </p>
                    <textarea
                      style={textareaStyle}
                      value={additional}
                      onChange={e => setAdditional(e.target.value)}
                      aria-label="Business notes"
                    />
                    <p style={wordCountRowStyle}>{countWords(additional)} words</p>
                  </div>

                  <div
                    style={{
                      ...sectionCard,
                      display: 'grid',
                      gap: '0.85rem',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
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
                      <p style={mvpFieldHint}>
                        Balanced is the usual default. Your agency can limit how far each workspace can adjust style.
                      </p>
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
                    <div>
                      <label style={mvpLabelStyle}>Model override (Advanced)</label>
                      <input
                        style={mvpInputStyle}
                        value={modelOverride}
                        onChange={e => setModelOverride(e.target.value)}
                        placeholder="Optional model ID"
                        autoComplete="off"
                        disabled={!policy.allowModelOverride}
                      />
                      {!policy.allowModelOverride ? (
                        <p style={mvpFieldHint}>Your agency has disabled model overrides for workspaces.</p>
                      ) : null}
                    </div>
                  </div>

                  <details style={{ marginBottom: '0.75rem' }}>
                    <summary
                      style={{
                        cursor: 'pointer',
                        fontSize: '0.82rem',
                        fontWeight: 600,
                        color: 'var(--aisbp-muted, #64748b)',
                      }}
                    >
                      More behavior settings
                    </summary>
                    <div style={{ marginTop: '0.75rem', display: 'grid', gap: '0.85rem' }}>
                      <div>
                        <label style={mvpLabelStyle}>Tone rules</label>
                        <textarea
                          style={textareaStyle}
                          value={toneRules}
                          onChange={e => setToneRules(e.target.value)}
                          aria-label="Tone rules"
                        />
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
                        <label style={mvpLabelStyle}>Knowledge scope notes</label>
                        <textarea
                          style={textareaStyle}
                          value={knowledgeScopeNotes}
                          onChange={e => setKnowledgeScopeNotes(e.target.value)}
                          aria-label="Knowledge scope notes"
                        />
                      </div>
                    </div>
                  </details>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center', marginBottom: '1rem' }}>
                    <button type="submit" style={mvpPrimaryButtonStyle} disabled={saving || !selectedProfileId}>
                      {saving ? 'Saving…' : 'Save changes'}
                    </button>
                    <button
                      type="button"
                      onClick={() => selectedProfileId && activateProfileById(selectedProfileId)}
                      style={secondaryBtnStyle}
                      disabled={!selectedProfileId || Boolean(selectedRow?.isActive)}
                    >
                      Set active
                    </button>
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
                        ...secondaryBtnStyle,
                        color: 'var(--aisbp-danger, #b91c1c)',
                        borderColor: 'rgba(185, 28, 28, 0.35)',
                      }}
                      disabled={!selectedProfileId || profiles.length <= 1 || Boolean(selectedRow?.isActive)}
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

      {promptModal ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="aisbp-prompt-modal-title"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            background: 'rgba(15, 23, 42, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem',
          }}
          onClick={() => setPromptModal(null)}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 'min(920px, 100%)',
              maxHeight: 'min(90vh, 880px)',
              background: 'var(--aisbp-surface, #fff)',
              borderRadius: '12px',
              border: '1px solid var(--aisbp-border, #e2e8f0)',
              boxShadow: '0 24px 64px rgba(15, 23, 42, 0.18)',
              display: 'flex',
              flexDirection: 'column',
              padding: '1rem 1.15rem 1.1rem',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '0.75rem',
                marginBottom: '0.65rem',
              }}
            >
              <h2
                id="aisbp-prompt-modal-title"
                style={{
                  margin: 0,
                  fontSize: '1.05rem',
                  fontWeight: 800,
                  color: 'var(--aisbp-text-heading, #0f172a)',
                }}
              >
                {PROMPT_SECTION_MODAL_TITLE[promptModal.field]}
              </h2>
              <button
                type="button"
                onClick={() => setPromptModal(null)}
                aria-label="Close editor"
                style={{
                  ...expandIconBtnStyle,
                  border: '1px solid transparent',
                  background: 'transparent',
                  color: 'var(--aisbp-muted, #64748b)',
                  fontSize: '1.35rem',
                  lineHeight: 1,
                  fontWeight: 400,
                }}
              >
                ×
              </button>
            </div>
            <p style={{ fontSize: '0.8rem', color: 'var(--aisbp-muted, #64748b)', margin: '0 0 0.5rem', lineHeight: 1.45 }}>
              Edit below. Use <strong>Done</strong> to apply changes to the form, or close / Cancel / Esc to discard edits
              made only in this dialog.
            </p>
            <textarea
              value={promptModal.draft}
              onChange={e => setPromptModal(m => (m ? { ...m, draft: e.target.value } : null))}
              aria-label={PROMPT_SECTION_MODAL_TITLE[promptModal.field]}
              style={{
                ...mvpInputStyle,
                flex: 1,
                minHeight: 'min(58vh, 520px)',
                resize: 'vertical' as const,
                fontFamily: 'inherit',
                fontSize: '0.9rem',
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap' as const,
                overflowWrap: 'break-word' as const,
              }}
            />
            <p style={wordCountRowStyle}>{countWords(promptModal.draft)} words</p>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '0.5rem',
                justifyContent: 'flex-end',
                marginTop: '0.85rem',
              }}
            >
              <button
                type="button"
                onClick={() => setPromptModal(null)}
                style={{
                  padding: '0.45rem 0.9rem',
                  borderRadius: '8px',
                  border: '1px solid var(--aisbp-border, #e2e8f0)',
                  background: 'var(--aisbp-surface, #fff)',
                  color: 'var(--aisbp-text-secondary, #334155)',
                  fontSize: '0.88rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button type="button" onClick={applyPromptModal} style={{ ...mvpPrimaryButtonStyle, width: 'fit-content' }}>
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
