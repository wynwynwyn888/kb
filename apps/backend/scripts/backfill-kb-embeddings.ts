/**
 * Staging/local RAG shadow-lane embedding backfill.
 *
 * Example:
 *   pnpm --filter @aisbp/backend exec tsx scripts/backfill-kb-embeddings.ts --tenant <tenant-id> --limit 100
 *
 * Production guard:
 *   Production-like envs require KB_EMBEDDING_BACKFILL_ALLOW=YES_RUN_KB_EMBEDDING_BACKFILL.
 */

import { createClient } from '@supabase/supabase-js';
import {
  runKbEmbeddingBackfill,
  type BackfillEmbeddingStatus,
  type BackfillSupabaseClient,
} from '../src/modules/kb/embedding/kb-embedding-backfill';

interface CliOptions {
  tenantId: string | null;
  allTenants: boolean;
  dryRun: boolean;
  statuses: BackfillEmbeddingStatus[];
  limit: number;
  batchSize: number;
  delayMs: number;
}

const ALLOW_PROD_VALUE = 'YES_RUN_KB_EMBEDDING_BACKFILL';

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function parseStatuses(value: string | undefined): BackfillEmbeddingStatus[] {
  if (!value) return ['pending'];
  const statuses = value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const valid = new Set(['pending', 'failed', 'skipped']);
  for (const status of statuses) {
    if (!valid.has(status)) {
      throw new Error(`Invalid --status value: ${status}`);
    }
  }
  return statuses as BackfillEmbeddingStatus[];
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    tenantId: null,
    allTenants: false,
    dryRun: false,
    statuses: ['pending'],
    limit: 100,
    batchSize: 32,
    delayMs: 250,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--tenant') {
      opts.tenantId = next ?? null;
      index += 1;
    } else if (arg === '--all-tenants') {
      opts.allTenants = true;
    } else if (arg === '--dry-run') {
      opts.dryRun = true;
    } else if (arg === '--status') {
      opts.statuses = parseStatuses(next);
      index += 1;
    } else if (arg === '--limit') {
      opts.limit = parsePositiveInt(next, opts.limit);
      index += 1;
    } else if (arg === '--batch-size') {
      opts.batchSize = parsePositiveInt(next, opts.batchSize);
      index += 1;
    } else if (arg === '--delay-ms') {
      opts.delayMs = parsePositiveInt(next, opts.delayMs);
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!opts.tenantId && !opts.allTenants) {
    throw new Error('Missing required --tenant <tenant-id> or --all-tenants');
  }
  if (opts.tenantId && opts.allTenants) {
    throw new Error('Use either --tenant or --all-tenants, not both');
  }
  return opts;
}

function printHelp(): void {
  console.log([
    'Usage:',
    '  tsx scripts/backfill-kb-embeddings.ts --tenant <tenant-id> [options]',
    '',
    'Options:',
    '  --tenant <id>           Tenant to backfill.',
    '  --all-tenants           Non-production only.',
    '  --status <list>         pending, failed, skipped. Default: pending.',
    '  --limit <n>             Max chunks per tenant. Default: 100.',
    '  --batch-size <n>        Embedding request batch size. Default: 32.',
    '  --delay-ms <n>          Delay between batches. Default: 250.',
    '  --dry-run               Count eligible chunks without embedding/writing.',
  ].join('\n'));
}

function isProductionLikeEnv(): boolean {
  const values = [
    process.env['NODE_ENV'],
    process.env['APP_ENV'],
    process.env['RAILWAY_ENVIRONMENT'],
    process.env['VERCEL_ENV'],
  ]
    .map((v) => String(v ?? '').trim().toLowerCase())
    .filter(Boolean);
  return values.some((v) => v === 'production' || v === 'prod');
}

function assertRunAllowed(opts: CliOptions): void {
  if (!isProductionLikeEnv()) return;
  if (opts.allTenants) {
    throw new Error('--all-tenants is not allowed in production-like environments');
  }
  if (process.env['KB_EMBEDDING_BACKFILL_ALLOW'] !== ALLOW_PROD_VALUE) {
    throw new Error(
      `Production-like backfill requires KB_EMBEDDING_BACKFILL_ALLOW=${ALLOW_PROD_VALUE}`,
    );
  }
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

async function loadTenantIds(supabase: BackfillSupabaseClient): Promise<string[]> {
  const res = await supabase.from('tenants').select('id').limit(10000);
  if (res.error) throw new Error(`Failed to load tenants: ${String(res.error)}`);
  const rows = Array.isArray(res.data) ? res.data : [];
  return rows
    .map((row) => (row as { id?: unknown }).id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  assertRunAllowed(opts);
  const supabase = createSupabase();
  const tenantIds = opts.allTenants ? await loadTenantIds(supabase) : [opts.tenantId as string];

  console.log(
    JSON.stringify({
      event: 'kb_embedding_backfill_start',
      tenants: tenantIds.length,
      dryRun: opts.dryRun,
      statuses: opts.statuses,
      limit: opts.limit,
      batchSize: opts.batchSize,
      delayMs: opts.delayMs,
    }),
  );

  for (const tenantId of tenantIds) {
    const summary = await runKbEmbeddingBackfill(supabase, {
      tenantId,
      statuses: opts.statuses,
      limit: opts.limit,
      batchSize: opts.batchSize,
      dryRun: opts.dryRun,
      delayMs: opts.delayMs,
    });
    console.log(JSON.stringify({ event: 'kb_embedding_backfill_tenant', ...summary }));
    if (!summary.ok) process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      event: 'kb_embedding_backfill_error',
      message: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exit(1);
});
