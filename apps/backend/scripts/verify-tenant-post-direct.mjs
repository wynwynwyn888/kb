#!/usr/bin/env node
/** POST /tenants on Nest (SMOKE_API_BASE_URL, default 3001). Tests createTenant + pending ghl. */
import { createClient } from '@supabase/supabase-js';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
function loadEnv() {
  for (const f of [resolve(__dirname, '..', '.env'), resolve(__dirname, '..', '..', '.env')]) {
    if (!existsSync(f)) continue;
    for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i <= 0) continue;
      const k = t.slice(0, i).trim();
      let v = t.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
        v = v.slice(1, -1);
      if (process.env[k] === undefined) process.env[k] = v;
    }
  }
}
loadEnv();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const { data, error } = await supabase.auth.signInWithPassword({
  email: process.env.SMOKE_AUTH_EMAIL,
  password: process.env.SMOKE_AUTH_PASSWORD,
});
if (error) throw error;
const tok = data.session.access_token;
const api = (process.env.SMOKE_API_BASE_URL || 'http://127.0.0.1:3001/api/v1').replace(/\/$/, '');
const me = await (await fetch(`${api}/auth/me`, { headers: { Authorization: `Bearer ${tok}` } })).json();
const res = await fetch(`${api}/tenants`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ agencyId: me.agencyId, name: `API verify ${Date.now()}` }),
});
const text = await res.text();
console.log('POST', `${api}/tenants`);
console.log('Status:', res.status);
console.log('Body:', text.slice(0, 600));
