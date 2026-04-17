// Action Intents service - query action intents for inspection

import { Injectable, Logger } from '@nestjs/common';
import { getSupabaseService } from '../../lib/supabase';

@Injectable()
export class ActionIntentsService {
  private readonly logger = new Logger(ActionIntentsService.name);
  private readonly supabase = getSupabaseService();

  async findAll(
    tenantId: string,
    opts?: { conversationId?: string; status?: string; limit?: number; page?: number },
  ): Promise<{ intents: unknown[]; total: number }> {
    const limit = opts?.limit ?? 50;
    const page = opts?.page ?? 1;
    const from = (page - 1) * limit;

    let query = this.supabase
      .from('action_intents')
      .select('id, action_type, source, status, params, reason, gating_note, executed_at, created_at, conversation_id', {
        count: 'exact',
      })
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .range(from, from + limit - 1);

    if (opts?.conversationId) {
      query = query.eq('conversation_id', opts.conversationId);
    }
    if (opts?.status) {
      query = query.eq('status', opts.status);
    }

    const { data, error, count } = await query;

    if (error) {
      this.logger.error(`Failed to list action intents: ${error.message}`);
      return { intents: [], total: 0 };
    }

    return {
      intents: data ?? [],
      total: count ?? 0,
    };
  }
}
