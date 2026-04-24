#!/usr/bin/env node
/**
 * Run compiled API on PORT 3001 for local/smoke (matches smoke-auth default).
 * Override only if you change this script or run node dist/main.js directly.
 */
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const child = spawn(process.execPath, ['dist/main.js'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, PORT: '3001' },
});
child.on('exit', (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 0);
});
