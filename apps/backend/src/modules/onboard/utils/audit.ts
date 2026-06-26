import { Injectable, Logger } from '@nestjs/common';
import { getSupabaseService } from '../../../lib/supabase';
import { randomUUID } from 'node:crypto';

export interface OnboardAuditEntry {
  projectId?: string;
  actorId: string;
  actorType: string;
  action: string;
  resourceType: string;
  resourceId: string;
  changes?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  correlationId?: string;
}

@Injectable()
export class OnboardAuditService {
  private readonly logger = new Logger(OnboardAuditService.name);

  log(entry: OnboardAuditEntry): void {
    void this.doLog(entry).catch(e => {
      this.logger.warn(`onboard_audit_failed: ${e instanceof Error ? e.message : String(e)}`);
    });
  }

  private async doLog(entry: OnboardAuditEntry): Promise<void> {
    const supabase = getSupabaseService();
    const { error } = await supabase.from('audit_events').insert({
      id: randomUUID(),
      project_id: entry.projectId ?? null,
      actor_id: entry.actorId,
      actor_type: entry.actorType,
      action: entry.action,
      resource_type: entry.resourceType,
      resource_id: entry.resourceId,
      changes: entry.changes ?? {},
      ip_address: entry.ipAddress ?? null,
      user_agent: entry.userAgent ?? null,
      correlation_id: entry.correlationId ?? null,
    });
    if (error) {
      this.logger.warn(`onboard_audit_insert_error: action=${entry.action} resource=${entry.resourceType} err=${String(error)}`);
    }
  }
}
