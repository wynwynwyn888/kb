import { Injectable, Logger } from '@nestjs/common';
import { getSupabaseService } from '../../lib/supabase';
import { formatPostgrestError } from '../../lib/format-postgrest-error';
import {
  mergeConversationMetadataForPersist,
  readConversationMetadataField,
} from '../../lib/conversation-metadata-merge';
import { GhlService } from '../ghl/ghl.service';
import { TagRulesService } from './tag-rules.service';
import { TagRuleMatchService, type TagRuleMatchResult } from './tag-rule-match.service';

/** Skip re-applying the same CRM tag in the same conversation within this window. */
export const AUTO_TAG_DEDUPE_MS = 15 * 60 * 1000;

const META_DEDUPE_KEY = 'aisbpAutoTagDedupe';

export interface EvaluateAutoTagsParams {
  tenantId: string;
  conversationId: string;
  /** GHL contact id */
  contactId: string;
  /** Location id from webhook — informational for logs only */
  ghlLocationId: string;
  /** Combined inbound batch text preferred over single latest line */
  messageText: string;
}

function normTag(s: string): string {
  return s.trim().toLowerCase();
}

@Injectable()
export class InboundAutoTaggingService {
  private readonly logger = new Logger(InboundAutoTaggingService.name);
  private readonly supabase = getSupabaseService();

  constructor(
    private readonly tagRules: TagRulesService,
    private readonly tagMatch: TagRuleMatchService,
    private readonly ghl: GhlService,
  ) {}

  /**
   * Evaluate tenant tag rules for an inbound turn and apply matching CRM tags.
   * Never throws — errors are logged; orchestration must not depend on this.
   */
  async evaluateAndApplyAutoTags(params: EvaluateAutoTagsParams): Promise<void> {
    const { tenantId, conversationId, contactId, ghlLocationId, messageText } = params;
    try {
      const settings = await this.tagRules.getTaggingSettings(tenantId);
      if (!settings.automaticTaggingEnabled) {
        this.logger.log(
          `autoTaggingSkipped ${JSON.stringify({ reason: 'tagging_disabled', tenantId, conversationId, contactId })}`,
        );
        return;
      }

      const { rules } = await this.tagRules.listRules(tenantId);
      const enabledRules = rules.filter(r => r.enabled);
      if (enabledRules.length === 0) {
        this.logger.log(
          `autoTaggingSkipped ${JSON.stringify({ reason: 'no_enabled_rules', tenantId, conversationId, contactId })}`,
        );
        return;
      }

      const trimmed = (messageText ?? '').trim();
      if (!trimmed) {
        this.logger.log(
          `autoTaggingSkipped ${JSON.stringify({ reason: 'empty_message', tenantId, conversationId, contactId })}`,
        );
        return;
      }

      let matchResult: TagRuleMatchResult;
      try {
        matchResult = await this.tagMatch.testMatch(tenantId, trimmed);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        this.logger.warn(
          `autoTaggingMatchFailed ${JSON.stringify({ tenantId, conversationId, contactId, error: message })}`,
        );
        return;
      }

      const rulesChecked = enabledRules.length;
      const matchedRuleIds = matchResult.hits.map(h => h.ruleId);
      const autoApplyRuleIds = matchResult.hits.filter(h => h.autoApply).map(h => h.ruleId);
      let tagsToApply = [...matchResult.tagsToApply];

      this.logger.log(
        `autoTaggingEvaluated ${JSON.stringify({
          tenantId,
          conversationId,
          contactId,
          ghlLocationId,
          rulesChecked,
          matchedRuleIds,
          autoApplyRuleIds,
          tagsToApply,
        })}`,
      );

      if (tagsToApply.length === 0) {
        this.logExecuted(tenantId, conversationId, contactId, [], true, null);
        return;
      }

      const dedupe = await this.loadDedupeMap(conversationId);
      const beforeDedupe = tagsToApply.length;
      tagsToApply = this.filterDedupedTags(tagsToApply, dedupe);
      if (tagsToApply.length < beforeDedupe) {
        this.logger.debug(
          `autoTaggingDeduped: conversationId=${conversationId} skippedRecent=${beforeDedupe - tagsToApply.length}`,
        );
      }

      if (tagsToApply.length === 0) {
        this.logExecuted(tenantId, conversationId, contactId, [], true, null, 'all_tags_recently_applied');
        return;
      }

      let appliedTags: string[] = [];
      let succeeded = false;
      let errorMessage: string | null = null;

      try {
        const { client } = await this.ghl.createGhlClientForConnectedTenantWorkerOrThrow(tenantId);
        const listed = await client.listTags();
        if (listed.error) {
          errorMessage = listed.error;
        } else {
          const approved = new Set(listed.tags.map(t => t.name.trim().toLowerCase()));
          const safeTags = tagsToApply.filter(t => approved.has(t.trim().toLowerCase()));
          const dropped = tagsToApply.filter(t => !approved.has(t.trim().toLowerCase()));
          if (dropped.length > 0) {
            this.logger.warn(
              `autoTaggingFilteredUnknownTags: ${JSON.stringify({ tenantId, conversationId, dropped })}`,
            );
          }
          if (safeTags.length === 0) {
            errorMessage = 'No tags matched CRM tag list';
          } else {
            const res = await client.tagContact({ contactId, tags: safeTags });
            if (!res.success) {
              errorMessage = res.error ?? 'tagContact failed';
            } else {
              succeeded = true;
              appliedTags = safeTags;
              await this.mergeDedupe(conversationId, safeTags);
            }
          }
        }
      } catch (e) {
        errorMessage = e instanceof Error ? e.message : String(e);
      }

      this.logExecuted(tenantId, conversationId, contactId, appliedTags, succeeded, errorMessage);
    } catch (e) {
      this.logger.error(
        `autoTaggingUnexpected ${JSON.stringify({
          tenantId,
          conversationId,
          contactId,
          error: e instanceof Error ? e.message : String(e),
        })}`,
      );
    }
  }

