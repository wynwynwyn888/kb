// Pure, side-effect-free helpers for the staging-only RAG context evaluation
// harness (`scripts/evaluate-kb-rag-context.ts`).
//
// SAFETY CONTRACT:
// - No I/O, no process.env reads, no secrets. All inputs are passed explicitly
//   so these helpers are deterministic and unit-testable.
// - Output shaping NEVER includes raw chunk content or secrets — only ids,
//   scores, retrieval modes, and a safe query preview/hash.

import { safeTextPreviewForLog } from '../../../lib/safe-text-preview-for-log';
import type { KbVectorContextOutcome } from './kb-vector-context.runner';

/** Tenant that is allowed to fall back to the built-in safe question set. */
export const SAFE_DEFAULT_TENANT = 'stg-rag-tenant';

/**
 * Small, generic, non-sensitive question set used only for the staging test
 * tenant when no `--query` is supplied. These are deliberately harmless.
 */
export const DEFAULT_SAFE_QUERIES: readonly string[] = [
  'What are your business hours?',
  'How much do your services cost?',
  'Where are you located?',
  'How can I contact support?',
  'What services do you offer?',
] as const;

export interface EnvSnapshot {
  NODE_ENV?: string | undefined;
  APP_ENV?: string | undefined;
  RAILWAY_ENVIRONMENT?: string | undefined;
  VERCEL_ENV?: string | undefined;
}

export type EnvGuardResult =
  | { ok: true; matched: string[] }
  | { ok: false; reason: 'production_like_env_refused' | 'staging_env_required' };

/**
 * Refuse production-like envs and require a staging-like signal. Mirrors the
 * runner's staging gate but is exported and pure for testing.
 */
export function resolveStagingEnvGuard(env: EnvSnapshot): EnvGuardResult {
  const values = [env.NODE_ENV, env.APP_ENV, env.RAILWAY_ENVIRONMENT, env.VERCEL_ENV]
    .map((v) => String(v ?? '').trim().toLowerCase())
    .filter(Boolean);

  if (values.some((v) => v.includes('prod'))) {
    return { ok: false, reason: 'production_like_env_refused' };
  }
  const matched = values.filter((v) => v.includes('staging') || v.includes('stage'));
  if (matched.length === 0) {
    return { ok: false, reason: 'staging_env_required' };
  }
  return { ok: true, matched };
}

export interface EvalCliOptions {
  tenantId: string;
  queries: string[];
  documentIdAllowlist: string[] | null;
  topK: number;
  minScore: number | null;
  json: boolean;
  killSwitchCheck: boolean;
}

export const DEFAULT_TOP_K = 5;

function requireFlagValue(flag: string, value: string | undefined): string {
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function parsePositiveInt(flag: string, value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${flag}: expected a positive integer`);
  }
  return Math.min(50, Math.floor(parsed));
}

function parseUnitFloat(flag: string, value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ${flag}: expected a number between 0 and 1`);
  }
  return Math.max(0, Math.min(1, parsed));
}

/**
 * Parse CLI argv (already sliced past `node script`). Throws on invalid input.
 * Applies the built-in safe question set ONLY for {@link SAFE_DEFAULT_TENANT}
 * when no `--query` is provided.
 */
