'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  getCurrentUser,
  getQuotaAgencySettings,
  getQuotaAuditLog,
  getTenantsByAgency,
  setAgencyDefaultQuota,
  topupSubaccountQuota,
  type QuotaAuditLogRow,
} from '@/lib/api';
import { ErrorBanner, LoadingBlock, PageHeader, SectionCard } from '@/components/app/mvp-ui';

export default function AgencyQuotasPage() {
  const { token } = useAuth();
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [agencyId, setAgencyId] = useState<string | null>(null);
  const [defaultQuota, setDefaultQuota] = useState<number | null>(null);
  const [defaultInput, setDefaultInput] = useState('');
  const [savingDefault, setSavingDefault] = useState(false);

  const [tenants, setTenants] = useState<Array<{ id: string; name: string }>>([]);
  const [topupTenant, setTopupTenant] = useState('');
  const [topupAmount, setTopupAmount] = useState('');
  const [topupNote, setTopupNote] = useState('');
  const [savingTopup, setSavingTopup] = useState(false);
  const [topupMsg, setTopupMsg] = useState('');

  const [audit, setAudit] = useState<QuotaAuditLogRow[] | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setErr('');
    try {
      const me = await getCurrentUser(token);
      const aid = me.agencyId;
      if (!aid) {
        setErr('No agency on this session.');
        return;
      }
      setAgencyId(aid);
      const [settings, tlist, log] = await Promise.all([
        getQuotaAgencySettings(token),
        getTenantsByAgency(token, aid),
        getQuotaAuditLog(token, { limit: 80 }),
      ]);
      setDefaultQuota(settings.defaultSubaccountQuota);
      setDefaultInput(String(settings.defaultSubaccountQuota ?? 0));
      setTenants(tlist.map(t => ({ id: t.id, name: t.name })));
      setAudit(log);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const onSaveDefault = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) return;
    const n = parseInt(defaultInput, 10);
    if (!Number.isFinite(n) || n < 0) {
      setErr('Default quota must be a non-negative number');
      return;
    }
    setSavingDefault(true);
    setErr('');
    try {
      const r = await setAgencyDefaultQuota(token, n);
      setDefaultQuota(r.defaultSubaccountQuota);
      setDefaultInput(String(r.defaultSubaccountQuota));
      setAudit(await getQuotaAuditLog(token, { limit: 80 }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSavingDefault(false);
    }
  };

  const onTopup = async (e: FormEvent) => {
    e.preventDefault();
    if (!token || !topupTenant) return;
    const amt = parseInt(topupAmount, 10);
    if (!Number.isFinite(amt) || amt <= 0) {
      setTopupMsg('Amount must be a positive number');
      return;
    }
    setSavingTopup(true);
    setTopupMsg('');
    setErr('');
    try {
      const r = await topupSubaccountQuota(token, {
        tenantId: topupTenant,
        amount: amt,
        note: topupNote.trim() || undefined,
      });
      setTopupMsg(`Credited: +${r.delta} (total ${r.newTotal}, was ${r.previousTotal})`);
      setTopupAmount('');
      setTopupNote('');
      setAudit(await getQuotaAuditLog(token, { limit: 80 }));
    } catch (e) {
      setTopupMsg(e instanceof Error ? e.message : 'Top-up failed');
    } finally {
      setSavingTopup(false);
    }
  };

  if (loading) {
    return (
      <div>
        <PageHeader title="Quotas" eyebrow="Agency" />
        <LoadingBlock message="Loading quota settings…" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Quotas" eyebrow="Agency" />
      <p style={{ fontSize: '0.8rem', color: '#64748b', margin: '0 0 1rem', maxWidth: '48rem' }}>
        Set the default credit applied to new subaccount wallets, top up a specific client, and review the audit log (who
        changed policy and when). Subaccount usage still appears on each subaccount’s usage page.
      </p>
      {err ? <ErrorBanner message={err} /> : null}

      <SectionCard title="Default quota for new subaccounts" subtitle="Stored on the agency; applied when wallets are created for new clients">
        {defaultQuota !== null ? (
          <p style={{ fontSize: '0.85rem', color: '#334155', marginTop: 0 }}>
            Current default: <strong>{defaultQuota.toLocaleString()}</strong> credits
          </p>
        ) : null}
        <form onSubmit={onSaveDefault} style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <span style={{ fontSize: '0.8rem', color: '#64748b' }}>Default (credits)</span>
            <input
              value={defaultInput}
              onChange={e => setDefaultInput(e.target.value)}
              type="number"
              min={0}
              style={{ width: '8rem', padding: '0.45rem 0.5rem', borderRadius: '6px', border: '1px solid #e2e8f0' }}
            />
          </label>
          <button type="submit" disabled={savingDefault} style={{ padding: '0.45rem 0.9rem' }}>
            {savingDefault ? 'Saving…' : 'Save default'}
          </button>
        </form>
      </SectionCard>

      <SectionCard title="Top up a subaccount" subtitle="Credit the subaccount wallet (agency members).">
        <form
          onSubmit={onTopup}
          style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', maxWidth: '28rem' }}
        >
          <label>
            <span style={{ display: 'block', fontSize: '0.75rem', color: '#64748b' }}>Subaccount</span>
            <select
              value={topupTenant}
              onChange={e => setTopupTenant(e.target.value)}
              required
              style={{ width: '100%', padding: '0.45rem 0.5rem', borderRadius: '6px', border: '1px solid #e2e8f0' }}
            >
              <option value="">— Select —</option>
              {tenants.map(t => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span style={{ display: 'block', fontSize: '0.75rem', color: '#64748b' }}>Amount (credits to add)</span>
            <input
              value={topupAmount}
              onChange={e => setTopupAmount(e.target.value)}
              type="number"
              min={1}
              required
              style={{ width: '100%', padding: '0.45rem 0.5rem', borderRadius: '6px', border: '1px solid #e2e8f0' }}
            />
          </label>
          <label>
            <span style={{ display: 'block', fontSize: '0.75rem', color: '#64748b' }}>Note (optional)</span>
            <input
              value={topupNote}
              onChange={e => setTopupNote(e.target.value)}
              style={{ width: '100%', padding: '0.45rem 0.5rem', borderRadius: '6px', border: '1px solid #e2e8f0' }}
            />
          </label>
          <button type="submit" disabled={savingTopup} style={{ width: 'fit-content', padding: '0.45rem 0.9rem' }}>
            {savingTopup ? 'Applying…' : 'Apply top-up'}
          </button>
          {topupMsg ? (
            <p style={{ fontSize: '0.82rem', color: '#14532d', margin: 0 }}>{topupMsg}</p>
          ) : null}
        </form>
      </SectionCard>

      <SectionCard title="Audit log" subtitle="Recent quota policy changes and manual top-ups">
        {!audit || audit.length === 0 ? (
          <p style={{ fontSize: '0.85rem', color: '#64748b' }}>No entries yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: '0.8rem',
              }}
            >
              <thead>
                <tr>
                  <th
                    style={{
                      textAlign: 'left',
                      padding: '0.45rem',
                      borderBottom: '1px solid #e2e8f0',
                      color: '#64748b',
                      fontSize: '0.7rem',
                    }}
                  >
                    When
                  </th>
                  <th
                    style={{
                      textAlign: 'left',
                      padding: '0.45rem',
                      borderBottom: '1px solid #e2e8f0',
                      color: '#64748b',
                      fontSize: '0.7rem',
                    }}
                  >
                    Action
                  </th>
                  <th
                    style={{
                      textAlign: 'left',
                      padding: '0.45rem',
                      borderBottom: '1px solid #e2e8f0',
                      color: '#64748b',
                      fontSize: '0.7rem',
                    }}
                  >
                    Who
                  </th>
                  <th
                    style={{
                      textAlign: 'left',
                      padding: '0.45rem',
                      borderBottom: '1px solid #e2e8f0',
                      color: '#64748b',
                      fontSize: '0.7rem',
                    }}
                  >
                    Subaccount
                  </th>
                  <th
                    style={{
                      textAlign: 'left',
                      padding: '0.45rem',
                      borderBottom: '1px solid #e2e8f0',
                      color: '#64748b',
                      fontSize: '0.7rem',
                    }}
                  >
                    Delta / range
                  </th>
                </tr>
              </thead>
              <tbody>
                {audit.map(row => (
                  <tr key={row.id}>
                    <td style={{ padding: '0.45rem', borderBottom: '1px solid #f1f5f9' }}>
                      {row.created_at ? new Date(row.created_at).toLocaleString() : '—'}
                    </td>
                    <td style={{ padding: '0.45rem', borderBottom: '1px solid #f1f5f9' }}>{row.action}</td>
                    <td style={{ padding: '0.45rem', borderBottom: '1px solid #f1f5f9', fontSize: '0.8rem' }}>
                      {row.actorEmail ?? row.profile_id}
                    </td>
                    <td style={{ padding: '0.45rem', borderBottom: '1px solid #f1f5f9', fontFamily: 'ui-monospace, monospace', fontSize: '0.72rem' }}>
                      {row.tenant_id ?? '—'}
                    </td>
                    <td style={{ padding: '0.45rem', borderBottom: '1px solid #f1f5f9' }}>
                      {row.action === 'agency.default_quota' ? (
                        <span>
                          {row.previous_total ?? '—'} → {row.new_total ?? '—'}
                        </span>
                      ) : (
                        <span>
                          +{row.delta} (total {row.previous_total ?? '—'} → {row.new_total ?? '—'})
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ fontSize: '0.72rem', color: '#94a3b8', margin: '0.5rem 0 0' }}>Agency: {agencyId}</p>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
