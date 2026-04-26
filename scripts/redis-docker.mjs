#!/usr/bin/env node
/**
 * Start/stop local Redis for BullMQ (docker-compose.redis.yml).
 * Usage: node scripts/redis-docker.mjs | node scripts/redis-docker.mjs down
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const composeFile = join(root, 'docker-compose.redis.yml');
const down = process.argv.includes('down');

function dockerWorks() {
  const r = spawnSync('docker', ['version'], { encoding: 'utf8', shell: true });
  return r.status === 0;
}

if (!dockerWorks()) {
  console.error(
    '[aisbp] `docker` is not available (install Docker Desktop and ensure it is running), or start Redis another way on port 6379.',
  );
  process.exit(1);
}

const args = down
  ? ['compose', '-f', composeFile, 'down']
  : ['compose', '-f', composeFile, 'up', '-d'];

const run = spawnSync('docker', args, { cwd: root, stdio: 'inherit', shell: true });
process.exit(run.status === null ? 1 : run.status);
