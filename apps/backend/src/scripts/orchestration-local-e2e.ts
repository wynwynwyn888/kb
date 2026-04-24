/**
 * Local orchestration E2E (no queue, no webhook, no GHL HTTP).
 * Seeds DB via Supabase service role, boots Nest with OrchestrationModule only,
 * runs ConversationOrchestrationService.orchestrate.
 *
 *   cd apps/backend && npm run smoke:orchestration-e2e
 *
 * Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (from .env).
 */

import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { OrchestrationModule } from '../modules/orchestration/orchestration.module';
import { ConversationOrchestrationService } from '../modules/orchestration/orchestration.service';
import type { OrchestrationInput } from '../modules/orchestration/dto';
import { KbService } from '../modules/kb/kb.service';

const TENANT_MARKER = 'E2E_TENANT_SYSTEM_PROMPT_MARKER';
const AGENCY_MARKER = 'E2E_AGENCY_POLICY_CONTENT_MARKER';
const KB_PHRASE = 'e2everify kb orchestration phrase';

/**
 * Mirrors ONLY tenant-vs-agency precedence from `ConversationOrchestrationService` private
 * `buildSystemPrompt` — same branch order (tenant systemPrompt → agency systemPrompt → default string).
 * Does not invoke the service. Must stay in sync with `orchestration.service.ts` if that method changes.
 */
function effectiveSystemPromptForSmoke(input: OrchestrationInput): string {
  const tenantPrompt = input.promptConfig?.systemPrompt;
  const agencyPrompt = input.agencyPolicy?.systemPrompt;
  if (tenantPrompt) return tenantPrompt;
  if (agencyPrompt) return agencyPrompt;
  return 'You are a helpful AI assistant.';
}

function applyEnvFile(path: string, override: boolean): void {
  if (!existsSync(path)) return;
  let content = readFileSync(path, 'utf8');
  if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (override || process.env[key] === undefined) process.env[key] = val;
  }
}

function loadEnvFiles(): void {
  const cwd = process.cwd();
  applyEnvFile(resolve(cwd, '.env'), false);
  applyEnvFile(resolve(cwd, '..', '.env'), false);
  applyEnvFile(resolve(cwd, 'apps', 'backend', '.env'), true);
}

function isoNow(): string {
  return new Date().toISOString();
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        resolve(process.cwd(), '.env'),
        resolve(process.cwd(), '..', '.env'),
        resolve(process.cwd(), 'apps', 'backend', '.env'),
      ],
    }),
    OrchestrationModule,
  ],
})
class OrchestrationE2eModule {}

