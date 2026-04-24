#!/usr/bin/env node
/**
 * Minimal local path to POST /api/v1/handover/resume (tenant-scoped smoke).
 *
 * Uses Supabase service role (same access pattern as the API) — no Prisma client resolution issues under pnpm.
 *
 * From apps/backend (requires .env: DATABASE_URL not required; needs SUPABASE_* and SMOKE_AUTH_*):
 *   node scripts/handover-resume-e2e.mjs
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

const LOC_ID = 'loc-smoke-handover-resume-v1';
const GHL_CONV_ID = 'ghl-conv-smoke-handover-resume-v1';
const CONTACT_ID = 'contact-smoke-handover-resume-v1';

function sbAdmin() {
  const url = process.env['SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function seed() {
  const email = process.env['SMOKE_AUTH_EMAIL'];
  if (!email) {
    throw new Error('Set SMOKE_AUTH_EMAIL in .env');
  }

  const sb = sbAdmin();

  const { data: profile, error: pe } = await sb
    .from('profiles')
    .select('id')
    .eq('email', email)
    .maybeSingle();
  if (pe) throw new Error(`profiles: ${pe.message}`);
  if (!profile) {
    throw new Error(`No profiles row for smoke email ${email}`);
  }

  const { data: agencyUser, error: ae } = await sb
    .from('agency_users')
    .select('agency_id')
    .eq('profile_id', profile.id)
    .maybeSingle();
  if (ae) throw new Error(`agency_users: ${ae.message}`);
  if (!agencyUser) {
    throw new Error(`No agency_users row for profile ${profile.id}`);
  }

  const agencyId = agencyUser.agency_id;

  let { data: tenantRow } = await sb
    .from('tenants')
    .select('id')
    .eq('ghl_location_id', LOC_ID)
    .maybeSingle();

  let tenantId;
  if (!tenantRow) {
    tenantId = randomUUID();
    const now = new Date().toISOString();
    const { error: te } = await sb.from('tenants').insert({
      id: tenantId,
      agency_id: agencyId,
      name: 'Smoke handover resume tenant',
      ghl_location_id: LOC_ID,
      status: 'active',
      created_at: now,
      updated_at: now,
    });
    if (te) throw new Error(`tenants insert: ${te.message}`);
  } else {
    tenantId = tenantRow.id;
  }

  const { data: existingTu } = await sb
    .from('tenant_users')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('profile_id', profile.id)
    .maybeSingle();
  if (!existingTu) {
    const now = new Date().toISOString();
    const { error: tue } = await sb.from('tenant_users').insert({
      id: randomUUID(),
      tenant_id: tenantId,
      profile_id: profile.id,
      role: 'ADMIN',
      created_at: now,
      updated_at: now,
    });
    if (tue) throw new Error(`tenant_users insert: ${tue.message}`);
  }

  let { data: conv } = await sb
    .from('conversations')
    .select('id')
    .eq('ghl_conversation_id', GHL_CONV_ID)
    .maybeSingle();

  let conversationId;
  if (!conv) {
    conversationId = randomUUID();
    const now = new Date().toISOString();
    const { error: ce } = await sb.from('conversations').insert({
      id: conversationId,
      tenant_id: tenantId,
      ghl_conversation_id: GHL_CONV_ID,
      contact_id: CONTACT_ID,
      channel: 'CHAT',
      status: 'HANDOVER',
      last_message_at: now,
      metadata: {},
      created_at: now,
      updated_at: now,
    });
    if (ce) throw new Error(`conversations insert: ${ce.message}`);
  } else {
    conversationId = conv.id;
    const { error: up } = await sb
      .from('conversations')
      .update({
        tenant_id: tenantId,
        status: 'HANDOVER',
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversationId);
    if (up) throw new Error(`conversations update: ${up.message}`);
  }

  await sb.from('handover_events').delete().eq('conversation_id', conversationId);

  const now = new Date().toISOString();
  const { error: he } = await sb.from('handover_events').insert({
    id: randomUUID(),
    conversation_id: conversationId,
    type: 'REQUEST',
    status: 'ACTIVE',
    initiated_by: profile.id,
    note: null,
    created_at: now,
    updated_at: now,
  });
  if (he) throw new Error(`handover_events insert: ${he.message}`);

  return {
    profileId: profile.id,
    tenantId,
    agencyId,
    conversationId,
  };
}

async function verifyHttp(tenantId, conversationId) {
  const supabaseUrl = process.env['SUPABASE_URL'];
  const anonKey = process.env['SUPABASE_ANON_KEY'];
  const email = process.env['SMOKE_AUTH_EMAIL'];
  const password = process.env['SMOKE_AUTH_PASSWORD'];
  const port = process.env['PORT'] || '3001';
  const apiPrefix = (process.env['API_PREFIX'] || 'api/v1').replace(/^\/+|\/+$/g, '');
  const defaultBase = `http://127.0.0.1:${port}/${apiPrefix}`;
  const apiBase = (process.env['SMOKE_API_BASE_URL'] || defaultBase).replace(/\/$/, '');

  if (!supabaseUrl || !anonKey || !email || !password) {
    throw new Error('Missing SUPABASE_URL, SUPABASE_ANON_KEY, SMOKE_AUTH_EMAIL, or SMOKE_AUTH_PASSWORD');
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.session?.access_token) {
    throw new Error(`Supabase sign-in failed: ${error?.message ?? 'no session'}`);
  }

  const token = data.session.access_token;

  const meRes = await fetch(`${apiBase}/auth/me`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  const meBody = await meRes.json().catch(() => ({}));

  const resumeRes = await fetch(`${apiBase}/handover/resume`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ conversationId }),
  });
  const resumeText = await resumeRes.text();
  let resumeBody;
  try {
    resumeBody = JSON.parse(resumeText);
  } catch {
    resumeBody = resumeText;
  }

  return {
    apiBase,
    authMeStatus: meRes.status,
    authMeTenantId: meBody.tenantId,
    expectedTenantId: tenantId,
    resumeStatus: resumeRes.status,
    resumeBody,
  };
}

async function main() {
  const seeded = await seed();
  console.log('Seed OK:', JSON.stringify(seeded, null, 2));

  try {
    const out = await verifyHttp(seeded.tenantId, seeded.conversationId);
    console.log('HTTP verify:', JSON.stringify(out, null, 2));
    if (out.resumeStatus < 200 || out.resumeStatus >= 300) {
      process.exit(2);
    }
    if (out.authMeTenantId && out.authMeTenantId !== seeded.tenantId) {
      console.error('Warning: /auth/me tenantId mismatch');
    }
  } catch (e) {
    console.error('HTTP verify failed:', e.message);
    process.exit(3);
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
