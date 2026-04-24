#!/usr/bin/env node
/**
 * Minimal verification for wired KB HTTP routes (service-role seed + JWT calls).
 *
 * From apps/backend with API running on PORT and .env loaded:
 *   node scripts/kb-http-smoke.mjs
 */

import { createClient } from '@supabase/supabase-js';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

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

async function seedKbRow(sbAdmin, tenantId) {
  const docId = randomUUID();
  const now = new Date().toISOString();
  const content =
    'KB smoke: refund requests are accepted within thirty days of purchase.';

  const { error: de } = await sbAdmin.from('knowledge_documents').insert({
    id: docId,
    tenant_id: tenantId,
    title: 'KB HTTP Smoke FAQ',
    source: 'smoke',
    mime_type: 'text/plain',
    size: content.length,
    status: 'READY',
    metadata: {},
    created_at: now,
    updated_at: now,
  });
  if (de) throw new Error(`knowledge_documents: ${de.message}`);

  const { error: ce } = await sbAdmin.from('knowledge_chunks').insert({
    id: randomUUID(),
    document_id: docId,
    content,
    token_count: Math.ceil(content.length / 4),
    metadata: { smoke: true },
    created_at: now,
  });
  if (ce) throw new Error(`knowledge_chunks: ${ce.message}`);

  return docId;
}

async function main() {
  const url = process.env['SUPABASE_URL'];
  const serviceKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  const anonKey = process.env['SUPABASE_ANON_KEY'];
  const email = process.env['SMOKE_AUTH_EMAIL'];
  const password = process.env['SMOKE_AUTH_PASSWORD'];
  const port = process.env['PORT'] || '3001';
  const apiPrefix = (process.env['API_PREFIX'] || 'api/v1').replace(/^\/+|\/+$/g, '');
  const defaultBase = `http://127.0.0.1:${port}/${apiPrefix}`;
  const apiBase = (process.env['SMOKE_API_BASE_URL'] || defaultBase).replace(/\/$/, '');

  if (!url || !serviceKey || !anonKey || !email || !password) {
    console.error('Need SUPABASE_*, SMOKE_AUTH_EMAIL, SMOKE_AUTH_PASSWORD');
    process.exit(1);
  }

  const sbAdmin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: profile, error: pe } = await sbAdmin
    .from('profiles')
    .select('id')
    .eq('email', email)
    .maybeSingle();
  if (pe || !profile) {
    console.error('No profile for SMOKE_AUTH_EMAIL');
    process.exit(2);
  }

  const { data: tu, error: te } = await sbAdmin
    .from('tenant_users')
    .select('tenant_id')
    .eq('profile_id', profile.id)
    .maybeSingle();
  if (te || !tu) {
    console.error('No tenant_users row for smoke user (seed tenant first)');
    process.exit(3);
  }

  const tenantId = tu.tenant_id;
  const documentId = await seedKbRow(sbAdmin, tenantId);

  const supabase = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: session, error: se } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (se || !session.session?.access_token) {
    console.error('Sign-in failed:', se?.message);
    process.exit(4);
  }
  const token = session.session.access_token;
  const auth = { Authorization: `Bearer ${token}`, Accept: 'application/json' };

  const listRes = await fetch(`${apiBase}/kb/documents/${tenantId}`, { headers: auth });
  const listText = await listRes.text();

  const searchRes = await fetch(`${apiBase}/kb/search`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tenantId,
      query: 'refund thirty days',
      topK: 5,
    }),
  });
  const searchText = await searchRes.text();

  const chunksUrl = `${apiBase}/kb/chunks/${encodeURIComponent(documentId)}?tenantId=${encodeURIComponent(tenantId)}`;
  const chunksRes = await fetch(chunksUrl, { headers: auth });
  const chunksText = await chunksRes.text();

  console.log(JSON.stringify({
    tenantId,
    documentId,
    list: { status: listRes.status, body: tryJson(listText) },
    search: { status: searchRes.status, body: tryJson(searchText) },
    chunks: { status: chunksRes.status, body: tryJson(chunksText) },
  }, null, 2));

  if ([listRes.status, searchRes.status, chunksRes.status].some(s => s < 200 || s >= 300)) {
    process.exit(5);
  }
}

function tryJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