export function parseEvalArgs(argv: string[]): EvalCliOptions {
  const opts: EvalCliOptions = {
    tenantId: '',
    queries: [],
    documentIdAllowlist: null,
    topK: DEFAULT_TOP_K,
    minScore: null,
    json: false,
    killSwitchCheck: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    switch (arg) {
      case '--tenant':
        opts.tenantId = requireFlagValue(arg, next).trim();
        index += 1;
        break;
      case '--query':
        opts.queries.push(requireFlagValue(arg, next).trim());
        index += 1;
        break;
      case '--document-ids':
        opts.documentIdAllowlist = requireFlagValue(arg, next)
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean);
        index += 1;
        break;
      case '--limit':
      case '--topK':
      case '--top-k':
        opts.topK = parsePositiveInt(arg, requireFlagValue(arg, next), opts.topK);
        index += 1;
        break;
      case '--min-score':
        opts.minScore = parseUnitFloat(arg, requireFlagValue(arg, next));
        index += 1;
        break;
      case '--json':
        opts.json = true;
        break;
      case '--kill-switch-check':
      case '--check':
        opts.killSwitchCheck = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!opts.tenantId) throw new Error('Missing required --tenant <tenant-id>');

  if (opts.queries.length === 0) {
    if (opts.tenantId === SAFE_DEFAULT_TENANT) {
      opts.queries = [...DEFAULT_SAFE_QUERIES];
    } else {
      throw new Error(
        `Missing --query. The built-in safe question set is only available for tenant "${SAFE_DEFAULT_TENANT}".`,
      );
    }
  }

  return opts;
}

/** Merge a tenant id into an existing comma-separated allowlist (dedup, ordered). */
export function mergeTenantIntoAllowlist(existing: string | undefined, tenantId: string): string {
  const ids = String(existing ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!ids.includes(tenantId)) ids.push(tenantId);
  return ids.join(',');
}

interface MinimalChunk {
  chunkId: string;
  documentId: string;
  relevanceScore: number;
}

export interface KeywordComparison {
  retrievalMode: 'keyword' | 'vector' | 'hybrid';
  totalConsidered: number;
  chunks: MinimalChunk[];
}

export interface ShapeQueryEvalInput {
  query: string;
  vectorEnabledForTenant: boolean;
  vectorOutcome: KbVectorContextOutcome;
  keyword: KeywordComparison | null;
  minScore: number | null;
}

function round(value: number): number {
  return Number(value.toFixed(6));
}

/**
 * Shape a single query result into a SAFE report object. Never includes raw
 * chunk content — only ids, scores, modes, previews, and fallback reasons.
 */
export function shapeQueryEvalReport(input: ShapeQueryEvalInput) {
  const { vectorOutcome, vectorEnabledForTenant } = input;

  const vector = vectorOutcome.ok
    ? {
        ok: true as const,
        retrievalMode: vectorOutcome.result.retrievalMode,
        chunkIds: vectorOutcome.result.chunks.map((c) => c.chunkId),
        documentIds: [...new Set(vectorOutcome.result.chunks.map((c) => c.documentId))],
        scores: vectorOutcome.result.chunks.map((c) => round(c.relevanceScore)),
        totalConsidered: vectorOutcome.result.totalConsidered,
      }
    : { ok: false as const, fallbackReason: vectorOutcome.reason };

  const keyword = input.keyword
    ? {
        retrievalMode: input.keyword.retrievalMode,
        chunkIds: input.keyword.chunks.map((c) => c.chunkId),
        documentIds: [...new Set(input.keyword.chunks.map((c) => c.documentId))],
        scores: input.keyword.chunks.map((c) => round(c.relevanceScore)),
        totalConsidered: input.keyword.totalConsidered,
      }
    : null;

  const vectorChunkIds = new Set(vector.ok ? vector.chunkIds : []);
  const overlapChunkIds = keyword
    ? keyword.chunkIds.filter((id) => vectorChunkIds.has(id))
    : [];

  const wouldEnterPrompt = vectorEnabledForTenant && vectorOutcome.ok;

  return {
    queryPreview: safeTextPreviewForLog(input.query, { hashSalt: 'kbRagEvalQuery' }),
    minScore: input.minScore,
    vectorEnabledForTenant,
    retrievalMode: vector.ok ? vector.retrievalMode : (keyword?.retrievalMode ?? 'keyword'),
    vectorFallbackReason: vectorOutcome.ok ? null : vectorOutcome.reason,
    wouldEnterPrompt,
    vector,
    keyword,
    overlap: { chunkIds: overlapChunkIds, count: overlapChunkIds.length },
  };
}
