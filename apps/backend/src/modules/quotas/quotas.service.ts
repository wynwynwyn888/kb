// Quotas service — wallets, top-ups, agency default, audit.

import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { getSupabaseService } from '../../lib/supabase';
import { randomUUID } from 'node:crypto';

@Injectable()
export class QuotasService {
  private readonly logger = new Logger(QuotasService.name);
  private readonly supabase = getSupabaseService();

  constructor(
    @InjectQueue('quota-threshold-alert') private readonly alertQueue: Queue,
  ) {}

  async checkQuota(tenantId: string, amount: number): Promise<boolean> {
    const { data: wallet, error } = await this.supabase
      .from('quota_wallets')
      .select('total_quota, used_quota')
      .eq('tenant_id', tenantId)
      .single();

    if (error || !wallet) {
      return true;
    }

    return wallet.total_quota - wallet.used_quota >= amount;
  }

  async setAgencyDefaultQuota(agencyId: string, profileId: string, defaultQuota: number) {
    await this.assertAgencyStaff(agencyId, profileId);
    if (!Number.isFinite(defaultQuota) || defaultQuota < 0) {
      throw new ForbiddenException('Invalid default quota');
    }
    const { data: prev } = await this.supabase
      .from('agencies')
      .select('default_subaccount_quota')
      .eq('id', agencyId)
      .single();

    const { error } = await this.supabase
      .from('agencies')
      .update({
        default_subaccount_quota: Math.floor(defaultQuota),
        updated_at: new Date().toISOString(),
      })
      .eq('id', agencyId);
    if (error) throw new Error(error.message);

    await this.supabase.from('quota_audit_logs').insert({
      id: randomUUID(),
      agency_id: agencyId,
      profile_id: profileId,
      tenant_id: null,
      action: 'agency.default_quota',
      delta: 0,
      previous_total: (prev as { default_subaccount_quota?: number })?.default_subaccount_quota ?? null,
      new_total: Math.floor(defaultQuota),
      metadata: { field: 'default_subaccount_quota' },
    });
    return { defaultSubaccountQuota: Math.floor(defaultQuota) };
  }

  async topUpSubaccount(agencyId: string, profileId: string, tenantId: string, amount: number, note?: string) {
    await this.assertAgencyStaff(agencyId, profileId);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new ForbiddenException('Top-up amount must be positive');
    }

    const { data: t } = await this.supabase.from('tenants').select('id, agency_id').eq('id', tenantId).single();
    if (!t || t.agency_id !== agencyId) {
      throw new NotFoundException('Subaccount not in this agency');
    }

    const { data: wallet } = await this.supabase
      .from('quota_wallets')
      .select('id, total_quota, used_quota')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    const add = Math.floor(amount);
    const prevTotal = wallet?.total_quota ?? 0;
    const newTotal = prevTotal + add;

    if (wallet) {
      await this.supabase
        .from('quota_wallets')
        .update({ total_quota: newTotal, updated_at: new Date().toISOString() })
        .eq('id', wallet.id);
      await this.supabase.from('quota_ledgers').insert({
        id: randomUUID(),
        wallet_id: wallet.id,
        amount: add,
        type: 'CREDIT',
        movement_type: 'top_up',
        balance_after: newTotal - (wallet.used_quota ?? 0),
        metadata: { note: note ?? null },
        created_by_user_id: profileId,
        description: note?.trim() || 'Manual top-up',
      });
    } else {
      const now = new Date();
      const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      const wid = randomUUID();
      await this.supabase.from('quota_wallets').insert({
        id: wid,
        tenant_id: tenantId,
        total_quota: newTotal,
        used_quota: 0,
        period_start: periodStart.toISOString(),
        period_end: periodEnd.toISOString(),
      });
      await this.supabase.from('quota_ledgers').insert({
        id: randomUUID(),
        wallet_id: wid,
        amount: add,
        type: 'CREDIT',
        movement_type: 'top_up',
        balance_after: newTotal,
        metadata: { note: note ?? null, walletCreated: true },
        created_by_user_id: profileId,
        description: note?.trim() || 'Manual top-up (wallet created)',
      });
    }

    await this.supabase.from('quota_audit_logs').insert({
      id: randomUUID(),
      agency_id: agencyId,
      profile_id: profileId,
      tenant_id: tenantId,
      action: 'subaccount.topup',
      delta: add,
      previous_total: prevTotal,
      new_total: newTotal,
      metadata: { note: note ?? null },
    });

