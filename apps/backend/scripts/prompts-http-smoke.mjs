#!/usr/bin/env node
/**
 * Smoke: prompts tenant list + upsert + agency policy list + upsert (or 403 if not admin).
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
  if (process.env['SMOKE_API_BASE_URL'] && !/\/api\/v\d+(\/|$)/i.test(apiBase)) {
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
    .select('tenant_id')
    .eq('profile_id', profile.id)
    .maybeSingle();
  if (tuErr || !tu) {
    console.error('No tenant_users row for smoke user');
    process.exit(3);
  }
  const tenantId = tu.tenant_id;

  const { data: tenant } = await sbAdmin
    .from('tenants')
    .select('agency_id')
    .eq('id', tenantId)
    .maybeSingle();
  if (!tenant) {
    console.error('Tenant row missing');
    process.exit(3);
  }
  const agencyId = tenant.agency_id;

  const { data: au } = await sbAdmin
    .from('agency_users')
    .select('role')
    .eq('profile_id', profile.id)
    .eq('agency_id', agencyId)
    .maybeSingle();

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
  const json = { 'Content-Type': 'application/json' };

  const listTenantRes = await fetch(
    `${apiBase}/prompts/tenant/${encodeURIComponent(tenantId)}`,
    { headers: auth },
  );
  const listTenantBody = await listTenantRes.json().catch(() => null);

  const smokeName = '_smoke_prompt_' + Date.now();
  const upsertTenantRes = await fetch(`${apiBase}/prompts/tenant`, {
    method: 'POST',
    headers: { ...auth, ...json },
    body: JSON.stringify({
      tenantId,
      name: smokeName,
      systemPrompt: 'Smoke system prompt',
      temperature: 0.5,
      isActive: true,
    }),
  });
  const upsertTenantText = await upsertTenantRes.text();
  let upsertTenantBody;
  try {
    upsertTenantBody = JSON.parse(upsertTenantText);
  } catch {
    upsertTenantBody = upsertTenantText;
  }

  const listPolicyRes = await fetch(
    `${apiBase}/prompts/policy/${encodeURIComponent(agencyId)}`,
    { headers: auth },
  );
  const listPolicyBody = await listPolicyRes.json().catch(() => null);

  const policyName = '_smoke_policy_' + Date.now();
  const upsertPolicyRes = await fetch(`${apiBase}/prompts/policy`, {
    method: 'POST',
    headers: { ...auth, ...json },
    body: JSON.stringify({
      agencyId,
      name: policyName,
      content: 'Smoke policy content',
      priority: 1,
      isDefault: false,
    }),
  });
  const upsertPolicyText = await upsertPolicyRes.text();
  let upsertPolicyBody;
  try {
    upsertPolicyBody = JSON.parse(upsertPolicyText);
  } catch {
    upsertPolicyBody = upsertPolicyText;
  }

  const agencyAdmin = au && (au.role === 'OWNER' || au.role === 'ADMIN');

  console.log(
    JSON.stringify(
      {
        tenantId,
        agencyId,
        listTenant: { status: listTenantRes.status, body: listTenantBody },
        upsertTenant: { status: upsertTenantRes.status, body: upsertTenantBody },
        listPolicy: { status: listPolicyRes.status, count: Array.isArray(listPolicyBody) ? listPolicyBody.length : null },
        upsertPolicy: { status: upsertPolicyRes.status, body: upsertPolicyBody },
      },
      null,
      2,
    ),
  );

  if (listTenantRes.status < 200 || listTenantRes.status >= 300) {
    process.exit(5);
  }
  if (!Array.isArray(listTenantBody)) {
    process.exit(6);
  }

  if (upsertTenantRes.status < 200 || upsertTenantRes.status >= 300) {
    process.exit(7);
  }

  if (listPolicyRes.status < 200 || listPolicyRes.status >= 300) {
    process.exit(8);
  }
  if (!Array.isArray(listPolicyBody)) {
    process.exit(9);
  }

  if (agencyAdmin) {
    if (upsertPolicyRes.status < 200 || upsertPolicyRes.status >= 300) {
      process.exit(10);
    }
  } else if (upsertPolicyRes.status !== 403) {
    console.error('Expected 403 for non-agency-admin policy upsert');
    process.exit(11);
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
