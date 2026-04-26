// Action Gating Service — evaluates suggested actions and persists intent records.
// This layer is internal-state only: no GHL writes, no booking API, no notifications.

import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { formatPostgrestError } from '../../lib/format-postgrest-error';
import { getSupabaseService } from '../../lib/supabase';
import type { SuggestedAction } from '../reply-planning/dto';
import type { ActionIntentStatus } from './dto/action-gating.dto';

export interface GatingResult {
  actionType: string;
  status: 'DEFERRED' | 'BLOCKED';
  note: string;
}

export interface ActionIntentRow {
  id: string;
  tenantId: string;
  conversationId: string | null;
  actionType: string;
  source: string;
  status: ActionIntentStatus;
  params: Record<string, unknown>;
  reason: string | null;
  gatingNote: string | null;
  executedAt: string | null;
  createdAt: string;
}

@Injectable()
export class ActionGatingService {
  private readonly logger = new Logger(ActionGatingService.name);
  private readonly supabase = getSupabaseService();

  /**
   * Evaluate all suggested actions and persist an ActionIntent for each.
   * Returns gating results for safe logging.
   * This phase: all known actions are DEFERRED (no executor ready).
   */
  async gateActions(
    suggestedActions: SuggestedAction[],
    tenantId: string,
    conversationId: string,
    source: string = 'AI',
    contactId?: string,
  ): Promise<GatingResult[]> {
    const results: GatingResult[] = [];

    for (const action of suggestedActions) {
      const result = this.gateAction(action);

      // Store contactId in params if provided (used by tag executor)
      const params: Record<string, unknown> = { ...action.params };
      if (contactId) {
        params['contactId'] = contactId;
      }

      await this.persistIntent({
        tenantId,
        conversationId,
        actionType: action.type,
        source,
        status: result.status,
        params,
        reason: action.reason,
        gatingNote: result.note,
      });

      results.push(result);
    }

    return results;
  }

  private gateAction(action: SuggestedAction): GatingResult {
    switch (action.type) {
      case 'TAG_CONTACT':
      case 'BOOK_SLOT':
      case 'ESCALATE':
      case 'TRANSFER':
        return {
          actionType: action.type,
          status: 'DEFERRED',
          note: 'no executor ready in this phase',
        };
      default:
        return {
          actionType: action.type,
          status: 'BLOCKED',
          note: `unknown action type: ${action.type}`,
        };
    }
  }

  /**
   * Maps planner / gating action labels to Postgres `ActionType` enum values.
   * `BOOK_SLOT` is persisted as `UPDATE_CALENDAR` (same DB enum used for calendar mutations).
   */
  private mapSuggestedActionTypeToDb(actionType: string): string {
    if (actionType === 'BOOK_SLOT') return 'UPDATE_CALENDAR';
    if (actionType === 'ESCALATE' || actionType === 'TRANSFER') return 'AI_GENERATE';
    return actionType;
  }

  private async persistIntent(params: {
    tenantId: string;
    conversationId: string;
    actionType: string;
    source: string;
    status: ActionIntentStatus;
    params: Record<string, unknown>;
    reason: string;
    gatingNote: string;
  }): Promise<void> {
    const dbActionType = this.mapSuggestedActionTypeToDb(params.actionType);
    const paramsRow: Record<string, unknown> =
      params.actionType === 'BOOK_SLOT'
        ? { ...params.params, bookSlotIntent: true }
        : { ...params.params };

    const { error } = await this.supabase.from('action_intents').insert({
      id: randomUUID(),
      tenant_id: params.tenantId,
      conversation_id: params.conversationId,
      action_type: dbActionType,
      source: params.source,
      status: params.status,
      params: paramsRow,
      reason: params.reason,
      gating_note: params.gatingNote,
    });

    if (error) {
      // Unique constraint violation means this intent was already recorded (e.g. job retry)
      if (error.code === '23505') {
        this.logger.debug(
          `Action intent already exists: tenantId=${params.tenantId}, ` +
          `conversationId=${params.conversationId}, actionType=${params.actionType}`,
        );
        return;
      }
      this.logger.error(
        `Failed to persist action intent: tenantId=${params.tenantId}, ` +
          `actionType=${params.actionType}→${dbActionType}, ${formatPostgrestError(error)}`,
      );
    }
  }

  /**
   * Load DEFERRED intents for a conversation, optionally filtered by actionType.
   */
  async loadDeferredIntents(
    conversationId: string,
    actionType?: string,
  ): Promise<ActionIntentRow[]> {
    let query = this.supabase
      .from('action_intents')
      .select('id, tenant_id, conversation_id, action_type, source, status, params, reason, gating_note, executed_at, created_at')
      .eq('conversation_id', conversationId)
      .eq('status', 'DEFERRED');

    if (actionType) {
      if (actionType === 'BOOK_SLOT') {
        query = query
          .eq('action_type', 'UPDATE_CALENDAR')
          .contains('params', { bookSlotIntent: true });
      } else {
        query = query.eq('action_type', this.mapSuggestedActionTypeToDb(actionType));
      }
    }

    const { data, error } = await query;

    if (error) {
      this.logger.error(`Failed to load deferred intents: ${error.message}`);
      return [];
    }

    return (data ?? []).map(row => ({
      id: row.id,
      tenantId: row.tenant_id,
      conversationId: row.conversation_id,
      actionType: row.action_type,
      source: row.source,
      status: row.status as ActionIntentStatus,
      params: (row.params as Record<string, unknown>) ?? {},
      reason: row.reason ?? null,
      gatingNote: row.gating_note ?? null,
      executedAt: row.executed_at ?? null,
      createdAt: row.created_at,
    }));
  }

  /**
   * Update intent status and metadata.
   */
  async updateIntentStatus(
    id: string,
    status: ActionIntentStatus,
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
   * Get all intent history for a conversation (for ops visibility).
   */
  async getActionIntentHistory(
    tenantId: string,
    conversationId: string,
  ): Promise<ActionIntentRow[]> {
    const { data, error } = await this.supabase
      .from('action_intents')
      .select('id, tenant_id, conversation_id, action_type, source, status, params, reason, gating_note, executed_at, created_at')
      .eq('tenant_id', tenantId)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });

    if (error) {
      this.logger.error(`Failed to load action intent history: ${error.message}`);
      return [];
    }

    return (data ?? []).map(row => ({
      id: row.id,
      tenantId: row.tenant_id,
      conversationId: row.conversation_id,
      actionType: row.action_type,
      source: row.source,
      status: row.status as ActionIntentStatus,
      params: (row.params as Record<string, unknown>) ?? {},
      reason: row.reason ?? null,
      gatingNote: row.gating_note ?? null,
      executedAt: row.executed_at ?? null,
      createdAt: row.created_at,
    }));
  }
}
