// Subaccount bot test — real generation path with agency policy + subaccount prompt + KB (not live GHL chat).

import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { getSupabaseService } from '../../lib/supabase';
import { GenerationService } from '../generation/generation.service';
import { KbService } from '../kb/kb.service';
import { AgencyAiConfigService } from '../agency-ai-config/agency-ai-config.service';
import { TenantsService } from './tenants.service';
import { BotProfilesService } from '../prompts/bot-profiles.service';
import type { MemoryEntry } from '../orchestration/dto/memory-entry';
import type { RetrievalChunk } from '../kb/dto/retrieval.dto';
import { formatLiveCustomerDraftForPreview } from '../../lib/live-outbound-preview';

function buildStackedSystemPrompt(
  agencyPrompt: string | null | undefined,
  tenantPrompt: string | null | undefined,
): string {
  const a = agencyPrompt?.trim();
  const t = tenantPrompt?.trim();
  if (a && t) {
    return `${a}\n\n---\n\nSubaccount bot instructions:\n${t}`;
  }
  if (t) return t;
  if (a) return a;
  return 'You are a helpful AI assistant.';
}

const BOT_TEST_MAX_HISTORY_MESSAGES = 12;

@Injectable()
export class BotTestService {
  private readonly logger = new Logger(BotTestService.name);
  private readonly supabase = getSupabaseService();

  constructor(
    private readonly tenantsService: TenantsService,
    private readonly generationService: GenerationService,
    private readonly kbService: KbService,
    private readonly agencyAiConfig: AgencyAiConfigService,
    private readonly botProfiles: BotProfilesService,
  ) {}

  async runTest(
    tenantId: string,
    profileId: string,
    body: { message: string; history?: Array<{ role: 'user' | 'assistant'; content: string }> },
  ): Promise<{
    reply: string | null;
    skipReason?: string;
    usedFallbackProvider?: 'OPENAI';
    activeProvider: string;
    modelUsed: string;
    kbChunksUsed: number;
    /** Non–customer-facing hint for support / Response details (no raw provider payloads). */
    supportDetail?: string;
  }> {
    const ok = await this.tenantsService.checkTenantAccess(tenantId, profileId);
    if (!ok) throw new NotFoundException('Not found');

    const msg = body.message?.trim();
    if (!msg) throw new BadRequestException('message is required');

    const { data: tenant } = await this.supabase
      .from('tenants')
      .select('id, agency_id')
      .eq('id', tenantId)
      .single();
    if (!tenant) throw new NotFoundException('Subaccount not found');

    const agencyId = tenant.agency_id as string;

    const { data: policyRows } = await this.supabase
      .from('agency_system_policies')
      .select('content, priority, created_at')
      .eq('agency_id', agencyId)
      .order('priority', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1);
    const agencyPrompt = policyRows?.[0]?.content as string | undefined;

    const orch = await this.botProfiles.getActivePromptForOrchestration(tenantId);
    const tenantPrompt = orch?.systemPrompt;
    const modelOverride = orch?.modelOverride?.trim() ?? '';
    const subTemp = orch != null ? Number(orch.temperature) : NaN;
    const subMax = orch?.maxTokens ?? null;

    const systemPrompt = buildStackedSystemPrompt(agencyPrompt, tenantPrompt);

    const normalizedHistory = (body.history ?? [])
      .filter(
        (h): h is { role: 'user' | 'assistant'; content: string } =>
          (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string' && h.content.trim().length > 0,
      )
      .slice(-BOT_TEST_MAX_HISTORY_MESSAGES);

    const hist: MemoryEntry[] = normalizedHistory.map(h => ({
      role: h.role,
      content: h.content.trim(),
      sender: h.role === 'user' ? 'CONTACT' : 'AI',
      timestamp: new Date().toISOString(),
      messageType: 'text' as const,
    }));

    const kbResult = await this.kbService.retrieve({
      tenantId,
      conversationId: 'bot-test',
      query: msg,
      topK: 8,
    });
    const kbChunks: RetrievalChunk[] = kbResult.chunks;

    const cfg = await this.agencyAiConfig.getConfig(agencyId);
    const activeProvider = cfg?.activeProvider ?? 'OPENAI';
    const modelUsed = modelOverride || cfg?.activeModel || cfg?.defaultModel || 'gpt-4o-mini';

    const draftParams = {
      tenantId,
      incomingMessage: msg,
      systemPrompt,
      memory: hist,
      kbContext: kbChunks,
      tenantGenerationModelOverride: modelUsed,
      ...(Number.isFinite(subTemp) ? { temperature: subTemp } : {}),
      ...(subMax != null && subMax > 0 ? { maxTokens: subMax } : {}),
    };

    let gen = await this.generationService.generateDraft(draftParams);
    let supportDetail: string | undefined;

    const shouldRetry =
      !gen.content &&
      (gen.skipReason === 'generation_failed' || gen.skipReason === undefined) &&
      hist.length > 0;

    if (shouldRetry) {
      const firstSkip = gen.skipReason ?? 'n/a';
      this.logger.warn(
        `Bot test empty reply for tenant=${tenantId} skip=${firstSkip} historyTurns=${hist.length}; retrying without prior turns`,
      );
      await new Promise<void>(resolve => {
        setTimeout(resolve, 120);
      });
      const genNoHist = await this.generationService.generateDraft({
        ...draftParams,
        memory: [],
      });
      if (genNoHist.content) {
        gen = genNoHist;
        supportDetail = 'retried_without_prior_turns';
      } else {
        const shortMem = hist.length > 4 ? hist.slice(-4) : hist.slice(-2);
        const genShort = await this.generationService.generateDraft({
          ...draftParams,
          memory: shortMem,
        });
        if (genShort.content) {
          gen = genShort;
          supportDetail = 'retried_with_short_history';
        } else {
          gen = genShort;
          supportDetail = [
            `first_skip=${firstSkip}`,
            `retry_empty_skip=${genNoHist.skipReason ?? 'n/a'}`,
            `short_hist_skip=${genShort.skipReason ?? 'n/a'}`,
          ].join('; ');
        }
      }
    }

    return {
      reply: gen.content ? formatLiveCustomerDraftForPreview(gen.content) : null,
      skipReason: gen.skipReason,
      usedFallbackProvider: gen.usedFallbackProvider,
      activeProvider,
      modelUsed,
      kbChunksUsed: kbChunks.length,
      ...(supportDetail ? { supportDetail } : {}),
    };
  }
}
