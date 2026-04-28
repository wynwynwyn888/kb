/**
 * Visible runtime build/version marker for ops/debug verification.
 * No secrets; safe to log on startup and expose via authenticated debug endpoint.
 */

export interface RuntimeBuildMarker {
  gitSha: string | null;
  appVersion: string | null;
  nodeEnv: string;
  bootedAtIso: string;
  bootedAtMs: number;
}

let cachedMarker: RuntimeBuildMarker | null = null;

function readEnv(...keys: string[]): string | null {
  for (const k of keys) {
    const v = process.env[k];
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
  }
  return null;
}

/** Resolve and cache the marker on first call (cheap; no I/O). */
export function getRuntimeBuildMarker(): RuntimeBuildMarker {
  if (cachedMarker) return cachedMarker;
  const now = new Date();
  cachedMarker = {
    gitSha: readEnv('GIT_SHA', 'COMMIT_SHA', 'RENDER_GIT_COMMIT', 'VERCEL_GIT_COMMIT_SHA'),
    appVersion: readEnv('APP_VERSION', 'npm_package_version'),
    nodeEnv: (process.env['NODE_ENV'] ?? 'development').trim() || 'development',
    bootedAtIso: now.toISOString(),
    bootedAtMs: now.getTime(),
  };
  return cachedMarker;
}

/** Short single-line summary for boot log (NOT for repeated logs). */
export function formatRuntimeBootLine(prefix = 'AISBP boot'): string {
  const m = getRuntimeBuildMarker();
  const parts = [
    `nodeEnv=${m.nodeEnv}`,
    `appVersion=${m.appVersion ?? 'n/a'}`,
    `gitSha=${m.gitSha ? m.gitSha.slice(0, 12) : 'n/a'}`,
    `bootedAt=${m.bootedAtIso}`,
  ];
  return `${prefix}: ${parts.join(' ')}`;
}
