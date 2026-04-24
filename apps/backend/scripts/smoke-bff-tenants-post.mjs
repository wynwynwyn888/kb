#!/usr/bin/env node
/**
 * One-off: sign in via Supabase, POST /api/v1/tenants through Next BFF on :3000 (same-origin path the browser uses).
 * Run from apps/backend with SMOKE_AUTH_* in env (see smoke-auth.mjs).
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

applyEnvFile(resolve(process.cwd(), '.env'), false);
applyEnvFile(resolve(process.cwd(), '..', '.env'), false);
applyEnvFile(resolve(__dirname, '..', '.env'), true);

const supabaseUrl = process.env['SUPABASE_URL'];
const anonKey = process.env['SUPABASE_ANON_KEY'];
const email = process.env['SMOKE_AUTH_EMAIL'];
const password = process.env['SMOKE_AUTH_PASSWORD'];
const bff = (process.env['SMOKE_BFF_BASE'] || 'http://127.0.0.1:3000').replace(/\/$/, '');

if (!supabaseUrl || !anonKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');
  process.exit(1);
}
if (!email || !password) {
  console.error('Set SMOKE_AUTH_EMAIL and SMOKE_AUTH_PASSWORD');
  process.exit(2);
}

const supabase = createClient(supabaseUrl, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data, error } = await supabase.auth.signInWithPassword({ email, password });
if (error || !data.session?.access_token) {
  console.error('Supabase sign-in failed:', error?.message ?? 'no session');
  process.exit(3);
}

const token = data.session.access_token;
const meRes = await fetch(`${bff}/api/v1/auth/me`, {
  headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
});
const me = await meRes.json();
const agencyId = me?.agencyId;
if (!agencyId) {
  console.error('No agencyId on /auth/me:', meRes.status, me);
  process.exit(4);
}

const name = `Smoke BFF ${Date.now()}`;
const postUrl = `${bff}/api/v1/tenants`;
const res = await fetch(postUrl, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
  body: JSON.stringify({ agencyId, name }),
});
const text = await res.text();
let body;
try {
  body = JSON.parse(text);
} catch {
  body = text;
}

console.log('Request URL:', postUrl);
console.log('Response status:', res.status);
console.log('Response body:', typeof body === 'string' ? body.slice(0, 800) : JSON.stringify(body, null, 2).slice(0, 800));

if (res.status >= 200 && res.status < 300) {
  console.log('OK: create subaccount via BFF succeeded');
  process.exit(0);
}
process.exit(5);
