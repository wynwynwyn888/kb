// Action Intent Executor — executes deferred ActionIntents safely and idempotently.
// Currently supports TAG_CONTACT and BOOK_SLOT.

import { Injectable, Logger } from '@nestjs/common';
import { formatPostgrestError } from '../../lib/format-postgrest-error';
import { getSupabaseService } from '../../lib/supabase';
import { decrypt } from '../../lib/encryption';
import { createGhlClient } from '@aisbp/ghl-client';
import type { ExecutionResult, ExecutionConditions, TagContactParams, BookSlotParams } from './dto/action-execution.dto';

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
      if (process.env['NODE_ENV'] !== 'production') {
        this.logger.debug(`[TAG_VERIFY] Calling: intentId=${intent.id}, contactId=${contactId}, tagCount=${tags.length}, endpoint=/contacts/${contactId}/tags`);
      }
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
        this.logger.warn(`Tag intent ${intent.id} FAILED: ${ghlResult.error}`);
      }
    }

    return results;
  }

  /**
   * Execute all DEFERRED BOOK_SLOT intents for a conversation.
   * Runs only when shouldExecute returns true (called by the trigger site).
   *
   * Fails cleanly on incomplete params — no blind API calls.
   */
  async executeDeferredBookSlotActions(
    tenantId: string,
    conversationId: string,
    contactId: string,
    ghlLocationId: string,
  ): Promise<ExecutionResult[]> {
    if (process.env['AISBP_EXECUTE_DEFERRED_BOOK_SLOT'] !== 'true') {
      this.logger.debug(
        'Deferred BOOK_SLOT execution disabled (set AISBP_EXECUTE_DEFERRED_BOOK_SLOT=true to enable). ' +
          'Live calendar creates are owned by ConversationBookingFlowService.',
      );
      return [];
    }

    const intents = await this.loadDeferredBookSlotIntents(conversationId);
    if (intents.length === 0) {
      this.logger.debug(`No deferred BOOK_SLOT intents for conversation=${conversationId}`);
      return [];
    }

    const results: ExecutionResult[] = [];

    for (const intent of intents) {
      // Atomic status check
      const current = await this.getIntentStatus(intent.id);
      if (!current) {
        this.logger.debug(`Book intent ${intent.id} no longer found — skipping`);
        continue;
      }
      if (current === 'EXECUTED') {
        this.logger.debug(`Book intent ${intent.id} already EXECUTED — skipping`);
        continue;
      }
      if (current === 'FAILED') {
        this.logger.debug(`Book intent ${intent.id} already FAILED — skipping`);
        continue;
      }

      // Validate params before any API call
      const validation = this.validateBookSlotParams(intent.params);
      if (validation.error) {
        await this.updateIntentStatus(intent.id, 'FAILED', validation.error);
        results.push({ id: intent.id, status: 'FAILED', errorNote: validation.error });
        this.logger.warn(`Book intent ${intent.id} FAILED: ${validation.error}`);
        continue;
      }

      // Load credentials
      const credentials = await this.loadGhlCredentials(tenantId, ghlLocationId);
      if (!credentials) {
        const errorNote = 'GHL credentials not found for tenant/location';
        await this.updateIntentStatus(intent.id, 'FAILED', errorNote);
        results.push({ id: intent.id, status: 'FAILED', errorNote });
        this.logger.warn(`Book intent ${intent.id} FAILED: ${errorNote}`);
        continue;
      }

      // validation.error is undefined here — params is guaranteed
      const params = validation.params as BookSlotParams;
      // Use contactId from params if present, otherwise use job-level contactId
      const effectiveContactId = params.contactId ?? contactId;

      // Execute GHL booking call
      if (process.env['NODE_ENV'] !== 'production') {
        this.logger.debug(`[BOOK_VERIFY] Calling: intentId=${intent.id}, calendarId=${params.calendarId}, contactId=${effectiveContactId}, slot=${params.startTime} -> ${params.endTime}`);
      }
      const ghlClient = createGhlClient(credentials.token, ghlLocationId);
      const ghlResult = await ghlClient.bookSlot({
        locationId: ghlLocationId,
        calendarId: params.calendarId,
        contactId: effectiveContactId,
        startTime: params.startTime,
        endTime: params.endTime,
        title: params.title,
        timezone: params.timezone,
        appointmentStatus: params.appointmentStatus,
      });

      if (ghlResult.success) {
        const updated = await this.updateIntentStatusAtomic(intent.id, 'EXECUTED');
        if (updated) {
          results.push({ id: intent.id, status: 'EXECUTED', executedAt: new Date().toISOString() });
          if (process.env['NODE_ENV'] !== 'production') {
            this.logger.debug(`[BOOK_VERIFY] EXECUTED: intentId=${intent.id}, appointmentId=${ghlResult.appointmentId}`);
          }
          this.logger.log(`Book intent ${intent.id} EXECUTED: appointmentId=${ghlResult.appointmentId}`);
        } else {
          this.logger.debug(`Book intent ${intent.id} already handled by concurrent retry — skipping`);
        }
      } else {
        await this.updateIntentStatus(intent.id, 'FAILED', ghlResult.error);
        results.push({ id: intent.id, status: 'FAILED', errorNote: ghlResult.error });
        if (process.env['NODE_ENV'] !== 'production') {
          this.logger.debug(`[BOOK_VERIFY] FAILED: intentId=${intent.id}, error=${ghlResult.error}`);
        }
        this.logger.warn(`Book intent ${intent.id} FAILED: ${ghlResult.error}`);
      }
    }

    return results;
  }

  /**
   * Validate BOOK_SLOT params.
   * Returns parsed params on success, or an error string if validation fails.
   * Detects placeholder-only params like { detected: true }.
   */
  private validateBookSlotParams(
    params: unknown,
  ): { params: BookSlotParams; error?: undefined } | { params?: undefined; error: string } {
    if (!params || typeof params !== 'object') {
      return { error: 'MISSING_BOOKING_PARAMS: params is empty or invalid' };
    }

    const obj = params as Record<string, unknown>;

    // Detect placeholder stub: only { detected: true } or similar
    const keys = Object.keys(obj).filter(k => k !== 'detected');
    if (keys.length === 0) {
      return { error: 'MISSING_BOOKING_PARAMS: no booking fields present (only placeholder detected)' };
    }

    // Check required fields
    if (!obj['calendarId'] || typeof obj['calendarId'] !== 'string' || !obj['calendarId']) {
      return { error: 'MISSING_BOOKING_PARAMS: calendarId is required' };
    }
    if (!obj['startTime'] || typeof obj['startTime'] !== 'string' || !obj['startTime']) {
      return { error: 'MISSING_BOOKING_PARAMS: startTime is required' };
    }
    if (!obj['endTime'] || typeof obj['endTime'] !== 'string' || !obj['endTime']) {
      return { error: 'MISSING_BOOKING_PARAMS: endTime is required' };
    }

    // Basic ISO 8601 validation (starts with YYYY-MM)
    const isoCheck = (v: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v);
    if (!isoCheck(obj['startTime'] as string)) {
      return { error: 'MISSING_BOOKING_PARAMS: startTime must be ISO 8601 datetime' };
    }
    if (!isoCheck(obj['endTime'] as string)) {
      return { error: 'MISSING_BOOKING_PARAMS: endTime must be ISO 8601 datetime' };
    }

    return {
      params: {
        calendarId: obj['calendarId'] as string,
        startTime: obj['startTime'] as string,
        endTime: obj['endTime'] as string,
        title: typeof obj['title'] === 'string' ? obj['title'] as string : undefined,
        contactId: typeof obj['contactId'] === 'string' ? obj['contactId'] as string : undefined,
        timezone: typeof obj['timezone'] === 'string' ? obj['timezone'] as string : undefined,
        appointmentStatus: typeof obj['appointmentStatus'] === 'string' ? obj['appointmentStatus'] as string : undefined,
      },
    };
  }

  /**
   * Load all DEFERRED BOOK_SLOT intents for a conversation.
   */
  private async loadDeferredBookSlotIntents(conversationId: string): Promise<
    Array<{ id: string; params: Record<string, unknown> }>
  > {
    const { data, error } = await this.supabase
      .from('action_intents')
      .select('id, params')
      .eq('conversation_id', conversationId)
      .eq('action_type', 'UPDATE_CALENDAR')
      .eq('status', 'DEFERRED')
      .contains('params', { bookSlotIntent: true });

    if (error) {
      this.logger.error(
        `Failed to load deferred book slot intents: ${formatPostgrestError(error)}`,
      );
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

    return (data?.length ?? 0) > 0;
  }

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
    try {
      return { token: decrypt(String(data.private_token_encrypted)) };
    } catch (e) {
      this.logger.warn(
        `GHL token decrypt failed tenant=${tenantId}: ${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    }
  }
}
