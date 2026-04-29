'use client';

import { createPortal } from 'react-dom';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getAgencyById, getMyTenants, getTenantById, getTenantsByAgency } from '@/lib/api';
import { getSubaccountSwitchHref } from '@/components/app/tenant-workspace/path';
import { TENANT_WORKSPACE_META_CHANGED, type TenantWorkspaceMetaDetail } from '@/lib/workspace-events';

type SubaccountRow = { id: string; name: string; ghlLocationId?: string | null; status?: string };

const PANEL_WIDTH = 320;

const triggerBtn: CSSProperties = {
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.5rem',
  padding: '0.5rem 0.65rem',
  borderRadius: '8px',
  border: '1px solid var(--aisbp-border-strong, #d1d5db)',
  background: 'var(--aisbp-surface, #fff)',
  fontSize: '0.82rem',
  fontWeight: 600,
  color: 'var(--aisbp-text-heading, #0f172a)',
  cursor: 'pointer',
  textAlign: 'left' as const,
  boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
};

const panelBoxStyle = (top: number, left: number): CSSProperties => ({
  position: 'fixed',
  top,
  left,
  width: PANEL_WIDTH,
  maxHeight: 'min(420px, calc(100dvh - 16px))',
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--aisbp-surface, #fff)',
  border: '1px solid var(--aisbp-border, #e2e8f0)',
  borderRadius: '10px',
  boxShadow: '0 12px 32px rgba(15, 23, 42, 0.12), 0 4px 8px rgba(15, 23, 42, 0.06)',
  zIndex: 9999,
  overflow: 'hidden',
  color: 'var(--aisbp-text, #0f172a)',
});

const agencyViewBtn: CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '0.55rem 0.75rem',
  fontSize: '0.8rem',
  fontWeight: 700,
  border: '1px solid #0f172a',
  background: '#0f172a',
  color: '#fff',
  borderRadius: '8px',
  cursor: 'pointer',
  textAlign: 'center' as const,
  margin: '0.4rem 0.5rem 0.5rem',
};

const searchInp: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '0.4rem 0.55rem',
  borderRadius: '6px',
  border: '1px solid var(--aisbp-border-strong, #d1d5db)',
  background: 'var(--aisbp-input-bg, #fff)',
  color: 'var(--aisbp-text, #0f172a)',
  fontSize: '0.8rem',
  margin: '0 0.5rem 0.45rem',
  maxWidth: 'calc(100% - 1rem)',
  alignSelf: 'center' as const,
};

