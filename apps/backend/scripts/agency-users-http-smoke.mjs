#!/usr/bin/env node
/**
 * Smoke: agency-users list + duplicate POST (expects GET 200, POST 409 Conflict).
 *
 *   node scripts/agency-users-http-smoke.mjs
 *   SMOKE_API_BASE_URL=http://127.0.0.1:3027/api/v1 node scripts/agency-users-http-smoke.mjs
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
  // If caller sets host:port only, still hit Nest global prefix (default api/v1).
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
  const { data: au } = await sbAdmin
    .from('agency_users')
    .select('agency_id, id, role')
    .eq('profile_id', profile.id)
    .maybeSingle();
  if (!au) {
    console.error('No agency_users row for smoke user');
    process.exit(3);
  }
  const agencyId = au.agency_id;

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

  const listUrl = `${apiBase}/agency-users?agencyId=${encodeURIComponent(agencyId)}`;
  const listRes = await fetch(listUrl, { headers: auth });
  const listBody = await listRes.json().catch(() => []);

  const postRes = await fetch(`${apiBase}/agency-users`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agencyId,
      profileId: profile.id,
      role: 'MEMBER',
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
        agencyId,
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

  const canManage = au.role === 'OWNER' || au.role === 'ADMIN';
  if (canManage && postRes.status !== 409) {
    console.error('Expected 409 Conflict when re-adding same member (as OWNER/ADMIN)');
    process.exit(7);
  }
  if (!canManage && postRes.status !== 403) {
    console.error('Expected 403 Forbidden when smoke user is not OWNER/ADMIN');
    process.exit(8);
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
