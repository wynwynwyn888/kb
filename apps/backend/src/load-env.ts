// Load `.env` before other app modules import Supabase or read process.env.
// Supports cwd = repo root or `apps/backend` without extra dependencies.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function applyEnvFile(path: string, override: boolean): void {
  if (!existsSync(path)) return;
  let content = readFileSync(path, 'utf8');
  if (content.charCodeAt(0) === 0xfeff) {
    content = content.slice(1);
  }
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
    if (override || process.env[key] === undefined) {
      process.env[key] = val;
    }
  }
}

const cwd = process.cwd();
// Order: `.env` first, then `.env.local` overrides (Next/Vite-style local overrides).
// Supports cwd = repo root or `apps/backend`.
applyEnvFile(resolve(cwd, '.env'), false);
applyEnvFile(resolve(cwd, '..', '.env'), false);
applyEnvFile(resolve(cwd, 'apps', 'backend', '.env'), true);
applyEnvFile(resolve(cwd, '.env.local'), true);
applyEnvFile(resolve(cwd, '..', '.env.local'), true);
applyEnvFile(resolve(cwd, 'apps', 'backend', '.env.local'), true);
