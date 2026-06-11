#!/usr/bin/env node
/**
 * Start/stop local Redis for BullMQ.
 * - Docker: docker-compose.redis.yml (preferred when Docker is available)
 * - Windows fallback: portable redis-server in .dev/redis (no Docker required)
 *
 * Usage: node scripts/redis-docker.mjs | node scripts/redis-docker.mjs down
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const composeFile = join(root, 'docker-compose.redis.yml');
const down = process.argv.includes('down');
const REDIS_PORT = 6379;
const WIN_REDIS_DIR = join(root, '.dev', 'redis');
const WIN_REDIS_EXE = join(WIN_REDIS_DIR, 'redis-server.exe');
const WIN_PID_FILE = join(WIN_REDIS_DIR, 'redis.pid');
const WIN_REDIS_ZIP_URL =
  'https://github.com/tporadowski/redis/releases/download/v5.0.14.1/Redis-x64-5.0.14.1.zip';

function dockerWorks() {
  const r = spawnSync('docker', ['version'], { encoding: 'utf8', shell: true });
  return r.status === 0;
}

function pingRedis() {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    const socket = createConnection({ host: '127.0.0.1', port: REDIS_PORT });
    socket.setTimeout(1500);
    socket.on('connect', () => socket.write('PING\r\n'));
    socket.on('data', (chunk) => {
      if (chunk.toString().includes('PONG')) {
        socket.destroy();
        done(true);
      }
    });
    socket.on('timeout', () => {
      socket.destroy();
      done(false);
    });
    socket.on('error', () => done(false));
  });
}

async function ensureWindowsRedis() {
  if (existsSync(WIN_REDIS_EXE)) return;
  mkdirSync(WIN_REDIS_DIR, { recursive: true });
  const zipPath = join(WIN_REDIS_DIR, 'redis.zip');
  console.log('[aisbp] Downloading portable Redis for Windows...');
  const res = await fetch(WIN_REDIS_ZIP_URL);
  if (!res.ok) throw new Error(`Redis download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(zipPath, buf);

  // Minimal zip extraction for the flat Redis release layout.
  const { execFileSync } = await import('node:child_process');
  execFileSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `Expand-Archive -Path '${zipPath.replace(/'/g, "''")}' -DestinationPath '${WIN_REDIS_DIR.replace(/'/g, "''")}' -Force`,
    ],
    { stdio: 'inherit' },
  );
  unlinkSync(zipPath);
}

async function startWindowsRedis() {
  if (await pingRedis()) {
    console.log(`[aisbp] Redis already running on 127.0.0.1:${REDIS_PORT}`);
    return;
  }

  await ensureWindowsRedis();
  const child = spawn(WIN_REDIS_EXE, ['--port', String(REDIS_PORT)], {
    cwd: WIN_REDIS_DIR,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
  writeFileSync(WIN_PID_FILE, String(child.pid));

  for (let i = 0; i < 20; i++) {
    if (await pingRedis()) {
      console.log(`[aisbp] Redis started on 127.0.0.1:${REDIS_PORT} (pid ${child.pid})`);
      return;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('Redis did not respond to PING after start');
}

function stopWindowsRedis() {
  if (!existsSync(WIN_PID_FILE)) {
    console.log('[aisbp] No Windows Redis pid file; nothing to stop.');
    return;
  }
  const pid = Number(readFileSync(WIN_PID_FILE, 'utf8').trim());
  try {
    process.kill(pid);
    console.log(`[aisbp] Stopped Redis (pid ${pid})`);
  } catch {
    console.log('[aisbp] Redis process already stopped.');
  }
  unlinkSync(WIN_PID_FILE);
}

async function main() {
  if (dockerWorks()) {
    const args = down
      ? ['compose', '-f', composeFile, 'down']
      : ['compose', '-f', composeFile, 'up', '-d'];
    const run = spawnSync('docker', args, { cwd: root, stdio: 'inherit', shell: true });
    process.exit(run.status === null ? 1 : run.status);
  }

  if (process.platform === 'win32') {
    if (down) {
      stopWindowsRedis();
      process.exit(0);
    }
    try {
      await startWindowsRedis();
      process.exit(0);
    } catch (err) {
      console.error('[aisbp] Failed to start Windows Redis:', err?.message ?? err);
      process.exit(1);
    }
  }

  console.error(
    '[aisbp] `docker` is not available. Install Docker Desktop, or on Windows run `pnpm dev:redis` after this script update.',
  );
  process.exit(1);
}

main();
