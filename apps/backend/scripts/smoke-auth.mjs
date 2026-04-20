#!/usr/bin/env node
/**
 * DEV ONLY: Sign in with Supabase (anon key) and hit protected API routes.
 * Does not print tokens. Requires backend running separately.
 *
 * Usage (from apps/backend): npm run smoke:auth
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
  // When invoked as `node apps/backend/scripts/smoke-auth.mjs` from repo root:
  applyEnvFile(resolve(__dirname, '..', '.env'), true);
}

loadEnv();

const supabaseUrl = process.env['SUPABASE_URL'];
const anonKey = process.env['SUPABASE_ANON_KEY'];
const email = process.env['SMOKE_AUTH_EMAIL'];
const password = process.env['SMOKE_AUTH_PASSWORD'];

const port = process.env['PORT'] || '3001';
const apiPrefix = (process.env['API_PREFIX'] || 'api/v1').replace(/^\/+|\/+$/g, '');
const defaultBase = `http://127.0.0.1:${port}/${apiPrefix}`;
const apiBase = (process.env['SMOKE_API_BASE_URL'] || defaultBase).replace(/\/$/, '');

const paths = [
  '/auth/me',
  '/auth/agencies',
  '/agencies/me',
  '/tenants/me',
  '/agencies',
];

async function main() {
  if (!supabaseUrl || !anonKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_ANON_KEY (check apps/backend/.env).');
    process.exit(1);
  }
  if (!email || !password) {
    console.error('Set SMOKE_AUTH_EMAIL and SMOKE_AUTH_PASSWORD in .env (local dev only; see .env.example).');
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
  let failed = 0;

  console.log(`API base: ${apiBase}`);
  console.log('---');

  for (const p of paths) {
    const url = `${apiBase}${p}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    const ok = res.status === 200;
    if (!ok) failed += 1;
    console.log(`${res.status} ${p}${ok ? ' OK' : ' FAIL'}`);
  }

  console.log('---');
  if (failed > 0) {
    console.error(`Done: ${failed} request(s) not OK (is the API running? correct port?).`);
    process.exit(4);
  }
  console.log('All smoke requests returned success status.');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