    return { tenantId, previousTotal: prevTotal, newTotal, delta: add };
  }

  async adjustSubaccountCredits(
    agencyId: string,
    profileId: string,
    tenantId: string,
    delta: number,
    reason?: string,
  ) {
    await this.assertAgencyStaff(agencyId, profileId);
    if (!Number.isFinite(delta) || delta === 0) {
      throw new ForbiddenException('delta must be a non-zero number');
    }
    const { data: t } = await this.supabase.from('tenants').select('id, agency_id').eq('id', tenantId).single();
    if (!t || t.agency_id !== agencyId) {
      throw new NotFoundException('Subaccount not in this agency');
    }

    const { data: wallet } = await this.supabase
      .from('quota_wallets')
      .select('id, total_quota, used_quota')
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (!wallet) throw new NotFoundException('Wallet not found');

    const d = Math.trunc(delta);
    const prevTotal = wallet.total_quota ?? 0;
    const nextTotal = prevTotal + d;
    await this.supabase
      .from('quota_wallets')
      .update({ total_quota: nextTotal, updated_at: new Date().toISOString() })
      .eq('id', wallet.id);

    const balanceAfter = nextTotal - (wallet.used_quota ?? 0);
    await this.supabase.from('quota_ledgers').insert({
      id: randomUUID(),
      wallet_id: wallet.id,
      amount: Math.abs(d),
      type: d >= 0 ? 'CREDIT' : 'DEBIT',
      movement_type: 'manual_adjustment',
      balance_after: balanceAfter,
      metadata: { reason: reason ?? null },
      created_by_user_id: profileId,
      description: reason?.trim() || 'Manual adjustment',
    });

    await this.supabase.from('quota_audit_logs').insert({
      id: randomUUID(),
      agency_id: agencyId,
      profile_id: profileId,
      tenant_id: tenantId,
      action: 'subaccount.manual_adjustment',
      delta: d,
      previous_total: prevTotal,
      new_total: nextTotal,
      metadata: { reason: reason ?? null },
    });

    return { tenantId, previousTotal: prevTotal, newTotal: nextTotal, delta: d, balanceAfter };
  }

  async updateWalletPolicy(
    agencyId: string,
    profileId: string,
    tenantId: string,
    input: { allowNegativeCredits?: boolean; negativeCreditLimit?: number; lowCreditThreshold?: number },
  ) {
    await this.assertAgencyStaff(agencyId, profileId);
    const { data: t } = await this.supabase.from('tenants').select('id, agency_id').eq('id', tenantId).single();
    if (!t || t.agency_id !== agencyId) {
      throw new NotFoundException('Subaccount not in this agency');
    }

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.allowNegativeCredits !== undefined) patch['allow_negative_credits'] = Boolean(input.allowNegativeCredits);
    if (input.negativeCreditLimit !== undefined) patch['negative_credit_limit'] = Math.trunc(input.negativeCreditLimit);
    if (input.lowCreditThreshold !== undefined) patch['low_credit_threshold'] = Math.max(0, Math.trunc(input.lowCreditThreshold));

    const { error } = await this.supabase.from('quota_wallets').update(patch).eq('tenant_id', tenantId);
    if (error) throw new Error(error.message);

    await this.supabase.from('quota_audit_logs').insert({
      id: randomUUID(),
      agency_id: agencyId,
      profile_id: profileId,
      tenant_id: tenantId,
      action: 'subaccount.wallet_policy',
      delta: 0,
      previous_total: null,
      new_total: null,
      metadata: patch,
    });

    return { tenantId, ...input };
  }

  async getQuotaAuditLog(agencyId: string, profileId: string, opts?: { tenantId?: string; limit?: number }) {
    await this.assertAgencyStaff(agencyId, profileId);
    const lim = Math.min(200, Math.max(1, opts?.limit ?? 50));
    let q = this.supabase
      .from('quota_audit_logs')
      .select('id, agency_id, profile_id, tenant_id, action, delta, previous_total, new_total, metadata, created_at')
      .eq('agency_id', agencyId)
      .order('created_at', { ascending: false })
      .limit(lim);
    if (opts?.tenantId) {
      q = q.eq('tenant_id', opts.tenantId);
    }
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    const pids = [...new Set(rows.map(r => r.profile_id).filter(Boolean))] as string[];
    if (pids.length === 0) return rows;
    const { data: profs } = await this.supabase
      .from('profiles')
      .select('id, email, full_name')
      .in('id', pids);
    const pmap = new Map((profs ?? []).map(p => [p.id as string, p as { email?: string; full_name?: string }]));
    return rows.map(r => {
      const p = r.profile_id ? pmap.get(r.profile_id) : undefined;
      return {
        ...r,
        actorEmail: p?.email ?? null,
        actorName: p?.full_name ?? null,
      };
    });
  }

  async getAgencyQuotaSettings(agencyId: string, profileId: string) {
    await this.assertAgencyStaff(agencyId, profileId);
    const { data, error } = await this.supabase
      .from('agencies')
      .select('id, default_subaccount_quota, active_ai_provider')
      .eq('id', agencyId)
      .single();
    if (error || !data) throw new NotFoundException('Agency not found');
    return {
      agencyId: data.id,
      defaultSubaccountQuota: (data as { default_subaccount_quota: number }).default_subaccount_quota,
    };
  }

  async getTenantUsageSummary(tenantId: string): Promise<{
    tenantId: string;
    totalQuota: number;
    usedQuota: number;
    balance: number;
    allowNegativeCredits: boolean;
    negativeCreditLimit: number;
    lowCreditThreshold: number;
    usedToday: number;
    usedThisMonth: number;
    status: 'ACTIVE' | 'LOW_CREDIT' | 'PAUSED_NO_CREDITS' | 'OVER_NEGATIVE_LIMIT';
  } | null> {
    const { data: wallet } = await this.supabase
      .from('quota_wallets')
      .select('id, tenant_id, total_quota, used_quota, allow_negative_credits, negative_credit_limit, low_credit_threshold')
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (!wallet) return null;

    const totalQuota = wallet.total_quota ?? 0;
    const usedQuota = wallet.used_quota ?? 0;
    const balance = totalQuota - usedQuota;
    const allowNegativeCredits = Boolean(wallet.allow_negative_credits);
    const negativeCreditLimit = typeof wallet.negative_credit_limit === 'number' ? wallet.negative_credit_limit : 0;
    const lowCreditThreshold = typeof wallet.low_credit_threshold === 'number' ? wallet.low_credit_threshold : 0;

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const { data: todayRows } = await this.supabase
      .from('quota_ledgers')
      .select('amount')
      .eq('wallet_id', wallet.id)
      .eq('movement_type', 'reply_debit')
      .gte('created_at', startOfDay.toISOString());
    const usedToday = (todayRows ?? []).reduce((s, r) => s + (typeof r.amount === 'number' ? r.amount : 0), 0);

    const { data: monthRows } = await this.supabase
      .from('quota_ledgers')
      .select('amount')
      .eq('wallet_id', wallet.id)
      .eq('movement_type', 'reply_debit')
      .gte('created_at', startOfMonth.toISOString());
    const usedThisMonth = (monthRows ?? []).reduce((s, r) => s + (typeof r.amount === 'number' ? r.amount : 0), 0);

    const blocked = allowNegativeCredits ? balance <= negativeCreditLimit : balance <= 0;
    const status: 'ACTIVE' | 'LOW_CREDIT' | 'PAUSED_NO_CREDITS' | 'OVER_NEGATIVE_LIMIT' = blocked
      ? allowNegativeCredits
        ? 'OVER_NEGATIVE_LIMIT'
        : 'PAUSED_NO_CREDITS'
      : balance <= lowCreditThreshold
        ? 'LOW_CREDIT'
        : 'ACTIVE';

    return {
      tenantId,
      totalQuota,
      usedQuota,
      balance,
      allowNegativeCredits,
      negativeCreditLimit,
      lowCreditThreshold,
      usedToday,
      usedThisMonth,
      status,
    };
  }

  async getTenantLedger(tenantId: string, opts?: { limit?: number }) {
    const lim = Math.min(200, Math.max(1, opts?.limit ?? 50));
    const { data: wallet } = await this.supabase
      .from('quota_wallets')
      .select('id')
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (!wallet?.id) return [];
    const { data } = await this.supabase
      .from('quota_ledgers')
      .select('id, amount, type, movement_type, balance_after, description, conversation_id, created_at, metadata')
      .eq('wallet_id', wallet.id)
      .order('created_at', { ascending: false })
      .limit(lim);
    return data ?? [];
  }

  async listAgencyWallets(
    agencyId: string,
    profileId: string,
    opts?: { limit?: number },
  ): Promise<
    Array<{
      tenantId: string;
      workspaceName: string;
      totalQuota: number;
      usedQuota: number;
      balance: number;
      usedToday: number;
      usedThisMonth: number;
      allowNegativeCredits: boolean;
      negativeCreditLimit: number;
      lowCreditThreshold: number;
      status: string;
    }>
  > {
    await this.assertAgencyStaff(agencyId, profileId);
    const lim = Math.min(300, Math.max(1, opts?.limit ?? 200));
    const { data: tenants } = await this.supabase
      .from('tenants')
      .select('id, name')
      .eq('agency_id', agencyId)
      .order('created_at', { ascending: false })
      .limit(lim);
    const tlist = (tenants ?? []) as Array<{ id: string; name: string }>;
    if (tlist.length === 0) return [];

    const ids = tlist.map(t => t.id);
    const { data: wallets } = await this.supabase
      .from('quota_wallets')
      .select('id, tenant_id, total_quota, used_quota, allow_negative_credits, negative_credit_limit, low_credit_threshold')
      .in('tenant_id', ids);
    const wmap = new Map((wallets ?? []).map(w => [w.tenant_id as string, w as any]));

    // Compute usedToday/usedThisMonth by summing reply_debit ledger for the wallets returned.
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const walletIds = (wallets ?? []).map(w => w.id as string).filter(Boolean);
    const usedTodayByWallet = new Map<string, number>();
    const usedMonthByWallet = new Map<string, number>();
    if (walletIds.length > 0) {
      const { data: trows } = await this.supabase
        .from('quota_ledgers')
        .select('wallet_id, amount')
        .in('wallet_id', walletIds)
        .eq('movement_type', 'reply_debit')
        .gte('created_at', startOfDay);
      for (const r of (trows ?? []) as any[]) {
        const wid = String(r.wallet_id);
        const amt = typeof r.amount === 'number' ? r.amount : 0;
        usedTodayByWallet.set(wid, (usedTodayByWallet.get(wid) ?? 0) + amt);
      }
      const { data: mrows } = await this.supabase
        .from('quota_ledgers')
        .select('wallet_id, amount')
        .in('wallet_id', walletIds)
        .eq('movement_type', 'reply_debit')
        .gte('created_at', startOfMonth);
      for (const r of (mrows ?? []) as any[]) {
        const wid = String(r.wallet_id);
        const amt = typeof r.amount === 'number' ? r.amount : 0;
        usedMonthByWallet.set(wid, (usedMonthByWallet.get(wid) ?? 0) + amt);
      }
    }

    return tlist.map(t => {
      const w = wmap.get(t.id);
      const totalQuota = w?.total_quota ?? 0;
      const usedQuota = w?.used_quota ?? 0;
      const balance = totalQuota - usedQuota;
      const allowNegativeCredits = Boolean(w?.allow_negative_credits);
      const negativeCreditLimit = typeof w?.negative_credit_limit === 'number' ? w.negative_credit_limit : 0;
      const lowCreditThreshold = typeof w?.low_credit_threshold === 'number' ? w.low_credit_threshold : 0;
      const blocked = allowNegativeCredits ? balance <= negativeCreditLimit : balance <= 0;
      const status = blocked
        ? allowNegativeCredits
          ? 'OVER_NEGATIVE_LIMIT'
          : 'PAUSED_NO_CREDITS'
        : balance <= lowCreditThreshold
          ? 'LOW_CREDIT'
          : allowNegativeCredits
            ? 'NEGATIVE_ALLOWED'
            : 'ACTIVE';
      const wid = w?.id ? String(w.id) : '';
      return {
        tenantId: t.id,
        workspaceName: t.name,
        totalQuota,
        usedQuota,
        balance,
        usedToday: wid ? (usedTodayByWallet.get(wid) ?? 0) : 0,
        usedThisMonth: wid ? (usedMonthByWallet.get(wid) ?? 0) : 0,
        allowNegativeCredits,
        negativeCreditLimit,
        lowCreditThreshold,
        status,
      };
    });
  }

  private async assertAgencyStaff(agencyId: string, profileId: string): Promise<void> {
    const { data } = await this.supabase
      .from('agency_users')
      .select('id')
      .eq('agency_id', agencyId)
      .eq('profile_id', profileId)
      .maybeSingle();
    if (!data) throw new ForbiddenException('Agency access required');
  }

  async deduct(tenantId: string, amount: number, conversationId: string, description: string) {
    this.logger.debug(`deduct stub tenant=${tenantId} amount=${amount}`);
    throw new Error('Not implemented');
  }

  async credit(tenantId: string, amount: number, description: string) {
    throw new Error('Not implemented');
  }

  async getStatus(tenantId: string) {
    throw new Error('Not implemented');
  }

  async resetPeriod(tenantId: string) {
    throw new Error('Not implemented');
  }
}
