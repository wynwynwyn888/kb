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
