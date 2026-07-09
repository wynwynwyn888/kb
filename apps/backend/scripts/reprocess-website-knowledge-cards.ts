/**
 * Rebuild website imports into structured website knowledge cards.
 *
 * Example:
 *   pnpm --filter @aisbp/backend exec tsx scripts/reprocess-website-knowledge-cards.ts --tenant <tenant-id>
 *
 * Production guard:
 *   Production-like envs require KB_WEBSITE_CARD_REPROCESS_ALLOW=YES_RUN_WEBSITE_CARD_REPROCESS.
 */

import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { KB_RICH_TEXT_SOURCE_METADATA_KEY } from '../src/lib/kb-rich-text-source';
import {
  buildWebsiteKnowledgeCards,
  websiteKnowledgeCardToChunkSpec,
  WEBSITE_KNOWLEDGE_CARD_VERSION,
} from '../src/lib/website-knowledge-cards';

const ALLOW_PROD_VALUE = 'YES_RUN_WEBSITE_CARD_REPROCESS';

interface CliOptions {
  tenantId: string | null;
  allTenants: boolean;
  dryRun: boolean;
  limit: number;
}

type SupabaseClientLike = ReturnType<typeof createClient>;

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    tenantId: null,
    allTenants: false,
    dryRun: false,
    limit: 100,
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
  if (!opts.tenantId && !opts.allTenants) throw new Error('Missing required --tenant <tenant-id> or --all-tenants');
  if (opts.tenantId && opts.allTenants) throw new Error('Use either --tenant or --all-tenants, not both');
  return opts;
}

function printHelp(): void {
  console.log([
    'Usage:',
    '  tsx scripts/reprocess-website-knowledge-cards.ts --tenant <tenant-id> [options]',
    '',
    'Options:',
    '  --tenant <id>     Tenant to reprocess.',
    '  --all-tenants     Non-production only.',
    '  --limit <n>       Max website documents. Default: 100.',
    '  --dry-run         Report counts without replacing chunks.',
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
  if (opts.allTenants) throw new Error('--all-tenants is not allowed in production-like environments');
  if (process.env['KB_WEBSITE_CARD_REPROCESS_ALLOW'] !== ALLOW_PROD_VALUE) {
    throw new Error(`Production-like reprocess requires KB_WEBSITE_CARD_REPROCESS_ALLOW=${ALLOW_PROD_VALUE}`);
  }
}

function createSupabase(): SupabaseClientLike {
  const url = process.env['SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function sourceTextFromMetadata(metadata: unknown): string {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return '';
  const m = metadata as Record<string, unknown>;
  const raw = m[KB_RICH_TEXT_SOURCE_METADATA_KEY];
  if (typeof raw !== 'string') return '';
  return raw.replace(/^Source URL:\s*\S+\s*/i, '').trim();
}

async function loadWebsiteDocuments(supabase: SupabaseClientLike, opts: CliOptions): Promise<Array<Record<string, unknown>>> {
  let query = supabase
    .from('knowledge_documents')
    .select('id, tenant_id, title, source, size, metadata, created_at, updated_at')
    .eq('source', 'website')
    .limit(opts.limit);
  if (opts.tenantId) query = query.eq('tenant_id', opts.tenantId);
  const res = await query;
  if (res.error) throw new Error(`Failed to load website documents: ${res.error.message}`);
  return Array.isArray(res.data) ? (res.data as Array<Record<string, unknown>>) : [];
}

async function reprocessOne(supabase: SupabaseClientLike, row: Record<string, unknown>, dryRun: boolean): Promise<void> {
  const id = String(row['id'] ?? '');
  const tenantId = String(row['tenant_id'] ?? '');
  const title = String(row['title'] ?? 'Website page');
  const metadata = row['metadata'] && typeof row['metadata'] === 'object' && !Array.isArray(row['metadata'])
    ? (row['metadata'] as Record<string, unknown>)
    : {};
  const sourceUrl = typeof metadata['sourceUrl'] === 'string' ? metadata['sourceUrl'] : title;
  const rawText = sourceTextFromMetadata(metadata);
  if (!id || !tenantId || !rawText) {
    console.log(`skip ${id || '(unknown)'}: missing raw website source`);
    return;
  }

  const now = new Date().toISOString();
  const build = buildWebsiteKnowledgeCards({
    sourceUrl,
    pageTitle: title,
    text: rawText,
    lastCrawledAt: now,
  });
  console.log(`${dryRun ? 'would reprocess' : 'reprocess'} ${id}: ${build.cards.length} approved, ${build.rejected.length} rejected`);
  if (dryRun) return;
  if (build.cards.length === 0) return;

  const specs = build.cards.map((card, index) => {
    const spec = websiteKnowledgeCardToChunkSpec(card);
    spec.metadata['sectionIndex'] = index;
    return spec;
  });
  const deleteRes = await supabase.from('knowledge_chunks').delete().eq('document_id', id);
  if (deleteRes.error) throw new Error(`Failed to delete old chunks for ${id}: ${deleteRes.error.message}`);
  const insertRes = await supabase.from('knowledge_chunks').insert(specs.map((spec) => ({
    id: randomUUID(),
    document_id: id,
    content: spec.content,
    token_count: spec.tokenCount,
    metadata: { ...spec.metadata, kind: 'website' },
    embedding_status: 'pending',
  })));
  if (insertRes.error) throw new Error(`Failed to insert card chunks for ${id}: ${insertRes.error.message}`);

  const updateRes = await supabase
    .from('knowledge_documents')
    .update({
      status: 'READY',
      metadata: {
        ...metadata,
        ragIngestion: 'website_knowledge_cards',
        websiteCardVersion: WEBSITE_KNOWLEDGE_CARD_VERSION,
        deprecatedRawChunksAt: now,
        websiteCardGeneration: {
          approved: specs.length,
          rejected: build.rejected,
          cleanedLineCount: build.cleanedLineCount,
          reprocessedAt: now,
        },
      },
      updated_at: now,
    })
    .eq('id', id)
    .eq('tenant_id', tenantId);
  if (updateRes.error) throw new Error(`Failed to update document ${id}: ${updateRes.error.message}`);
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  assertRunAllowed(opts);
  const supabase = createSupabase();
  const rows = await loadWebsiteDocuments(supabase, opts);
  console.log(`loaded ${rows.length} website document(s)`);
  for (const row of rows) {
    await reprocessOne(supabase, row, opts.dryRun);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
