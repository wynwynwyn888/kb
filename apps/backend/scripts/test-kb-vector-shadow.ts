/**
 * Read-only RAG shadow vector-search smoke test.
 *
 * Example:
 *   pnpm --filter @aisbp/backend exec tsx scripts/test-kb-vector-shadow.ts --tenant <tenant-id> --query "pricing"
 *
 * Requires the additive pgvector migration and some embedded chunks.
 */

import { createClient } from '@supabase/supabase-js';
import { safeTextPreviewForLog } from '../src/lib/safe-text-preview-for-log';
import { OpenAiEmbeddingClient } from '../src/modules/kb/embedding/openai-embedding.client';
import {
  resolveOpenAiEmbeddingCredentials,
  type SupabaseLikeClient,
} from '../src/modules/kb/embedding/openai-key.resolver';
import {
  vectorSearchShadow,
  type VectorSearchShadowCandidate,
} from '../src/modules/kb/embedding/kb-vector-search-shadow';
import type { BackfillSupabaseClient } from '../src/modules/kb/embedding/kb-embedding-backfill';

interface CliOptions {
  tenantId: string | null;
  query: string | null;
  documentIdAllowlist: string[] | null;
  limit: number;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    tenantId: null,
    query: null,
    documentIdAllowlist: null,
    limit: 10,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--tenant') {
      opts.tenantId = next ?? null;
      index += 1;
    } else if (arg === '--query') {
      opts.query = next ?? null;
      index += 1;
    } else if (arg === '--document-ids') {
      opts.documentIdAllowlist = (next ?? '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean);
      index += 1;
    } else if (arg === '--limit') {
      opts.limit = parsePositiveInt(next, opts.limit);
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!opts.tenantId) throw new Error('Missing required --tenant <tenant-id>');
  if (!opts.query) throw new Error('Missing required --query <text>');
  return opts;
}

function printHelp(): void {
  console.log([
    'Usage:',
    '  tsx scripts/test-kb-vector-shadow.ts --tenant <tenant-id> --query <text> [options]',
    '',
    'Options:',
    '  --tenant <id>              Tenant to search.',
    '  --query <text>             Query text to embed and search.',
    '  --document-ids <ids>       Optional comma-separated document allowlist.',
    '  --limit <n>                Max vector candidates. Default: 10.',
  ].join('\n'));
}

function createSupabase(): BackfillSupabaseClient {
  const url = process.env['SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  }) as unknown as BackfillSupabaseClient;
}

function formatCandidate(candidate: VectorSearchShadowCandidate, index: number) {
  return {
    rank: index + 1,
    chunkId: candidate.chunkId,
    documentId: candidate.documentId,
    title: candidate.title,
    source: candidate.source,
    vectorScore: Number(candidate.vectorScore.toFixed(6)),
    contentPreview: safeTextPreviewForLog(candidate.content, {
      hashSalt: candidate.chunkId,
    }),
  };
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const supabase = createSupabase();
  const credentials = await resolveOpenAiEmbeddingCredentials(
    supabase as unknown as SupabaseLikeClient,
    opts.tenantId as string,
  );
  if (credentials.ok === false) {
    throw new Error(`OpenAI embedding credentials unavailable: ${credentials.reason}`);
  }

  const client = new OpenAiEmbeddingClient(credentials.credentials);
  const [queryEmbedding] = await client.embedTexts([opts.query as string]);
  const result = await vectorSearchShadow(supabase, {
    tenantId: opts.tenantId as string,
    queryEmbedding: queryEmbedding.embedding,
    documentIdAllowlist: opts.documentIdAllowlist,
    limit: opts.limit,
  });

  if (result.ok === false) {
    throw new Error(`${result.reason}: ${result.message}`);
  }

  console.log(
    JSON.stringify(
      {
        event: 'kb_vector_shadow_test',
        tenantId: opts.tenantId,
        queryPreview: safeTextPreviewForLog(opts.query, { hashSalt: 'query' }),
        count: result.candidates.length,
        candidates: result.candidates.map(formatCandidate),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      event: 'kb_vector_shadow_test_error',
      message: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exit(1);
});
