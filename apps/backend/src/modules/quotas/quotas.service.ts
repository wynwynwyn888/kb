// Quotas service — wallets, top-ups, agency default, audit.

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { getSupabaseService } from '../../lib/supabase';
import { randomUUID } from 'node:crypto';

export type AgencyCreditDeductionMethod = 'PER_LOGICAL_REPLY' | 'PER_MESSAGE_BUBBLE';

export interface AgencyCreditSettingsPatch {
  defaultSubaccountQuota?: number;
  deductionMethod?: AgencyCreditDeductionMethod;
  defaultAllowOverage?: boolean;
  defaultOverageLimit?: number;
  defaultLowCreditWarningEnabled?: boolean;
  defaultLowCreditWarningLevel?: number;
}

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

  /** @deprecated Prefer `saveAgencyCreditSettings`; kept for callers that only bump default credits. */
  async setAgencyDefaultQuota(agencyId: string, profileId: string, defaultQuota: number) {
    return this.saveAgencyCreditSettings(agencyId, profileId, { defaultSubaccountQuota: defaultQuota });
  }

  async saveAgencyCreditSettings(agencyId: string, profileId: string, patch: AgencyCreditSettingsPatch) {
    await this.assertAgencyStaff(agencyId, profileId);
    const keys = Object.keys(patch).filter(k => (patch as Record<string, unknown>)[k] !== undefined);
    if (keys.length === 0) {
      throw new BadRequestException('Provide at least one credit setting to save');
    }

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (patch.defaultSubaccountQuota !== undefined) {
      const n = patch.defaultSubaccountQuota;
      if (!Number.isFinite(n) || n < 0) throw new BadRequestException('defaultSubaccountQuota must be >= 0');
      update['default_subaccount_quota'] = Math.floor(n);
    }

    if (patch.deductionMethod !== undefined) {
      if (patch.deductionMethod !== 'PER_LOGICAL_REPLY' && patch.deductionMethod !== 'PER_MESSAGE_BUBBLE') {
        throw new BadRequestException('deductionMethod must be PER_LOGICAL_REPLY or PER_MESSAGE_BUBBLE');
      }
      update['credit_deduction_method'] = patch.deductionMethod;
    }

    if (patch.defaultAllowOverage !== undefined) {
      update['default_allow_temporary_overage'] = Boolean(patch.defaultAllowOverage);
      if (patch.defaultAllowOverage === false) {
        update['default_overage_limit_credits'] = 0;
      }
    }

    if (patch.defaultOverageLimit !== undefined) {
      const lim = patch.defaultOverageLimit;
      if (!Number.isFinite(lim) || lim < 0) throw new BadRequestException('defaultOverageLimit must be >= 0');
      update['default_overage_limit_credits'] = Math.floor(lim);
    }

    if (patch.defaultLowCreditWarningEnabled !== undefined) {
      update['default_low_credit_warning_enabled'] = Boolean(patch.defaultLowCreditWarningEnabled);
      if (patch.defaultLowCreditWarningEnabled === false) {
        update['default_low_credit_warning_level_credits'] = 0;
      }
    }

    if (patch.defaultLowCreditWarningLevel !== undefined) {
      const w = patch.defaultLowCreditWarningLevel;
      if (!Number.isFinite(w) || w < 0) throw new BadRequestException('defaultLowCreditWarningLevel must be >= 0');
      update['default_low_credit_warning_level_credits'] = Math.floor(w);
    }

    const { error } = await this.supabase.from('agencies').update(update).eq('id', agencyId);
    if (error) throw new Error(error.message);

    await this.supabase.from('quota_audit_logs').insert({
      id: randomUUID(),
      agency_id: agencyId,
      profile_id: profileId,
      tenant_id: null,
      action: 'agency.credit_settings',
      delta: 0,
      previous_total: null,
      new_total: null,
      metadata: { patch: keys },
    });

    return this.getAgencyQuotaSettings(agencyId, profileId);
  }

  async topUpSubaccount(agencyId: string, profileId: string, tenantId: string, amount: number, note?: string) {
    await this.assertAgencyStaff(agencyId, profileId);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new ForbiddenException('Top-up amount must be positive');
    }

    const { data: t, error: tenantErr } = await this.supabase
      .from('tenants')
      .select('id, agency_id')
      .eq('id', tenantId)
      .single();
    if (tenantErr || !t || t.agency_id !== agencyId) {
      throw new NotFoundException('Subaccount not in this agency');
    }

    const { data: wallet, error: walletReadErr } = await this.supabase
      .from('quota_wallets')
      .select('id, total_quota, used_quota')
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (walletReadErr) {
      this.logger.error(`quota wallet read failed tenant=${tenantId} ${walletReadErr.message}`);
      throw new Error(walletReadErr.message);
    }

    const add = Math.floor(amount);
    const prevTotal = wallet?.total_quota ?? 0;
    const newTotal = prevTotal + add;
    const usedBefore = wallet?.used_quota ?? 0;
    const nowIso = new Date().toISOString();

    let walletId: string;
    if (wallet?.id) {
      walletId = wallet.id;
      const { data: updated, error: upErr } = await this.supabase
        .from('quota_wallets')
        .update({ total_quota: newTotal, updated_at: nowIso })
        .eq('id', walletId)
        .select('id, total_quota, used_quota')
        .maybeSingle();
      if (upErr) {
        this.logger.error(`quota wallet top-up update failed tenant=${tenantId} ${upErr.message}`);
        throw new Error(upErr.message);
      }
      if (!updated || updated.total_quota !== newTotal) {
        this.logger.error(`quota wallet top-up update no row or wrong total tenant=${tenantId} expected=${newTotal}`);
        throw new Error('Top-up did not persist to quota_wallets');
      }
    } else {
      const now = new Date();
      const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      walletId = randomUUID();
      const { error: insErr } = await this.supabase.from('quota_wallets').insert({
        id: walletId,
        tenant_id: tenantId,
        total_quota: newTotal,
        used_quota: 0,
        period_start: periodStart.toISOString(),
        period_end: periodEnd.toISOString(),
        updated_at: nowIso,
      });
      if (insErr) {
        this.logger.error(`quota wallet create on top-up failed tenant=${tenantId} ${insErr.message}`);
        throw new Error(insErr.message);
      }
    }

    const balanceAfterMovement = newTotal - usedBefore;
    const { error: ledErr } = await this.supabase.from('quota_ledgers').insert({
      id: randomUUID(),
      wallet_id: walletId,
      amount: add,
      type: 'CREDIT',
      movement_type: 'top_up',
      balance_after: balanceAfterMovement,
      metadata: { note: note ?? null, walletCreated: !wallet?.id },
      created_by_user_id: profileId,
      description: note?.trim() || (wallet?.id ? 'Manual top-up' : 'Manual top-up (wallet created)'),
    });
    if (ledErr) {
      this.logger.error(`quota ledger top-up insert failed tenant=${tenantId} ${ledErr.message}`);
      throw new Error(ledErr.message);
    }

    const { error: auditErr } = await this.supabase.from('quota_audit_logs').insert({
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
    if (auditErr) {
      this.logger.warn(`quota audit log insert failed after successful top-up tenant=${tenantId} ${auditErr.message}`);
    }

    const { data: verified, error: verErr } = await this.supabase
      .from('quota_wallets')
      .select('total_quota, used_quota')
      .eq('tenant_id', tenantId)
      .single();
    if (verErr || !verified) {
      throw new Error('Could not verify wallet after top-up');
    }
    const vTotal = verified.total_quota ?? 0;
    const vUsed = verified.used_quota ?? 0;
    const balance = vTotal - vUsed;

    return {
      tenantId,
      previousTotal: prevTotal,
      newTotal: vTotal,
      delta: add,
      totalQuota: vTotal,
      usedQuota: vUsed,
      balance,
    };
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
    const nowIso = new Date().toISOString();
    const { data: updated, error: upErr } = await this.supabase
      .from('quota_wallets')
      .update({ total_quota: nextTotal, updated_at: nowIso })
      .eq('id', wallet.id)
      .select('id, total_quota, used_quota')
      .maybeSingle();
    if (upErr) {
      this.logger.error(`quota wallet adjust update failed tenant=${tenantId} ${upErr.message}`);
      throw new Error(upErr.message);
    }
    if (!updated || updated.total_quota !== nextTotal) {
      throw new Error('Manual adjustment did not persist to quota_wallets');
    }

    const balanceAfter = nextTotal - (wallet.used_quota ?? 0);
    const { error: ledErr } = await this.supabase.from('quota_ledgers').insert({
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
    if (ledErr) {
      this.logger.error(`quota ledger manual_adjustment failed tenant=${tenantId} ${ledErr.message}`);
      throw new Error(ledErr.message);
    }

    const { error: auditErr } = await this.supabase.from('quota_audit_logs').insert({
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
    if (auditErr) {
      this.logger.warn(`quota audit log insert failed after adjustment tenant=${tenantId} ${auditErr.message}`);
    }

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
    const tids = [...new Set(rows.map(r => r.tenant_id).filter(Boolean))] as string[];
    let pmap = new Map<string, { email?: string; full_name?: string }>();
    if (pids.length > 0) {
      const { data: profs } = await this.supabase
        .from('profiles')
        .select('id, email, full_name')
        .in('id', pids);
      pmap = new Map((profs ?? []).map(p => [p.id as string, p as { email?: string; full_name?: string }]));
    }
    let tmap = new Map<string, string>();
    if (tids.length > 0) {
      const { data: tenants } = await this.supabase
        .from('tenants')
        .select('id, name')
        .eq('agency_id', agencyId)
        .in('id', tids);
      tmap = new Map((tenants ?? []).map(t => [t.id as string, String((t as { name?: string }).name ?? '').trim() || 'Workspace']));
    }
    return rows.map(r => {
      const p = r.profile_id ? pmap.get(r.profile_id) : undefined;
      const tid = r.tenant_id ? String(r.tenant_id) : null;
      return {
        ...r,
        actorEmail: p?.email ?? null,
        actorName: p?.full_name ?? null,
        workspaceName: tid ? (tmap.get(tid) ?? null) : null,
      };
    });
  }

  async getAgencyQuotaSettings(agencyId: string, profileId: string) {
    await this.assertAgencyStaff(agencyId, profileId);
    const { data, error } = await this.supabase
      .from('agencies')
      .select(
        'id, default_subaccount_quota, credit_deduction_method, default_allow_temporary_overage, default_overage_limit_credits, default_low_credit_warning_enabled, default_low_credit_warning_level_credits',
      )
      .eq('id', agencyId)
      .single();
    if (error || !data) throw new NotFoundException('Agency not found');
    const row = data as {
      id: string;
      default_subaccount_quota: number;
      credit_deduction_method?: string;
      default_allow_temporary_overage?: boolean;
      default_overage_limit_credits?: number;
      default_low_credit_warning_enabled?: boolean;
      default_low_credit_warning_level_credits?: number;
    };
    return {
      agencyId: row.id,
      defaultSubaccountQuota: row.default_subaccount_quota,
      deductionMethod: (row.credit_deduction_method ?? 'PER_LOGICAL_REPLY') as AgencyCreditDeductionMethod,
      defaultAllowOverage: Boolean(row.default_allow_temporary_overage),
      defaultOverageLimit: typeof row.default_overage_limit_credits === 'number' ? row.default_overage_limit_credits : 0,
      defaultLowCreditWarningEnabled: Boolean(row.default_low_credit_warning_enabled),
      defaultLowCreditWarningLevel:
        typeof row.default_low_credit_warning_level_credits === 'number'
          ? row.default_low_credit_warning_level_credits
          : 0,
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
    usedThisYear: number;
    status: 'ACTIVE' | 'LOW_CREDIT' | 'PAUSED_NO_CREDITS' | 'OVER_NEGATIVE_LIMIT';
    /** ISO timestamps from `quota_wallets` — client shows annual reset / period window; null when wallet missing. */
    periodStart: string | null;
    periodEnd: string | null;
  }> {
    const { data: wallet, error: wErr } = await this.supabase
      .from('quota_wallets')
      .select(
        'id, tenant_id, total_quota, used_quota, allow_negative_credits, negative_credit_limit, low_credit_threshold, period_start, period_end',
      )
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (wErr) {
      this.logger.warn(`getTenantUsageSummary wallet read tenant=${tenantId} ${wErr.message}`);
    }

    if (!wallet) {
      /* No quota_wallets row yet — treat as zero credits but not "paused product" (wallet is created on first top-up / tenant create). */
      return {
        tenantId,
        totalQuota: 0,
        usedQuota: 0,
        balance: 0,
        allowNegativeCredits: false,
        negativeCreditLimit: 0,
        lowCreditThreshold: 0,
        usedToday: 0,
        usedThisMonth: 0,
        usedThisYear: 0,
        status: 'ACTIVE',
        periodStart: null,
        periodEnd: null,
      };
    }

    const totalQuota = wallet.total_quota ?? 0;
    const usedQuota = wallet.used_quota ?? 0;
    const balance = totalQuota - usedQuota;
    const allowNegativeCredits = Boolean(wallet.allow_negative_credits);
    const negativeCreditLimit = typeof wallet.negative_credit_limit === 'number' ? wallet.negative_credit_limit : 0;
    const lowCreditThreshold = typeof wallet.low_credit_threshold === 'number' ? wallet.low_credit_threshold : 0;

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfYear = new Date(now.getFullYear(), 0, 1);

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

    const { data: yearRows } = await this.supabase
      .from('quota_ledgers')
      .select('amount')
      .eq('wallet_id', wallet.id)
      .eq('movement_type', 'reply_debit')
      .gte('created_at', startOfYear.toISOString());
    const usedThisYear = (yearRows ?? []).reduce((s, r) => s + (typeof r.amount === 'number' ? r.amount : 0), 0);

    const blocked = allowNegativeCredits ? balance <= negativeCreditLimit : balance <= 0;
    const status: 'ACTIVE' | 'LOW_CREDIT' | 'PAUSED_NO_CREDITS' | 'OVER_NEGATIVE_LIMIT' = blocked
      ? allowNegativeCredits
        ? 'OVER_NEGATIVE_LIMIT'
        : 'PAUSED_NO_CREDITS'
      : balance <= lowCreditThreshold
        ? 'LOW_CREDIT'
        : 'ACTIVE';

    const ps = wallet.period_start as string | undefined;
    const pe = wallet.period_end as string | undefined;

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
      usedThisYear,
      status,
      periodStart: typeof ps === 'string' && ps.trim() ? ps : null,
      periodEnd: typeof pe === 'string' && pe.trim() ? pe : null,
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
      usedThisYear: number;
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
    const startOfYear = new Date(now.getFullYear(), 0, 1).toISOString();

    const walletIds = (wallets ?? []).map(w => w.id as string).filter(Boolean);
    const usedTodayByWallet = new Map<string, number>();
    const usedMonthByWallet = new Map<string, number>();
    const usedYearByWallet = new Map<string, number>();
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
      const { data: yrows } = await this.supabase
        .from('quota_ledgers')
        .select('wallet_id, amount')
        .in('wallet_id', walletIds)
        .eq('movement_type', 'reply_debit')
        .gte('created_at', startOfYear);
      for (const r of (yrows ?? []) as any[]) {
        const wid = String(r.wallet_id);
        const amt = typeof r.amount === 'number' ? r.amount : 0;
        usedYearByWallet.set(wid, (usedYearByWallet.get(wid) ?? 0) + amt);
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
        usedThisYear: wid ? (usedYearByWallet.get(wid) ?? 0) : 0,
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
