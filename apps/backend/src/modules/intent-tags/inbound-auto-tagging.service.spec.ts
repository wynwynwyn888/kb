import { jest as jestGlobal } from '@jest/globals';

jestGlobal.mock('./tag-rule-match.service', () => ({
  TagRuleMatchService: class {},
}));

const mockFrom = jestGlobal.fn();
jestGlobal.mock('../../lib/supabase', () => ({
  getSupabaseService: () => ({
    from: mockFrom,
  }),
}));

import { InboundAutoTaggingService, AUTO_TAG_DEDUPE_MS } from './inbound-auto-tagging.service';
import { TagRulesService } from './tag-rules.service';
import { TagRuleMatchService } from './tag-rule-match.service';
import { GhlService } from '../ghl/ghl.service';

describe('InboundAutoTaggingService', () => {
  const tagRules = {
    getTaggingSettings: jestGlobal.fn(),
    listRules: jestGlobal.fn(),
  };
  const tagMatch = {
    testMatch: jestGlobal.fn(),
  };
  const ghl = {
    createGhlClientForConnectedTenantWorkerOrThrow: jestGlobal.fn(),
  };

  let svc: InboundAutoTaggingService;

  beforeEach(() => {
    jestGlobal.clearAllMocks();
    mockFrom.mockImplementation((table: string) => {
      if (table === 'conversations') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { metadata: {} }, error: null }),
            }),
          }),
          update: () => ({
            eq: async () => ({ error: null }),
          }),
        };
      }
      return {} as never;
    });
    svc = new InboundAutoTaggingService(
      tagRules as unknown as TagRulesService,
      tagMatch as unknown as TagRuleMatchService,
      ghl as unknown as GhlService,
    );
  });

  describe('filterDedupedTags', () => {
    it('drops tags applied inside dedupe window', () => {
      const recent = new Date(Date.now() - AUTO_TAG_DEDUPE_MS / 2).toISOString();
      const out = svc.filterDedupedTags(['a', 'b'], { a: recent });
      expect(out).toEqual(['b']);
    });

    it('allows tags outside dedupe window', () => {
      const old = new Date(Date.now() - AUTO_TAG_DEDUPE_MS - 1000).toISOString();
      const out = svc.filterDedupedTags(['a'], { a: old });
      expect(out).toEqual(['a']);
    });
  });

  it('skips when tagging master disabled', async () => {
    tagRules.getTaggingSettings.mockResolvedValue({ automaticTaggingEnabled: false });
    await svc.evaluateAndApplyAutoTags({
      tenantId: 't1',
      conversationId: 'c1',
      contactId: 'ct1',
      ghlLocationId: 'loc1',
      messageText: 'hello',
    });
    expect(tagMatch.testMatch).not.toHaveBeenCalled();
    expect(ghl.createGhlClientForConnectedTenantWorkerOrThrow).not.toHaveBeenCalled();
  });

  it('skips when no enabled rules', async () => {
    tagRules.getTaggingSettings.mockResolvedValue({ automaticTaggingEnabled: true });
    tagRules.listRules.mockResolvedValue({
      rules: [{ enabled: false, id: 'r1' }],
    });
    await svc.evaluateAndApplyAutoTags({
      tenantId: 't1',
      conversationId: 'c1',
      contactId: 'ct1',
      ghlLocationId: 'loc1',
      messageText: 'hello',
    });
    expect(tagMatch.testMatch).not.toHaveBeenCalled();
  });

  it('applies CRM tags when match returns tagsToApply', async () => {
    tagRules.getTaggingSettings.mockResolvedValue({ automaticTaggingEnabled: true });
    tagRules.listRules.mockResolvedValue({
      rules: [{ id: 'r1', enabled: true }],
    });
    tagMatch.testMatch.mockResolvedValue({
      hits: [
        {
          ruleId: 'r1',
          ruleName: 'R',
          crmTagName: 'vip',
          matchMode: 'AI',
          confidence: 0.9,
          confidenceLabel: 'HIGH',
          passesThreshold: true,
          source: 'ai',
          why: 'ok',
          autoApply: true,
        },
      ],
      tagsToApply: ['vip'],
    });

    const tagContact = jestGlobal.fn(async () => ({ success: true }));
    const listTags = jestGlobal.fn(async () => ({
      tags: [{ name: 'vip', id: 'tid' }],
      error: undefined as string | undefined,
    }));
    ghl.createGhlClientForConnectedTenantWorkerOrThrow.mockResolvedValue({
      client: { tagContact, listTags },
    });

    await svc.evaluateAndApplyAutoTags({
      tenantId: 't1',
      conversationId: 'c1',
      contactId: 'ct1',
      ghlLocationId: 'loc1',
      messageText: 'I need help',
    });

    expect(tagContact).toHaveBeenCalledWith({ contactId: 'ct1', tags: ['vip'] });
  });

  it('does not call tagContact when tagsToApply empty (autoApply off)', async () => {
    tagRules.getTaggingSettings.mockResolvedValue({ automaticTaggingEnabled: true });
    tagRules.listRules.mockResolvedValue({
      rules: [{ id: 'r1', enabled: true }],
    });
    tagMatch.testMatch.mockResolvedValue({
      hits: [
        {
          ruleId: 'r1',
          ruleName: 'R',
          crmTagName: 'vip',
          matchMode: 'AI',
          confidence: 0.9,
          confidenceLabel: 'HIGH',
          passesThreshold: true,
          source: 'ai',
          why: 'ok',
          autoApply: false,
        },
      ],
      tagsToApply: [],
    });

    await svc.evaluateAndApplyAutoTags({
      tenantId: 't1',
      conversationId: 'c1',
      contactId: 'ct1',
      ghlLocationId: 'loc1',
      messageText: 'hello',
    });

    expect(ghl.createGhlClientForConnectedTenantWorkerOrThrow).not.toHaveBeenCalled();
  });

  it('continues when tagContact fails (no throw)', async () => {
    tagRules.getTaggingSettings.mockResolvedValue({ automaticTaggingEnabled: true });
    tagRules.listRules.mockResolvedValue({
      rules: [{ id: 'r1', enabled: true }],
    });
    tagMatch.testMatch.mockResolvedValue({
      hits: [],
      tagsToApply: ['x'],
    });

    const tagContact = jestGlobal.fn(async () => ({ success: false, error: 'CRM down' }));
    const listTags = jestGlobal.fn(async () => ({
      tags: [{ name: 'x' }],
      error: undefined as string | undefined,
    }));
    ghl.createGhlClientForConnectedTenantWorkerOrThrow.mockResolvedValue({
      client: { tagContact, listTags },
    });

    await expect(
      svc.evaluateAndApplyAutoTags({
        tenantId: 't1',
        conversationId: 'c1',
        contactId: 'ct1',
        ghlLocationId: 'loc1',
        messageText: 'hello',
      }),
    ).resolves.toBeUndefined();
  });
});
