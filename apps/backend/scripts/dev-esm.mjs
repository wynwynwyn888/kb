#!/usr/bin/env node
/**
 * Nest watch + repeated patch-dist so Node ESM resolves extensionless relative imports.
 * `npm run build` runs patch-dist once; `nest start --watch` does not, which caused
 * ERR_MODULE_NOT_FOUND for paths like ./modules/auth/auth.module
 */

import { spawn } from 'node:child_process';
import { execFileSync, execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, watch } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const patchScript = join(root, 'patch-dist.mjs');

/** Local dev: default to 3001 so smoke scripts (same default) hit this process. */
const childEnv = { ...process.env, PORT: process.env.PORT ?? '3001' };

function patch() {
  if (!existsSync(join(root, 'dist'))) return;
  try {
    execFileSync(process.execPath, [patchScript], {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, PATCH_DIST_QUIET: '1' },
    });
  } catch {
    /* Concurrent `nest` rebuild can delete dist entries mid-patch; next tick retries. */
  }
}

/** One full compile + patch before watch so the first node run sees patched imports. */
execSync('pnpm exec prisma generate', { cwd: root, stdio: 'inherit', shell: true, env: childEnv });
execSync('pnpm -w run build:libs', { cwd: root, stdio: 'inherit', shell: true, env: childEnv });
execSync('npx nest build', { cwd: root, stdio: 'inherit', shell: true, env: childEnv });
patch();

/**
 * `nest start --watch` rewrites `dist/` incrementally; for extensionless relative imports, Node ESM
 * needs `patch-dist.mjs` before `node` loads those files. A fixed 2s poll often lost the race:
 * the watch compile finished and the process restarted before the next patch. Debounced `fs.watch`
 * patches soon after writes; still keep a slow interval as a fallback on flaky watch platforms.
 */
const distPath = join(root, 'dist');
let patchTimer = null;
function schedulePatch() {
  if (patchTimer) clearTimeout(patchTimer);
  patchTimer = setTimeout(() => {
    patchTimer = null;
    patch();
  }, 40);
}

if (existsSync(distPath)) {
  try {
    watch(distPath, { recursive: true }, () => {
      schedulePatch();
    });
  } catch (e) {
    console.warn('[dev-esm] dist watch unavailable, falling back to interval patch:', e);
  }
}

/** Safety net if fs.watch misses an edge (e.g. some platforms). */
const interval = setInterval(patch, 8000);

const nest = spawn('npx', ['nest', 'start', '--watch'], {
  cwd: root,
  stdio: 'inherit',
  shell: true,
  env: childEnv,
});

/**
 * Watch mode rewrites `dist/` (often overwriting patched imports) and Nest can spawn `node`
 * before `fs.watch` + debounce run; a short burst of patches after spawn covers that race.
 */
/** Frequent enough to win the ESM race after watch emit; patch-dist now tolerates partial deletes. */
const burst = setInterval(patch, 120);
setTimeout(() => clearInterval(burst), 10000);

nest.on('error', (err) => {
  clearInterval(interval);
  clearInterval(burst);
  console.error(err);
  process.exit(1);
});

nest.on('close', (code) => {
  clearInterval(interval);
  clearInterval(burst);
  process.exit(code ?? 0);
});
