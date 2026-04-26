#!/usr/bin/env node
/**
 * Stable local URL: Next otherwise reads `PORT` from the environment (same as many PaaS
 * templates). In a turbo monorepo that often hands one `PORT` to every task, the UI can
 * jump to 3001 and fight the Nest API, which also defaults to 3001 — then "localhost:3000"
 * looks broken. We strip `PORT` and bind explicitly.
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = process.env.FRONTEND_PORT?.trim() || '3000';
const env = { ...process.env };
delete env.PORT;

const url = `http://127.0.0.1:${port}`;
console.log(`[aisbp] Starting Next.js on ${url}  (set FRONTEND_PORT to change; API stays on 3001 by default)`);

const child = spawn('npx', ['next', 'dev', '-p', port], {
  cwd: root,
  stdio: 'inherit',
  shell: true,
  env,
});

child.on('exit', (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 0);
});
