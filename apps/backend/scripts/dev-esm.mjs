#!/usr/bin/env node
/**
 * Nest watch + repeated patch-dist so Node ESM resolves extensionless relative imports.
 * `npm run build` runs patch-dist once; compiled output keeps extensionless relative imports.
 * We use `nest build --watch` (not `nest start --watch`) so Node only runs after patch-dist.
 */

import { spawn } from 'node:child_process';
import { execFileSync, execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, watch } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const patchScript = join(root, 'patch-dist.mjs');

/**
 * Nest listens on 3001 by default. Ignore a repo-root `PORT` meant for Next/other apps —
 * turbo often injects one `PORT` for all tasks, which would move the API to 3000 and
 * collide with the web app. Override with `NEST_PORT` (or `API_PORT`) if needed.
 */
const env = { ...process.env };
delete env.PORT;
const nestPort = process.env.NEST_PORT?.trim() || process.env.API_PORT?.trim() || '3001';
const childEnv = { ...env, PORT: nestPort };

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

const distPath = join(root, 'dist');
let nodeProc = null;
let restartTimer = null;
let restarting = false;

function stopNode() {
  if (!nodeProc) return;
  nodeProc.removeAllListeners();
  nodeProc.kill();
  nodeProc = null;
}

function startNode() {
  if (!existsSync(join(root, 'dist', 'main.js'))) return;
  patch();
  stopNode();
  nodeProc = spawn(process.execPath, ['dist/main.js'], {
    cwd: root,
    stdio: 'inherit',
    env: childEnv,
  });
  nodeProc.on('exit', (code, signal) => {
    if (restarting || signal) return;
    cleanup();
    process.exit(code ?? 0);
  });
}

function scheduleRestart() {
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    restartTimer = null;
    restarting = true;
    startNode();
    restarting = false;
  }, 120);
}

if (existsSync(distPath)) {
  try {
    watch(distPath, { recursive: true }, () => {
      scheduleRestart();
    });
  } catch (e) {
    console.warn('[dev-esm] dist watch unavailable, falling back to interval restart:', e);
  }
}

/** Safety net if fs.watch misses an edge (e.g. some platforms). */
const interval = setInterval(() => {
  patch();
}, 8000);

startNode();

const nest = spawn('npx', ['nest', 'build', '--watch'], {
  cwd: root,
  stdio: 'inherit',
  shell: true,
  env: childEnv,
});

function cleanup() {
  if (restartTimer) clearTimeout(restartTimer);
  clearInterval(interval);
  stopNode();
}

nest.on('error', (err) => {
  cleanup();
  console.error(err);
  process.exit(1);
});

nest.on('close', (code) => {
  cleanup();
  process.exit(code ?? 0);
});

process.on('SIGINT', () => {
  cleanup();
  nest.kill('SIGINT');
});
process.on('SIGTERM', () => {
  cleanup();
  nest.kill('SIGTERM');
});
