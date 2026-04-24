#!/usr/bin/env node
/**
 * Verifies Supabase selects used by ConversationOrchestrationService.loadPromptConfig /
 * loadAgencyPolicy match the real tables (no stale column names).
 *
 *   node scripts/orchestration-prompt-schema-check.mjs
 */

import { createClient } from '@supabase/supabase-js';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function applyEnvFile(path, override) {
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

function loadEnv() {
  const cwd = process.cwd();
  applyEnvFile(resolve(cwd, '.env'), false);
  applyEnvFile(resolve(cwd, '..', '.env'), false);
  applyEnvFile(resolve(cwd, 'apps', 'backend', '.env'), true);
  applyEnvFile(resolve(__dirname, '..', '.env'), true);
}

loadEnv();

async function main() {
  const url = process.env['SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }
  const sb = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data: tpc, error: e1 } = await sb
    .from('tenant_prompt_configs')
    .select('id, system_prompt, temperature, model_override, is_active, updated_at')
    .eq('is_active', true)
    .order('updated_at', { ascending: false })
    .limit(1);

  if (e1) {
    console.error('tenant_prompt_configs select failed:', e1.message);
    process.exit(2);
  }
  if (tpc?.length) {
    const row = tpc[0];
    if (typeof row['system_prompt'] !== 'string') {
      console.error('tenant row missing system_prompt');
      process.exit(3);
    }
    console.log('OK tenant_prompt_configs row shape (1 row sampled)');
  } else {
    console.log('SKIP no active tenant_prompt_configs rows');
  }

  const { data: asp, error: e2 } = await sb
    .from('agency_system_policies')
    .select('id, name, content, priority, is_default')
    .order('priority', { ascending: false })
    .limit(1);

  if (e2) {
    console.error('agency_system_policies select failed:', e2.message);
    process.exit(2);
  }
  if (asp?.length) {
    const row = asp[0];
    if (typeof row['content'] !== 'string') {
      console.error('agency row missing content');
      process.exit(4);
    }
    console.log('OK agency_system_policies row shape (1 row sampled)');
  } else {
    console.log('SKIP no agency_system_policies rows');
  }

  console.log('orchestration prompt/policy schema check passed');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
