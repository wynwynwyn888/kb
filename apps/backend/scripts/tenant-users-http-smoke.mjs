#!/usr/bin/env node
/**
 * Smoke: tenant-users list + duplicate POST (GET 200; POST 409 if ADMIN, else 403).
 *
 *   node scripts/tenant-users-http-smoke.mjs
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
  let apiBase = (process.env['SMOKE_API_BASE_URL'] || defaultBase).replace(/\/$/, '');
  if (
    process.env['SMOKE_API_BASE_URL'] &&
    !/\/api\/v\d+(\/|$)/i.test(apiBase)
  ) {
    apiBase = `${apiBase}/${apiPrefix}`.replace(/([^:]\/)\/+/g, '$1');
  }

  if (!url || !serviceKey || !anonKey || !email || !password) {
    console.error('Missing env vars');
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
    console.error('No profile for smoke email');
    process.exit(2);
  }

  const { data: tu, error: tuErr } = await sbAdmin
    .from('tenant_users')
    .select('tenant_id, id, role')
    .eq('profile_id', profile.id)
    .maybeSingle();

  if (tuErr) {
    console.error('tenant_users lookup failed:', tuErr.message);
    process.exit(3);
  }
  if (!tu) {
    console.error('No tenant_users row for smoke user (need at least one tenant membership)');
    process.exit(3);
  }

  const tenantId = tu.tenant_id;

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

  const listUrl = `${apiBase}/tenant-users?tenantId=${encodeURIComponent(tenantId)}`;
  const listRes = await fetch(listUrl, { headers: auth });
  const listBody = await listRes.json().catch(() => []);

  const postRes = await fetch(`${apiBase}/tenant-users`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tenantId,
      profileId: profile.id,
      role: 'VIEWER',
    }),
  });
  const postText = await postRes.text();
  let postBody;
  try {
    postBody = JSON.parse(postText);
  } catch {
    postBody = postText;
  }

  console.log(
    JSON.stringify(
      {
        tenantId,
        list: { status: listRes.status, count: Array.isArray(listBody) ? listBody.length : null },
        duplicatePost: { status: postRes.status, body: postBody },
      },
      null,
      2,
    ),
  );

  if (listRes.status < 200 || listRes.status >= 300) {
    process.exit(5);
  }
  if (!Array.isArray(listBody) || listBody.length < 1) {
    process.exit(6);
  }

  const canManage = tu.role === 'ADMIN';
  if (canManage && postRes.status !== 409) {
    console.error('Expected 409 Conflict when re-adding same member (as ADMIN)');
    process.exit(7);
  }
  if (!canManage && postRes.status !== 403) {
    console.error('Expected 403 Forbidden when smoke user is not tenant ADMIN');
    process.exit(8);
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
