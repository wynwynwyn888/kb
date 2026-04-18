// Quotas service - manages quota wallet and ledger

import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { getSupabaseService } from '../../lib/supabase';

@Injectable()
export class QuotasService {
  private readonly logger = new Logger(QuotasService.name);
  private readonly supabase = getSupabaseService();

  constructor(
    @InjectQueue('quota-threshold-alert') private readonly alertQueue: Queue,
  ) {}

  /**
   * Check if tenant has at least `amount` quota remaining.
   * Returns true if no wallet exists (no quota tracking = unlimited).
   */
  async checkQuota(tenantId: string, amount: number): Promise<boolean> {
    const { data: wallet, error } = await this.supabase
      .from('quota_wallets')
      .select('total_quota, used_quota')
      .eq('tenant_id', tenantId)
      .single();

    if (error || !wallet) {
      // No wallet = no quota tracking in this phase
      return true;
    }

    return wallet.total_quota - wallet.used_quota >= amount;
  }

  async deduct(tenantId: string, amount: number, conversationId: string, description: string) {
    // TODO: Implement debit with ledger + alert
    throw new Error('Not implemented');
  }

  async credit(tenantId: string, amount: number, description: string) {
    // TODO: Implement credit with ledger
    throw new Error('Not implemented');
  }

  async getStatus(tenantId: string) {
    // TODO: Return wallet status
    throw new Error('Not implemented');
  }

  async resetPeriod(tenantId: string) {
    // TODO: Handle period reset
    throw new Error('Not implemented');
  }
}