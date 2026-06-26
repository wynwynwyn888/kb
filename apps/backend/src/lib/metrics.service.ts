import { Injectable, Logger } from '@nestjs/common';
import { getSupabaseService } from './supabase';
import { randomUUID } from 'crypto';

export interface MetricEvent {
  tenantId?: string;
  conversationId?: string;
  eventType: string;
  eventSource: string;
  severity?: 'info' | 'warn' | 'error';
  metadata?: Record<string, unknown>;
}

@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);

  /**
   * Fire-and-forget metrics write. Never throws — failures are logged at warn level.
   * Callers must NOT await this in a way that blocks message flow.
   */
  emit(event: MetricEvent): void {
    void this.doEmit(event).catch((e) => {
      this.logger.warn(`metrics_emit_failed: ${e instanceof Error ? e.message : String(e)}`);
    });
  }

  private async doEmit(event: MetricEvent): Promise<void> {
    const supabase = getSupabaseService();
    const row: Record<string, unknown> = {
      id: randomUUID(),
      tenant_id: event.tenantId ?? null,
      conversation_id: event.conversationId ?? null,
      event_type: event.eventType,
      event_source: event.eventSource,
      severity: event.severity ?? 'info',
      ...(event.metadata ? { metadata: event.metadata } : {}),
    };
    const { error } = await supabase.from('metrics_events').insert(row);
    if (error) {
      this.logger.warn(`metrics_emit_insert_error: eventType=${event.eventType} source=${event.eventSource} err=${String(error)}`);
    }
  }
}
