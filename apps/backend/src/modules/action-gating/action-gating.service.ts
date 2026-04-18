// Action Gating Service — evaluates suggested actions and persists intent records.
// This layer is internal-state only: no GHL writes, no booking API, no notifications.

import { Injectable, Logger } from '@nestjs/common';
import { getSupabaseService } from '../../lib/supabase';
import type { SuggestedAction } from '../reply-planning/dto';
import type { ActionIntentStatus } from './dto/action-gating.dto';

export interface GatingResult {
  actionType: string;
  status: 'DEFERRED' | 'BLOCKED';
  note: string;
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
  ): Promise<GatingResult[]> {
    const results: GatingResult[] = [];

    for (const action of suggestedActions) {
      const result = this.gateAction(action);

      await this.persistIntent({
        tenantId,
        conversationId,
        actionType: action.type,
        source,
        status: result.status,
        params: action.params,
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
    const { error } = await this.supabase.from('action_intents').insert({
      tenant_id: params.tenantId,
      conversation_id: params.conversationId,
      action_type: params.actionType,
      source: params.source,
      status: params.status,
      params: params.params,
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
        `actionType=${params.actionType}, error=${error.message}`,
      );
    }
  }
}
