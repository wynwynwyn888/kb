#!/usr/bin/env node
/**
 * Run compiled API. Honors PORT from the environment (Docker/VPS, PaaS). For local
 * dev, set PORT in .env or rely on Nest ConfigService default (3001).
 */
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const child = spawn(process.execPath, ['dist/main.js'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env },
});
child.on('exit', (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 0);
});