async function seed(supabase: SupabaseClient): Promise<{
  agencyId: string;
  tenantId: string;
  ghlLocationId: string;
  conversationId: string;
  kbDocumentId: string;
  kbChunkId: string;
  kbDocumentTitle: string;
}> {
  const agencyId = randomUUID();
  const tenantId = randomUUID();
  const ghlLocationId = `e2e_loc_${Date.now()}`;
  const conversationId = randomUUID();
  const now = isoNow();

  const { error: eAgency } = await supabase.from('agencies').insert({
    id: agencyId,
    name: 'E2E Orchestration Agency',
    settings: {},
    created_at: now,
    updated_at: now,
  });
  if (eAgency) throw new Error(`agencies: ${eAgency.message}`);

  const { error: eTenant } = await supabase.from('tenants').insert({
    id: tenantId,
    agency_id: agencyId,
    name: 'E2E Orchestration Tenant',
    ghl_location_id: ghlLocationId,
    status: 'active',
    settings: {},
    bot_enabled: true,
    handover_paused: false,
    created_at: now,
    updated_at: now,
  });
  if (eTenant) throw new Error(`tenants: ${eTenant.message}`);

  const connId = randomUUID();
  const { error: eConn } = await supabase.from('tenant_ghl_connections').insert({
    id: connId,
    tenant_id: tenantId,
    ghl_location_id: ghlLocationId,
    private_token_encrypted: 'e2e-placeholder-token',
    status: 'CONNECTED',
    metadata: {},
    created_at: now,
    updated_at: now,
  });
  if (eConn) throw new Error(`tenant_ghl_connections: ${eConn.message}`);

  const tpcId = randomUUID();
  const { error: eTpc } = await supabase.from('tenant_prompt_configs').insert({
    id: tpcId,
    tenant_id: tenantId,
    name: 'e2e-default',
    system_prompt: `${TENANT_MARKER} You are a helpful assistant.`,
    temperature: 0.7,
    model_override: 'gpt-4o-mini',
    is_active: true,
    prompt_variables: {},
    created_at: now,
    updated_at: now,
  });
  if (eTpc) throw new Error(`tenant_prompt_configs: ${eTpc.message}`);

  const aspId = randomUUID();
  const { error: eAsp } = await supabase.from('agency_system_policies').insert({
    id: aspId,
    agency_id: agencyId,
    name: 'e2e-policy',
    content: `${AGENCY_MARKER} Agency-wide policy text.`,
    priority: 10,
    is_default: false,
    created_at: now,
    updated_at: now,
  });
  if (eAsp) throw new Error(`agency_system_policies: ${eAsp.message}`);

  const docId = randomUUID();
  const { error: eDoc } = await supabase.from('knowledge_documents').insert({
    id: docId,
    tenant_id: tenantId,
    title: 'E2E KB Doc',
    source: 'e2e-seed',
    mime_type: 'text/plain',
    size: 100,
    status: 'READY',
    metadata: {},
    created_at: now,
    updated_at: now,
  });
  if (eDoc) throw new Error(`knowledge_documents: ${eDoc.message}`);

  const chunkId = randomUUID();
  const { error: eChunk } = await supabase.from('knowledge_chunks').insert({
    id: chunkId,
    document_id: docId,
    content: `Reference answer. ${KB_PHRASE} for local verification.`,
    token_count: 20,
    metadata: {},
    created_at: now,
  });
  if (eChunk) throw new Error(`knowledge_chunks: ${eChunk.message}`);

  const { error: eConv } = await supabase.from('conversations').insert({
    id: conversationId,
    tenant_id: tenantId,
    ghl_conversation_id: `e2e_ghl_conv_${randomUUID()}`,
    contact_id: 'e2e-contact',
    channel: 'WHATSAPP',
    status: 'ACTIVE',
    last_message_at: now,
    metadata: {},
    created_at: now,
    updated_at: now,
  });
  if (eConv) throw new Error(`conversations: ${eConv.message}`);

  return {
    agencyId,
    tenantId,
    ghlLocationId,
    conversationId,
    kbDocumentId: docId,
    kbChunkId: chunkId,
    kbDocumentTitle: 'E2E KB Doc',
  };
}

