/**
 * Staging/local-only RAG vector-context evaluation harness.
 *
 * Purpose: repeatedly test whether RAG vector context is ready to feed the
 * prompt, WITHOUT touching production and WITHOUT printing raw chunk content
 * or secrets. It forces the vector-context flags on for a single tenant, runs
 * the existing `runKbVectorContext`, and compares against the existing keyword
 * `KbService.retrieve` output.
 *
 * Example:
 *   pnpm --filter @aisbp/backend exec tsx scripts/evaluate-kb-rag-context.ts \
 *     --tenant stg-rag-tenant --query "What are your prices?" --json
 *
 *   # Built-in safe question set (only for the staging test tenant):
 *   pnpm --filter @aisbp/backend exec tsx scripts/evaluate-kb-rag-context.ts --tenant stg-rag-tenant
 *
 *   # Kill-switch check (respects current env, no embedding calls):
 *   KB_VECTOR_CONTEXT_ENABLED=false pnpm --filter @aisbp/backend exec \
 *     tsx scripts/evaluate-kb-rag-context.ts --tenant stg-rag-tenant --kill-switch-check
 *
 * Safety:
 *   - Refuses production-like envs; requires NODE_ENV/APP_ENV/RAILWAY_ENVIRONMENT/
 *     VERCEL_ENV to include "staging"/"stage".
 *   - Reads env only from the process (no dotenv).
 *   - Output is ids/scores/modes/previews only — never raw content or secrets.
 */

import { KbService } from '../src/modules/kb/kb.service';
import {
  runKbVectorContext,
  kbVectorContextEnabledForTenant,
  type KbVectorContextOutcome,
} from '../src/modules/kb/embedding/kb-vector-context.runner';
import {
  parseEvalArgs,
  resolveStagingEnvGuard,
  shapeQueryEvalReport,
  mergeTenantIntoAllowlist,
  type EvalCliOptions,
  type KeywordComparison,
} from '../src/modules/kb/embedding/kb-rag-eval';

const KILL_SWITCH_OUTCOME: KbVectorContextOutcome = { ok: false, reason: 'kill_switch_disabled' };

function fail(reason: string, extra: Record<string, unknown> = {}): never {
  console.error(JSON.stringify({ event: 'kb_rag_eval_error', reason, ...extra }));
  process.exit(1);
}

function isExplicitlyDisabled(): boolean {
  return String(process.env['KB_VECTOR_CONTEXT_ENABLED'] ?? '').trim().toLowerCase() === 'false';
}

async function keywordCompare(kb: KbService, opts: EvalCliOptions, query: string): Promise<KeywordComparison | null> {
  try {
    const result = await kb.retrieve({
      tenantId: opts.tenantId,
      conversationId: 'kb-rag-eval',
      query,
      topK: opts.topK,
      documentIdAllowlist: opts.documentIdAllowlist,
    });
    return {
      retrievalMode: result.retrievalMode,
      totalConsidered: result.totalConsidered,
      chunks: result.chunks.map((c) => ({
        chunkId: c.chunkId,
        documentId: c.documentId,
        relevanceScore: c.relevanceScore,
      })),
    };
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const guard = resolveStagingEnvGuard(process.env);
  if (!guard.ok) {
    fail(guard.reason, {
      hint: 'Set NODE_ENV/APP_ENV/RAILWAY_ENVIRONMENT/VERCEL_ENV to a staging value; production-like envs are refused.',
    });
  }

  let opts: EvalCliOptions;
  try {
    opts = parseEvalArgs(process.argv.slice(2));
  } catch (error) {
    fail('invalid_args', { message: error instanceof Error ? error.message : String(error) });
  }

  // Kill-switch check mode: respect current env, no embedding/vector calls.
  if (opts.killSwitchCheck) {
    const enabled = kbVectorContextEnabledForTenant(opts.tenantId);
    console.log(
      JSON.stringify(
        {
          event: 'kb_rag_eval_kill_switch',
          tenantId: opts.tenantId,
          flag: process.env['KB_VECTOR_CONTEXT_ENABLED'] ?? 'unset',
          vectorContextEnabledForTenant: enabled,
          status: enabled ? 'enabled' : 'disabled_fallback_to_keyword',
          note: enabled
            ? 'Vector context would be eligible to enter the prompt for this tenant in staging.'
            : 'Vector context is OFF; replies fall back to keyword retrieval.',
        },
        null,
        2,
      ),
    );
    return;
  }

  const explicitlyDisabled = isExplicitlyDisabled();
  if (!explicitlyDisabled) {
    // Force-enable the vector-context flags for ONLY the provided tenant.
    process.env['KB_VECTOR_CONTEXT_ENABLED'] = 'true';
    process.env['KB_VECTOR_CONTEXT_TENANT_IDS'] = mergeTenantIntoAllowlist(
      process.env['KB_VECTOR_CONTEXT_TENANT_IDS'],
      opts.tenantId,
    );
  }
  if (opts.minScore != null) {
    process.env['KB_VECTOR_CONTEXT_MIN_SCORE'] = String(opts.minScore);
  }

  const vectorEnabledForTenant = kbVectorContextEnabledForTenant(opts.tenantId);
  const kb = new KbService();

  const reports = [];
  for (const query of opts.queries) {
    const vectorOutcome: KbVectorContextOutcome = vectorEnabledForTenant
      ? await runKbVectorContext(
          {
            tenantId: opts.tenantId,
            conversationId: 'kb-rag-eval',
            query,
            documentIdAllowlist: opts.documentIdAllowlist,
            topK: opts.topK,
          },
          {},
        )
      : KILL_SWITCH_OUTCOME;

    const keyword = await keywordCompare(kb, opts, query);
    reports.push(
      shapeQueryEvalReport({
        query,
        vectorEnabledForTenant,
        vectorOutcome,
        keyword,
        minScore: opts.minScore,
      }),
    );
  }

  const summary = {
    event: 'kb_rag_eval',
    tenantId: opts.tenantId,
    env: { matched: guard.ok ? guard.matched : [] },
    vectorContextEnabledForTenant: vectorEnabledForTenant,
    explicitlyDisabled,
    topK: opts.topK,
    minScore: opts.minScore,
    documentIdAllowlist: opts.documentIdAllowlist,
    queryCount: opts.queries.length,
    promptEligibleCount: reports.filter((r) => r.wouldEnterPrompt).length,
    reports,
  };

  if (opts.json) {
    console.log(JSON.stringify(summary));
  } else {
    console.log(JSON.stringify(summary, null, 2));
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      event: 'kb_rag_eval_error',
      reason: 'unhandled_exception',
      message: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exit(1);
});
