#!/usr/bin/env node
/**
 * Smoke: POST /ai-router/route (expects 200 + RoutingResponse shape).
 *
 *   node scripts/ai-router-http-smoke.mjs
 *   SMOKE_API_BASE_URL=http://127.0.0.1:3022/api/v1 node scripts/ai-router-http-smoke.mjs
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
  const anonKey = process.env['SUPABASE_ANON_KEY'];
  const email = process.env['SMOKE_AUTH_EMAIL'];
  const password = process.env['SMOKE_AUTH_PASSWORD'];
  const port = process.env['PORT'] || '3001';
  const apiPrefix = (process.env['API_PREFIX'] || 'api/v1').replace(/^\/+|\/+$/g, '');
  const defaultBase = `http://127.0.0.1:${port}/${apiPrefix}`;
  const apiBase = (process.env['SMOKE_API_BASE_URL'] || defaultBase).replace(/\/$/, '');

  if (!url || !anonKey || !email || !password) {
    console.error('Missing SUPABASE_URL, SUPABASE_ANON_KEY, or smoke credentials');
    process.exit(1);
  }

  const supabase = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.session?.access_token) {
    console.error('Sign-in failed:', error?.message);
    process.exit(2);
  }

  const token = data.session.access_token;
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  const routeRes = await fetch(`${apiBase}/ai-router/route`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      tenantId: 'smoke-tenant',
      conversationId: 'smoke-conv',
      prompt: 'I need to book an appointment tomorrow',
      context: {
        recentMessages: [
          {
            role: 'user',
            content: 'Hi',
            sender: 'CONTACT',
            timestamp: new Date().toISOString(),
            messageType: 'text',
          },
        ],
      },
    }),
  });
  const routeBody = await routeRes.json().catch(() => ({}));

  console.log(JSON.stringify({ route: { status: routeRes.status, body: routeBody } }, null, 2));

  if (routeRes.status < 200 || routeRes.status >= 300) {
    process.exit(3);
  }
  if (
    routeBody.recommendedModel == null ||
    routeBody.responseMode == null ||
    routeBody.reasoning == null
  ) {
    console.error('Unexpected response shape');
    process.exit(4);
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