async function main(): Promise<void> {
  loadEnvFiles();
  const url = process.env['SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const ids = await seed(supabase);
  console.log(
    JSON.stringify({ seeded: ids, markers: { TENANT_MARKER, AGENCY_MARKER, KB_PHRASE } }, null, 2),
  );

  const app = await NestFactory.createApplicationContext(OrchestrationE2eModule, {
    logger: false,
  });
  const orchestration = app.get(ConversationOrchestrationService);
  const kbService = app.get(KbService);

  const tenantCtx = await orchestration.loadTenantContext(ids.tenantId);
  const promptConfig = await orchestration.loadPromptConfig(ids.tenantId);
  const agencyPolicy = await orchestration.loadAgencyPolicy(ids.tenantId);
  const conversation = await orchestration.loadConversation(ids.conversationId);

  if (!tenantCtx || !promptConfig || !agencyPolicy || !conversation) {
    console.error('Load failed', {
      tenantCtx: !!tenantCtx,
      promptConfig: !!promptConfig,
      agencyPolicy: !!agencyPolicy,
      conversation: !!conversation,
    });
    process.exit(2);
  }
  if (!promptConfig.systemPrompt.includes(TENANT_MARKER)) {
    console.error('Tenant prompt config missing expected marker');
    process.exit(3);
  }
  if (!agencyPolicy.systemPrompt.includes(AGENCY_MARKER)) {
    console.error('Agency policy missing expected marker');
    process.exit(4);
  }
  if (promptConfig.modelOverride !== 'gpt-4o-mini') {
    console.error('Expected seeded model_override on prompt config');
    process.exit(12);
  }

  const baseMessage = {
    ghlLocationId: ids.ghlLocationId,
    ghlConversationId: 'noop',
    ghlContactId: 'c1',
    messageContent: `Please explain ${KB_PHRASE} and pricing.`,
    messageType: 'text' as const,
    timestamp: isoNow(),
    externalEventId: 'e2e-ext',
    eventType: 'inbound_message',
    dedupeKey: 'e2e-dedupe',
    channelRaw: null,
  };

  const inputFull: OrchestrationInput = {
    tenantId: ids.tenantId,
    conversationId: ids.conversationId,
    webhookEventId: 'e2e-webhook',
    incomingMessage: baseMessage,
    tenant: tenantCtx,
    promptConfig,
    agencyPolicy,
    conversation,
  };

  const effectiveWithTenant = effectiveSystemPromptForSmoke(inputFull);
  if (!effectiveWithTenant.includes(TENANT_MARKER)) {
    console.error('Effective system prompt should include tenant marker when promptConfig present');
    process.exit(13);
  }
  if (effectiveWithTenant.includes(AGENCY_MARKER)) {
    console.error('Effective system prompt should not include agency text when tenant prompt wins');
    process.exit(14);
  }

  // Same arguments as orchestration.service retrieveKbContext → kbService.retrieve
  const kbRetrieval = await kbService.retrieve({
    tenantId: inputFull.tenantId,
    conversationId: inputFull.conversationId,
    query: inputFull.incomingMessage.messageContent,
    topK: 5,
  });
  if (kbRetrieval.chunks.length < 1) {
    console.error('KB retrieve expected at least one chunk', kbRetrieval);
    process.exit(15);
  }
  const hasSeededChunk = kbRetrieval.chunks.some(c => c.chunkId === ids.kbChunkId);
  if (!hasSeededChunk) {
    console.error('KB retrieve did not return the seeded chunk id', {
      expectedChunkId: ids.kbChunkId,
      gotIds: kbRetrieval.chunks.map(c => c.chunkId),
    });
    process.exit(16);
  }
  const topMatchesDoc =
    kbRetrieval.chunks[0]?.title === ids.kbDocumentTitle ||
    kbRetrieval.chunks.some(c => c.title === ids.kbDocumentTitle);
  if (!topMatchesDoc) {
    console.error('Expected seeded document title on retrieved chunk(s)');
    process.exit(17);
  }

  const r1 = await orchestration.orchestrate(inputFull);
  if (!r1.success || r1.outcome !== 'PROCEED') {
    console.error('Orchestration 1 failed', JSON.stringify(r1, null, 2));
    process.exit(5);
  }
  if (!r1.routing?.recommendedModel) {
    console.error('Missing routing decision');
    process.exit(6);
  }
  if (r1.routing.recommendedModel !== promptConfig.modelOverride) {
    console.error(
      'RoutingResponse.recommendedModel must equal loaded promptConfig.modelOverride',
      { recommendedModel: r1.routing.recommendedModel, modelOverride: promptConfig.modelOverride },
    );
    process.exit(21);
  }
  const bubbles1 = r1.replyPlan?.bubbles?.length ?? 0;
  if (bubbles1 < 1) {
    console.error('Expected at least one reply bubble');
    process.exit(7);
  }

  const inputAgencyFallback: OrchestrationInput = {
    ...inputFull,
    promptConfig: undefined,
  };
  const effectiveAgencyOnly = effectiveSystemPromptForSmoke(inputAgencyFallback);
  if (!effectiveAgencyOnly.includes(AGENCY_MARKER)) {
    console.error('Agency-only effective system prompt should include agency marker');
    process.exit(18);
  }
  if (effectiveAgencyOnly.includes(TENANT_MARKER)) {
    console.error('Agency-only path should not include tenant marker');
    process.exit(19);
  }

  const r2 = await orchestration.orchestrate(inputAgencyFallback);
  if (!r2.success || r2.outcome !== 'PROCEED') {
    console.error('Orchestration 2 (agency fallback) failed', JSON.stringify(r2, null, 2));
    process.exit(8);
  }
  if ((r2.replyPlan?.bubbles?.length ?? 0) < 1) {
    console.error('Agency fallback run expected at least one bubble');
    process.exit(20);
  }

  await app.close();

  const routingMatchesOverride =
    r1.routing.recommendedModel === promptConfig.modelOverride;

  const bubblesRun2 = (r2.replyPlan?.bubbles?.length ?? 0) >= 1;
  const replyPlanningProducedBubbles =
    bubbles1 >= 1 && bubblesRun2 ? 'yes' : 'no';

  console.log(
    JSON.stringify(
      {
        ok: true,
        report: {
          tenantPromptSelected:
            effectiveWithTenant.includes(TENANT_MARKER) &&
            !effectiveWithTenant.includes(AGENCY_MARKER)
              ? 'yes'
              : 'no',
          agencyFallbackSelected:
            effectiveAgencyOnly.includes(AGENCY_MARKER) &&
            !effectiveAgencyOnly.includes(TENANT_MARKER)
              ? 'yes'
              : 'no',
          kbSeededChunkRetrievedByExactId: hasSeededChunk ? 'yes' : 'no',
          kbSeededDocumentTitleObserved: topMatchesDoc ? 'yes' : 'no',
          replyPlanningProducedBubbles,
          modelOverrideLoadedFromPromptConfig:
            promptConfig.modelOverride === 'gpt-4o-mini' ? 'yes' : 'no',
          modelOverrideAffectedRoutingSelection: routingMatchesOverride
            ? 'yes'
            : 'no',
          modelOverridePropagationStopsAt: routingMatchesOverride
            ? null
            : 'expected promptConfig.modelOverride → RoutingRequest.tenantModelOverride → RoutingResponse.recommendedModel; check orchestration buildRoutingRequest and AiRouterService.route.',
          recommendedModelMatchesSeededOverride: routingMatchesOverride ? 'yes' : 'no',
        },
        diagnosis: {
          modelOverrideFromPromptConfig: promptConfig.modelOverride ?? null,
          routingResponseRecommendedModel: r1.routing.recommendedModel,
          /** Run 1: `live_generation` | `placeholder_fallback` | null — model output only if `live_generation`. */
          replyDraftProvenance: r1.replyPlan?.draftProvenance ?? null,
          /** When present: why the live path did not produce bubble text (bubbles may still be non-model `placeholder_fallback` copy). */
          replyDraftFallbackReason: r1.replyPlan?.draftFallbackReason ?? null,
          /** `yes` only when bubble text provenance is `live_generation` (not "generation was attempted"). */
          liveGenerationUsedForBubbles:
            r1.replyPlan?.draftProvenance === 'live_generation' ? 'yes' : 'no',
          /** `yes` when bubble text is deterministic placeholder path — does not imply LLM output. */
          placeholderFallbackUsedForBubbles:
            r1.replyPlan?.draftProvenance === 'placeholder_fallback' ? 'yes' : 'no',
        },
      },
      null,
      2,
    ),
  );
}

void main().catch(e => {
  console.error(e);
  process.exit(1);
});
