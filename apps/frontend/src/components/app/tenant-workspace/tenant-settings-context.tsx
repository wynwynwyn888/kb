'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import {
  getGhlConnection,
  getTenantById,
  listKbDocuments,
  type GhlConnectionStatus,
  type WorkspaceBotMode,
} from '@/lib/api';
import type { KnowledgeSetupStatus } from '@/lib/workspace-settings-display';

export type TenantSettingsPromptSnap = {
  name: string;
  temperature: number;
  modelOverride?: string;
  isActive?: boolean;
};

export type TenantSettingsContextValue = {
  tenantId: string;
  base: string;
  loading: boolean;
  err: string;
  reload: () => void;
  tenantName: string | null;
  tenantAgencyId: string | null;
  tenantStatus: string | null;
  botMode: WorkspaceBotMode;
  promptConfigSnap: TenantSettingsPromptSnap | null;
  ghl: GhlConnectionStatus | null;
  ghlLoadErr: string;
  canRenameWorkspace: boolean;
  knowledgeSetupStatus: KnowledgeSetupStatus;
};

const TenantSettingsContext = createContext<TenantSettingsContextValue | null>(null);

export function TenantSettingsProvider({ children }: { children: ReactNode }) {
  const params = useParams();
  const tenantId = params['tenantId'] as string;
  const { token, user } = useAuth();
  const base = `/app/tenant/${tenantId}`;

  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [tenantName, setTenantName] = useState<string | null>(null);
  const [tenantAgencyId, setTenantAgencyId] = useState<string | null>(null);
  const [tenantStatus, setTenantStatus] = useState<string | null>(null);
  const [botMode, setBotMode] = useState<WorkspaceBotMode>('autopilot');
  const [promptConfigSnap, setPromptConfigSnap] = useState<TenantSettingsPromptSnap | null>(null);
  const [ghl, setGhl] = useState<GhlConnectionStatus | null>(null);
  const [ghlLoadErr, setGhlLoadErr] = useState('');
  const [knowledgeSetupStatus, setKnowledgeSetupStatus] = useState<KnowledgeSetupStatus>('unknown');

  useEffect(() => {
    if (!token || !tenantId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr('');
      setGhlLoadErr('');
      try {
        const [tenant, g, kbDocs] = await Promise.all([
          getTenantById(token, tenantId),
          getGhlConnection(token, tenantId).catch(e => {
            if (!cancelled) setGhlLoadErr(e instanceof Error ? e.message : 'CRM connection could not be loaded');
            return null;
          }),
          listKbDocuments(token, tenantId).catch(() => null),
        ]);
        if (cancelled) return;
        if (g) setGhl(g);
        if (kbDocs === null) {
          setKnowledgeSetupStatus('unknown');
        } else {
          setKnowledgeSetupStatus(Array.isArray(kbDocs) && kbDocs.length > 0 ? 'ready' : 'empty');
        }
        setTenantName(tenant?.name ?? null);
        setTenantAgencyId(tenant?.agencyId ?? null);
        setTenantStatus(tenant?.status ?? null);
        if (tenant?.botMode) setBotMode(tenant.botMode);
        const pc = tenant?.promptConfig;
        setPromptConfigSnap(
          pc
            ? {
                name: pc.name,
                temperature: pc.temperature,
                modelOverride: pc.modelOverride,
                isActive: pc.isActive,
              }
            : null,
        );
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : 'Failed to load settings');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, tenantId, loadAttempt]);

  const reload = useCallback(() => setLoadAttempt(a => a + 1), []);

  const canRenameWorkspace = Boolean(user?.agencyId && tenantAgencyId && user.agencyId === tenantAgencyId);

  const value = useMemo(
    (): TenantSettingsContextValue => ({
      tenantId,
      base,
      loading,
      err,
      reload,
      tenantName,
      tenantAgencyId,
      tenantStatus,
      botMode,
      promptConfigSnap,
      ghl,
      ghlLoadErr,
      canRenameWorkspace,
      knowledgeSetupStatus,
    }),
    [
      tenantId,
      base,
      loading,
      err,
      reload,
      tenantName,
      tenantAgencyId,
      tenantStatus,
      botMode,
      promptConfigSnap,
      ghl,
      ghlLoadErr,
      canRenameWorkspace,
      knowledgeSetupStatus,
    ],
  );

  return <TenantSettingsContext.Provider value={value}>{children}</TenantSettingsContext.Provider>;
}

export function useTenantSettings(): TenantSettingsContextValue {
  const ctx = useContext(TenantSettingsContext);
  if (!ctx) {
    throw new Error('useTenantSettings must be used within TenantSettingsProvider');
  }
  return ctx;
}
