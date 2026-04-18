// Action Intent Executor — executes deferred ActionIntents safely and idempotently.
// Currently supports TAG_CONTACT only.

import { Injectable, Logger } from '@nestjs/common';
import { getSupabaseService } from '../../lib/supabase';
import { createGhlClient } from '@aisbp/ghl-client';
import type { ExecutionResult, ExecutionConditions, TagContactParams } from './dto/action-execution.dto';

@Injectable()
export class ActionIntentExecutorService {
  private readonly logger = new Logger(ActionIntentExecutorService.name);
  private readonly supabase = getSupabaseService();

  /**
   * Determine if tag execution should run based on send outcome.
   * ALL conditions must be true:
   * - planStatus = 'PLANNED' (not HANDOVER or SKIPPED)
   * - succeeded >= 1 (at least one bubble sent)
   * - contactId is present
   */
  shouldExecute(conditions: ExecutionConditions, contactId: string | null): boolean {
    const { succeeded, planStatus } = conditions;
    if (planStatus !== 'PLANNED') {
      this.logger.debug(`Tag execution skipped: planStatus=${planStatus}`);
      return false;
    }
    if (succeeded < 1) {
      this.logger.debug(`Tag execution skipped: no bubbles succeeded (succeeded=${succeeded})`);
      return false;
    }
    if (!contactId) {
      this.logger.debug(`Tag execution skipped: no contactId available`);
      return false;
    }
    return true;
  }

  /**
   * Execute all DEFERRED TAG_CONTACT intents for a conversation.
   * Runs only when shouldExecute returns true (called by the trigger site).
   */
  async executeDeferredTagActions(
    tenantId: string,
    conversationId: string,
    contactId: string,
    ghlLocationId: string,
  ): Promise<ExecutionResult[]> {
    const intents = await this.loadDeferredTagIntents(conversationId);
    if (intents.length === 0) {
      this.logger.debug(`No deferred TAG_CONTACT intents for conversation=${conversationId}`);
      return [];
    }

    const results: ExecutionResult[] = [];

    for (const intent of intents) {
      // Atomic status check: re-read and skip if already EXECUTED or FAILED
      const current = await this.getIntentStatus(intent.id);
      if (!current) {
        this.logger.debug(`Tag intent ${intent.id} no longer found — skipping`);
        continue;
      }
      if (current === 'EXECUTED') {
        this.logger.debug(`Tag intent ${intent.id} already EXECUTED — skipping`);
        continue;
      }
      if (current === 'FAILED') {
        this.logger.debug(`Tag intent ${intent.id} already FAILED — skipping (no retry in this pass)`);
        continue;
      }

      // Load credentials
      const credentials = await this.loadGhlCredentials(tenantId, ghlLocationId);
      if (!credentials) {
        const errorNote = 'GHL credentials not found for tenant/location';
        await this.updateIntentStatus(intent.id, 'FAILED', errorNote);
        results.push({ id: intent.id, status: 'FAILED', errorNote });
        this.logger.warn(`Tag intent ${intent.id} FAILED: ${errorNote}`);
        continue;
      }

      // Parse tags from params
      const params = intent.params as unknown as TagContactParams;
      const tags = params.tags ?? [];

      // Execute GHL tag call
      const ghlClient = createGhlClient(credentials.token, ghlLocationId);
      const ghlResult = await ghlClient.tagContact({ contactId, tags });

      if (ghlResult.success) {
        // Atomic update: only succeeds if still DEFERRED
        const updated = await this.updateIntentStatusAtomic(intent.id, 'EXECUTED');
        if (updated) {
          results.push({ id: intent.id, status: 'EXECUTED', executedAt: new Date().toISOString() });
          this.logger.log(`Tag intent ${intent.id} EXECUTED: contactId=${contactId}, tagCount=${tags.length}`);
        } else {
          // Another retry handled it — skip silently
          this.logger.debug(`Tag intent ${intent.id} already handled by concurrent retry — skipping`);
        }
      } else {
        await this.updateIntentStatus(intent.id, 'FAILED', ghlResult.error);
        results.push({ id: intent.id, status: 'FAILED', errorNote: ghlResult.error });
        // Log without raw tokens — error message is safe
        this.logger.warn(`Tag intent ${intent.id} FAILED: ${ghlResult.error}`);
      }
    }

    return results;
  }

  /**
   * Load all DEFERRED TAG_CONTACT intents for a conversation.
   */
  private async loadDeferredTagIntents(conversationId: string): Promise<
    Array<{ id: string; params: Record<string, unknown> }>
  > {
    const { data, error } = await this.supabase
      .from('action_intents')
      .select('id, params')
      .eq('conversation_id', conversationId)
      .eq('action_type', 'TAG_CONTACT')
      .eq('status', 'DEFERRED');

    if (error) {
      this.logger.error(`Failed to load deferred tag intents: ${error.message}`);
      return [];
    }

    return data ?? [];
  }

  /**
   * Get current status of an intent by id.
   */
  private async getIntentStatus(id: string): Promise<string | null> {
    const { data } = await this.supabase
      .from('action_intents')
      .select('status')
      .eq('id', id)
      .single();

    return data?.status ?? null;
  }

  /**
   * Update intent status and metadata — non-atomic, for error cases.
   */
  private async updateIntentStatus(
    id: string,
    status: 'EXECUTED' | 'FAILED',
    errorNote?: string,
  ): Promise<void> {
    const update: Record<string, unknown> = { status };
    if (status === 'EXECUTED') {
      update['executed_at'] = new Date().toISOString();
    }
    if (errorNote) {
      update['reason'] = errorNote;
    }
    await this.supabase.from('action_intents').update(update).eq('id', id);
  }

  /**
   * Atomic status update — only updates if still DEFERRED.
   * Returns true if row was updated, false if already handled.
   */
  async updateIntentStatusAtomic(
    id: string,
    targetStatus: 'EXECUTED' | 'FAILED',
    errorNote?: string,
  ): Promise<boolean> {
    const update: Record<string, unknown> = {
      status: targetStatus,
      executed_at: targetStatus === 'EXECUTED' ? new Date().toISOString() : null,
    };
    if (errorNote) {
      update['reason'] = errorNote;
    }

    // Atomic: UPDATE ... WHERE id = ? AND status = 'DEFERRED'
    const { data, error } = await this.supabase
      .from('action_intents')
      .update(update)
      .eq('id', id)
      .eq('status', 'DEFERRED')
      .select('id');

    if (error) {
      this.logger.error(`Atomic status update failed for intent=${id}: ${error.message}`);
      return false;
    }

    // data is non-empty if a row was updated
    return (data?.length ?? 0) > 0;
  }

  private async loadGhlCredentials(
    tenantId: string,
    ghlLocationId: string,
  ): Promise<{ token: string } | null> {
    const { data } = await this.supabase
      .from('tenant_ghl_connections')
      .select('private_token_encrypted')
      .eq('tenant_id', tenantId)
      .eq('ghl_location_id', ghlLocationId)
      .eq('status', 'CONNECTED')
      .single();

    if (!data) return null;
    return { token: data.private_token_encrypted };
  }
}
