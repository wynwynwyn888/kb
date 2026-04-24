#!/usr/bin/env node
/**
 * Smoke: POST /quotas/check only (QuotasService.checkQuota).
 *
 *   node scripts/quotas-http-smoke.mjs
 *   SMOKE_API_BASE_URL=http://127.0.0.1:3025/api/v1 node scripts/quotas-http-smoke.mjs
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
  const serviceKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  const anonKey = process.env['SUPABASE_ANON_KEY'];
  const email = process.env['SMOKE_AUTH_EMAIL'];
  const password = process.env['SMOKE_AUTH_PASSWORD'];
  const port = process.env['PORT'] || '3001';
  const apiPrefix = (process.env['API_PREFIX'] || 'api/v1').replace(/^\/+|\/+$/g, '');
  const defaultBase = `http://127.0.0.1:${port}/${apiPrefix}`;
  const apiBase = (process.env['SMOKE_API_BASE_URL'] || defaultBase).replace(/\/$/, '');

  if (!url || !serviceKey || !anonKey || !email || !password) {
    console.error('Missing Supabase or smoke env vars');
    process.exit(1);
  }

  const sbAdmin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: profile } = await sbAdmin
    .from('profiles')
    .select('id')
    .eq('email', email)
    .maybeSingle();
  if (!profile) {
    console.error('No profile for SMOKE_AUTH_EMAIL');
    process.exit(2);
  }
  const { data: tu } = await sbAdmin
    .from('tenant_users')
    .select('tenant_id')
    .eq('profile_id', profile.id)
    .maybeSingle();
  if (!tu) {
    console.error('No tenant_users row (need seeded tenant for smoke user)');
    process.exit(3);
  }
  const tenantId = tu.tenant_id;

  const supabase = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.session?.access_token) {
    console.error('Sign-in failed:', error?.message);
    process.exit(4);
  }

  const token = data.session.access_token;
  const checkRes = await fetch(`${apiBase}/quotas/check`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ tenantId, amount: 1 }),
  });
  const checkBody = await checkRes.json().catch(() => ({}));

  console.log(
    JSON.stringify(
      { tenantId, check: { status: checkRes.status, body: checkBody } },
      null,
      2,
    ),
  );

  if (checkRes.status < 200 || checkRes.status >= 300) {
    process.exit(5);
  }
  if (checkBody.allowed === undefined) {
    console.error('Expected allowed field');
    process.exit(6);
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
