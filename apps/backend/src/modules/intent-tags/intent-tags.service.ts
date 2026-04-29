import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { getSupabaseService } from '../../lib/supabase';
import { GhlService } from '../ghl/ghl.service';
import type { GhlTagSummary } from '@aisbp/ghl-client';
import {
  assertMvpIntentKey,
  parseIntentTriggerMode,
} from '../../lib/tenant-automation-validation';
import { MVP_INTENT_KEYS, type IntentTagTriggerMode, type MvpIntentKey } from '../../lib/tenant-automation-constants';

export interface IntentTagRuleDto {
  intentKey: MvpIntentKey;
  tagName: string;
  enabled: boolean;
  triggerMode: IntentTagTriggerMode;
}

/** Rules eligible for automatic tagging in downstream execution (enabled + AUTO + non-empty tag). */
export function enabledAutoTagRulesForExecutor(rules: IntentTagRuleDto[]): IntentTagRuleDto[] {
  return rules.filter((r) => r.enabled && r.triggerMode === 'AUTO' && r.tagName.trim().length > 0);
}

@Injectable()
export class IntentTagsService {
  private readonly logger = new Logger(IntentTagsService.name);
  private readonly supabase = getSupabaseService();

  constructor(private readonly ghlService: GhlService) {}

  async getIntentTagRules(tenantId: string): Promise<{ rules: IntentTagRuleDto[] }> {
    const { data: rows, error } = await this.supabase
      .from('tenant_intent_tag_rules')
      .select('intent_key, tag_name, enabled, trigger_mode')
      .eq('tenant_id', tenantId);

    if (error) {
      this.logger.warn(`getIntentTagRules: ${error.message}`);
      throw new BadRequestException('Could not load intent tag rules');
    }

    const byKey = new Map<string, IntentTagRuleDto>();
    for (const r of rows ?? []) {
      const rec = r as Record<string, unknown>;
      const ik = String(rec['intent_key'] ?? '');
      byKey.set(ik, {
        intentKey: ik as MvpIntentKey,
        tagName: String(rec['tag_name'] ?? ''),
        enabled: Boolean(rec['enabled']),
        triggerMode: String(rec['trigger_mode'] ?? 'OFF') as IntentTagTriggerMode,
      });
    }

    const rules: IntentTagRuleDto[] = MVP_INTENT_KEYS.map((key) => {
      const hit = byKey.get(key);
      return (
        hit ?? {
          intentKey: key,
          tagName: '',
          enabled: false,
          triggerMode: 'OFF',
        }
      );
    });

    return { rules };
  }

  async patchIntentTagRules(tenantId: string, incoming: { rules: unknown }): Promise<{ rules: IntentTagRuleDto[] }> {
    if (!incoming || typeof incoming !== 'object' || !Array.isArray(incoming.rules)) {
      throw new BadRequestException('Body must include rules: [...]');
    }

    const now = new Date().toISOString();

    for (const raw of incoming.rules) {
      if (!raw || typeof raw !== 'object') {
        throw new BadRequestException('Each rule must be an object');
      }
      const o = raw as Record<string, unknown>;
      const intentKey = typeof o['intentKey'] === 'string' ? o['intentKey'].trim() : '';
      assertMvpIntentKey(intentKey);
      const tagName = typeof o['tagName'] === 'string' ? o['tagName'].trim() : '';
      const enabled = Boolean(o['enabled']);
      const triggerMode = parseIntentTriggerMode(o['triggerMode']);

      if (enabled && triggerMode === 'AUTO' && !tagName) {
        throw new BadRequestException(`intent ${intentKey}: AUTO rules require a GHL tag name`);
      }

      const { data: existing } = await this.supabase
        .from('tenant_intent_tag_rules')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('intent_key', intentKey)
        .maybeSingle();

      if (existing?.id) {
        const { error } = await this.supabase
          .from('tenant_intent_tag_rules')
          .update({
            tag_name: tagName,
            enabled,
            trigger_mode: triggerMode,
            updated_at: now,
          })
          .eq('id', existing.id);
        if (error) throw new BadRequestException(error.message);
      } else {
        const { error } = await this.supabase.from('tenant_intent_tag_rules').insert({
          id: randomUUID(),
          tenant_id: tenantId,
          intent_key: intentKey,
          tag_name: tagName,
          enabled,
          trigger_mode: triggerMode,
          created_at: now,
          updated_at: now,
        });
        if (error) throw new BadRequestException(error.message);
      }
    }

    return this.getIntentTagRules(tenantId);
  }

  async syncTags(tenantId: string, profileId: string): Promise<{
    tags: GhlTagSummary[];
    syncedAt: string;
    error?: string;
  }> {
    const { client } = await this.ghlService.createGhlClientForConnectedTenantOrThrow(tenantId, profileId);
    const r = await client.listTags();
    const syncedAt = new Date().toISOString();
    if (r.error) this.logger.warn(`syncTags GHL: ${r.error}`);
    return { tags: r.tags, syncedAt, error: r.error };
  }

  async testTag(
    tenantId: string,
    profileId: string,
    body: { contactId?: string; tagName?: string },
  ): Promise<{ success: boolean; message?: string; error?: string }> {
    const contactId = body.contactId?.trim();
    const tagName = body.tagName?.trim();
    if (!contactId) throw new BadRequestException('contactId is required');
    if (!tagName) throw new BadRequestException('tagName is required');

    const { client } = await this.ghlService.createGhlClientForConnectedTenantOrThrow(tenantId, profileId);
    const listed = await client.listTags();
    if (listed.error) {
      return { success: false, error: listed.error };
    }
    const approved = listed.tags.some((t) => t.name.trim().toLowerCase() === tagName.toLowerCase());
    if (!approved) {
      return {
        success: false,
        error: 'Tag is not in the location tag list. Sync tags from GHL and pick an existing tag name.',
      };
    }

    const result = await client.tagContact({ contactId, tags: [tagName] });
    if (!result.success) {
      return { success: false, error: result.error ?? 'Tag failed' };
    }
    return { success: true, message: 'Tag applied to contact.' };
  }
}