export function WorkspaceSwitcher() {
  const pathname = usePathname() ?? '';
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user, token } = useAuth();
  const subPath = pathname.match(/^\/app\/tenant\/([^/]+)/);
  const activeSubaccountId = subPath?.[1] ?? null;
  const isSubaccountRoute = Boolean(activeSubaccountId);
  const isGhlSettings = pathname.startsWith('/app/agency/settings/ghl');
  const ghlSubParam = searchParams.get('subaccount') ?? searchParams.get('tenant');
  const isAgencyRoute = pathname.startsWith('/app/agency');

  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [panelPos, setPanelPos] = useState<{ top: number; left: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const [subTitleName, setSubTitleName] = useState<string | null>(null);
  const [agencyName, setAgencyName] = useState<string | null>(null);
  const [subaccounts, setSubaccounts] = useState<SubaccountRow[]>([]);
  const [listErr, setListErr] = useState('');

  const loadSubName = useCallback(async () => {
    if (!token || !activeSubaccountId) return;
    try {
      const t = await getTenantById(token, activeSubaccountId);
      setSubTitleName(t?.name ?? null);
    } catch {
      setSubTitleName(null);
    }
  }, [token, activeSubaccountId]);

  const loadAgencyName = useCallback(async () => {
    if (!token || !user?.agencyId) {
      setAgencyName(null);
      return;
    }
    try {
      const a = await getAgencyById(token, user.agencyId);
      setAgencyName(a?.name ?? null);
    } catch {
      setAgencyName(null);
    }
  }, [token, user?.agencyId]);

  const loadList = useCallback(async () => {
    if (!token) return;
    setListErr('');
    try {
      if (user?.agencyRole && user.agencyId) {
        const rows = await getTenantsByAgency(token, user.agencyId);
        setSubaccounts(Array.isArray(rows) ? rows : []);
        return;
      }
      const rows = await getMyTenants(token);
      setSubaccounts(Array.isArray(rows) ? rows : []);
    } catch (e) {
      setSubaccounts([]);
      setListErr(e instanceof Error ? e.message : 'Could not load subaccounts');
    }
  }, [token, user?.agencyId, user?.agencyRole]);

  useEffect(() => {
    void loadSubName();
  }, [loadSubName]);

  useEffect(() => {
    void loadAgencyName();
  }, [loadAgencyName]);

  useEffect(() => {
    if (token && user) void loadList();
  }, [token, user, loadList]);

  useEffect(() => {
    const onWorkspaceMeta = (ev: Event) => {
      const ce = ev as CustomEvent<TenantWorkspaceMetaDetail>;
      const tid = ce.detail?.tenantId?.trim();
      if (!tid) return;
      void loadList();
      if (tid === activeSubaccountId) void loadSubName();
    };
    window.addEventListener(TENANT_WORKSPACE_META_CHANGED, onWorkspaceMeta);
    return () => window.removeEventListener(TENANT_WORKSPACE_META_CHANGED, onWorkspaceMeta);
  }, [activeSubaccountId, loadList, loadSubName]);

  const selectedGhlName = useMemo(() => {
    if (!isGhlSettings || !ghlSubParam) return null;
    return subaccounts.find(s => s.id === ghlSubParam)?.name ?? null;
  }, [isGhlSettings, ghlSubParam, subaccounts]);

  const triggerLabel = useMemo(() => {
    if (user?.agencyRole) {
      if (isSubaccountRoute) {
        return subTitleName ?? 'Subaccount';
      }
      if (isGhlSettings && ghlSubParam) {
        return selectedGhlName ? `GHL · ${selectedGhlName}` : 'GHL · subaccount';
      }
      if (isAgencyRoute) {
        return agencyName ?? 'Agency account';
      }
    }
    if (isSubaccountRoute) {
      return subTitleName ?? 'Subaccount';
    }
    if (isGhlSettings && ghlSubParam) {
      return selectedGhlName ? `GHL · ${selectedGhlName}` : 'GHL';
    }
    return 'Workspace';
  }, [
    user?.agencyRole,
    isSubaccountRoute,
    isGhlSettings,
    ghlSubParam,
    isAgencyRoute,
    agencyName,
    subTitleName,
    selectedGhlName,
  ]);

  const triggerTitle = useMemo(() => {
    if (user?.agencyRole && isAgencyRoute && !isSubaccountRoute && !(isGhlSettings && ghlSubParam)) {
      return `Agency account · ${agencyName ?? '—'}`;
    }
    return triggerLabel;
  }, [user?.agencyRole, isAgencyRoute, isSubaccountRoute, isGhlSettings, ghlSubParam, agencyName, triggerLabel]);

  const showAgencyTwoLine =
    Boolean(user?.agencyRole) && isAgencyRoute && !isSubaccountRoute && !(isGhlSettings && ghlSubParam);

  const showSwitcher = Boolean(user?.agencyRole) || subaccounts.length > 0;

  const onPickSub = (id: string) => {
    const href = getSubaccountSwitchHref(pathname, id);
    router.push(href);
    setOpen(false);
    setQ('');
  };

  const goAgency = () => {
    router.push('/app/agency');
    setOpen(false);
  };

  const placePanel = useCallback(() => {
    const btn = buttonRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    let left = r.right + 8;
    if (left + PANEL_WIDTH > window.innerWidth - 12) {
      left = Math.max(12, r.left - PANEL_WIDTH - 8);
    }
    const top = Math.max(8, Math.min(r.top, window.innerHeight - 120));
    setPanelPos({ top, left });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPanelPos(null);
      return;
    }
    placePanel();
    window.addEventListener('resize', placePanel);
    window.addEventListener('scroll', placePanel, true);
    return () => {
      window.removeEventListener('resize', placePanel);
      window.removeEventListener('scroll', placePanel, true);
    };
  }, [open, placePanel]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return subaccounts;
    return subaccounts.filter(t => t.name.toLowerCase().includes(s) || t.id.toLowerCase().includes(s));
  }, [subaccounts, q]);

  if (!user) return null;
  if (!showSwitcher) return null;

  const canShowAgencySwitch = Boolean(user.agencyRole);
  const inSubContext = Boolean(
    (isSubaccountRoute && activeSubaccountId) || (isGhlSettings && ghlSubParam),
  );

  const listSelectedId = isSubaccountRoute ? activeSubaccountId : isGhlSettings ? ghlSubParam : null;

  const panelContent = open && panelPos && (
    <div id="ws-panel" ref={panelRef} style={panelBoxStyle(panelPos.top, panelPos.left)} role="dialog" aria-label="Switch workspace">
      {canShowAgencySwitch && inSubContext ? (
        <button type="button" style={agencyViewBtn} onClick={goAgency}>
          Back to agency account
        </button>
      ) : null}
      {canShowAgencySwitch && !inSubContext && isAgencyRoute ? (
        <p
          style={{
            fontSize: '0.7rem',
            fontWeight: 700,
            color: 'var(--aisbp-muted, #94a3b8)',
            textTransform: 'uppercase' as const,
            letterSpacing: '0.08em',
            margin: '0.4rem 0.75rem 0',
          }}
        >
          Subaccounts
        </p>
      ) : null}
      {listErr ? <p style={{ fontSize: '0.75rem', color: '#b91c1c', margin: '0.35rem 0.75rem' }}>{listErr}</p> : null}
      <input
        type="search"
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder="Search subaccounts"
        style={searchInp}
        aria-label="Filter subaccounts"
        autoFocus
      />
      <ul
        style={{
          listStyle: 'none',
          margin: 0,
          padding: '0.25rem 0.4rem 0.5rem',
          overflowY: 'auto' as const,
          flex: 1,
        }}
      >
        {filtered.length === 0 ? (
          <li style={{ fontSize: '0.8rem', color: 'var(--aisbp-muted, #94a3b8)', padding: '0.5rem 0.4rem' }}>No matches</li>
        ) : (
          filtered.map(s => {
            const isSel = listSelectedId === s.id;
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => onPickSub(s.id)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '0.5rem 0.55rem',
                    border: '1px solid',
                    borderColor: isSel ? '#0f62fe' : 'transparent',
                    background: isSel ? 'rgba(15, 98, 254, 0.08)' : 'transparent',
                    color: 'var(--aisbp-text-heading, #0f172a)',
                    borderRadius: '6px',
                    fontSize: '0.8rem',
                    fontWeight: isSel ? 700 : 500,
                    cursor: 'pointer',
                    marginBottom: 2,
                  }}
                >
                  {s.name}
                </button>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );

  return (
    <div ref={rootRef} style={{ position: 'relative', marginBottom: '0.85rem', zIndex: 5 }}>
      <p style={{ fontSize: '0.62rem', textTransform: 'uppercase' as const, letterSpacing: '0.1em', color: 'var(--aisbp-muted, #94a3b8)', fontWeight: 800, margin: '0 0 0.35rem' }}>Workspace</p>
      <button
        ref={buttonRef}
        type="button"
        style={triggerBtn}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-controls="ws-panel"
        title={triggerTitle}
      >
        {showAgencyTwoLine ? (
          <span style={{ flex: 1, minWidth: 0, textAlign: 'left' as const }}>
            <span
              style={{
                display: 'block',
                fontSize: '0.62rem',
                fontWeight: 700,
                color: 'var(--aisbp-muted, #64748b)',
                letterSpacing: '0.04em',
                textTransform: 'uppercase' as const,
                lineHeight: 1.2,
              }}
            >
              Agency account
            </span>
            <span
              style={{
                display: 'block',
                marginTop: 2,
                fontSize: '0.84rem',
                fontWeight: 700,
                color: 'var(--aisbp-text-heading, #0f172a)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap' as const,
              }}
            >
              {agencyName ?? '—'}
            </span>
          </span>
        ) : (
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{triggerLabel}</span>
        )}
        <span style={{ color: 'var(--aisbp-muted, #64748b)', fontSize: '0.7rem', flexShrink: 0 }} aria-hidden>
          ▾
        </span>
      </button>

      {typeof document !== 'undefined' && panelContent ? createPortal(panelContent, document.body) : null}
    </div>
  );
}
