import { Injectable, Logger } from '@nestjs/common';
import { getSupabaseService } from '../../lib/supabase';
import { randomUUID } from 'crypto';

export interface AuditEntry {
  agencyId: string;
  profileId: string;
  tenantId?: string;
  action: string;
  resource: string;
  resourceId?: string;
  changes?: Record<string, unknown>;
  ipAddress?: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  /**
   * Fire-and-forget audit log write. Never throws — failures are logged at warn level.
   * Callers must NOT await this in a way that blocks business operations.
   */
  log(entry: AuditEntry): void {
    void this.doLog(entry).catch((e) => {
      this.logger.warn(`audit_log_failed: ${e instanceof Error ? e.message : String(e)}`);
    });
  }

  private async doLog(entry: AuditEntry): Promise<void> {
    const supabase = getSupabaseService();
    const { error } = await supabase.from('audit_logs').insert({
      id: randomUUID(),
      agency_id: entry.agencyId,
      profile_id: entry.profileId,
      tenant_id: entry.tenantId ?? null,
      action: entry.action,
      resource: entry.resource,
      resource_id: entry.resourceId ?? null,
      changes: entry.changes ?? {},
      ip_address: entry.ipAddress ?? null,
    });
    if (error) {
      this.logger.warn(`audit_log_insert_error: action=${entry.action} resource=${entry.resource} err=${String(error)}`);
    }
  }
}
