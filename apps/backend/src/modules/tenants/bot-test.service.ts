// Subaccount bot test — real generation path with agency policy + subaccount prompt + KB (not live GHL chat).

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { getSupabaseService } from '../../lib/supabase';
import { GenerationService } from '../generation/generation.service';
import { KbService } from '../kb/kb.service';
import { AgencyAiConfigService } from '../agency-ai-config/agency-ai-config.service';
import { TenantsService } from './tenants.service';
import type { MemoryEntry } from '../orchestration/dto/memory-entry';
import type { RetrievalChunk } from '../kb/dto/retrieval.dto';

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

@Injectable()
export class BotTestService {
  private readonly supabase = getSupabaseService();

  constructor(
    private readonly tenantsService: TenantsService,
    private readonly generationService: GenerationService,
    private readonly kbService: KbService,
    private readonly agencyAiConfig: AgencyAiConfigService,
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

    const { data: promptRows } = await this.supabase
      .from('tenant_prompt_configs')
      .select('system_prompt, model_override, temperature, max_tokens, is_active, updated_at')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .order('updated_at', { ascending: false })
      .limit(1);
    const tenantRow = promptRows?.[0];
    const tenantPrompt = tenantRow?.system_prompt as string | undefined;
    const modelOverride = (tenantRow?.model_override as string | null)?.trim() ?? '';
    const subTemp = tenantRow != null ? Number((tenantRow as { temperature?: unknown }).temperature) : NaN;
    const subMax = (tenantRow as { max_tokens?: number | null } | undefined)?.max_tokens;

    const systemPrompt = buildStackedSystemPrompt(agencyPrompt, tenantPrompt);

    const hist: MemoryEntry[] = (body.history ?? []).map(h => ({
      role: h.role,
      content: h.content,
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

    const gen = await this.generationService.generateDraft({
      tenantId,
      incomingMessage: msg,
      systemPrompt,
      memory: hist,
      kbContext: kbChunks,
      model: modelUsed,
      ...(Number.isFinite(subTemp) ? { temperature: subTemp } : {}),
      ...(subMax != null && subMax > 0 ? { maxTokens: subMax } : {}),
    });

    return {
      reply: gen.content,
      skipReason: gen.skipReason,
      usedFallbackProvider: gen.usedFallbackProvider,
      activeProvider,
      modelUsed,
      kbChunksUsed: kbChunks.length,
    };
  }
}