  private logExecuted(
    tenantId: string,
    conversationId: string,
    contactId: string,
    tagsApplied: string[],
    succeeded: boolean,
    errorMessage: string | null,
    note?: string,
  ): void {
    this.logger.log(
      `autoTaggingExecuted ${JSON.stringify({
        tenantId,
        conversationId,
        contactId,
        tagsApplied,
        succeeded,
        failed: !succeeded && !!errorMessage,
        errorMessage,
        ...(note ? { note } : {}),
      })}`,
    );
  }

  /** @internal */
  filterDedupedTags(tags: string[], dedupe: Record<string, string> | undefined): string[] {
    if (!dedupe) return tags;
    const now = Date.now();
    return tags.filter(t => {
      const key = normTag(t);
      const prev = dedupe[key];
      if (!prev) return true;
      const ts = new Date(prev).getTime();
      if (Number.isNaN(ts)) return true;
      return now - ts > AUTO_TAG_DEDUPE_MS;
    });
  }

  private async loadDedupeMap(conversationId: string): Promise<Record<string, string> | undefined> {
    const { data, error } = await this.supabase
      .from('conversations')
      .select('metadata')
      .eq('id', conversationId)
      .maybeSingle();
    if (error || !data?.metadata || typeof data.metadata !== 'object' || Array.isArray(data.metadata)) {
      return undefined;
    }
    const raw = (data.metadata as Record<string, unknown>)[META_DEDUPE_KEY];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === 'string' && v.trim()) out[k] = v;
    }
    return Object.keys(out).length ? out : undefined;
  }

  private async mergeDedupe(conversationId: string, appliedTags: string[]): Promise<void> {
    const { data, error } = await this.supabase.from('conversations').select('metadata').eq('id', conversationId).maybeSingle();
    if (error) {
      this.logger.warn(`mergeDedupe read failed: ${formatPostgrestError(error)}`);
      return;
    }
    const prevMeta = readConversationMetadataField(data?.metadata);
    const prevDedupe =
      prevMeta[META_DEDUPE_KEY] && typeof prevMeta[META_DEDUPE_KEY] === 'object' && !Array.isArray(prevMeta[META_DEDUPE_KEY])
        ? { ...(prevMeta[META_DEDUPE_KEY] as Record<string, unknown>) }
        : {};
    const dedupe: Record<string, string> = {};
    for (const [k, v] of Object.entries(prevDedupe)) {
      if (typeof v === 'string') dedupe[k] = v;
    }
    const now = new Date().toISOString();
    for (const t of appliedTags) {
      dedupe[normTag(t)] = now;
    }
    const incoming = { [META_DEDUPE_KEY]: dedupe };
    const merged = mergeConversationMetadataForPersist(prevMeta, incoming);
    const { error: upErr } = await this.supabase
      .from('conversations')
      .update({ metadata: merged, updated_at: now })
      .eq('id', conversationId);
    if (upErr) {
      this.logger.warn(`mergeDedupe update failed: ${formatPostgrestError(upErr)}`);
    }
  }
}
