import axios from 'axios';
import { redactForLogs } from '../../lib/safe-http-error';

/** Stored under `agencies.settings.aiModelHealthSnapshot`. */
export interface AiModelHealthSnapshot {
  lastHealthStatus: 'PASS' | 'FAIL';
  lastHealthCheckedAt: string;
  lastHealthLatencyMs: number | null;
  lastHealthErrorSummary: string | null;
  lastHealthModel: string;
  lastHealthProvider: string;
  lastHealthErrorCode?: string;
}

export function parseAiModelHealthSnapshot(raw: unknown): AiModelHealthSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const st = o['lastHealthStatus'];
  if (st !== 'PASS' && st !== 'FAIL') return null;
  const checked = o['lastHealthCheckedAt'];
  if (typeof checked !== 'string' || !checked) return null;
  const model = o['lastHealthModel'];
  const provider = o['lastHealthProvider'];
  if (typeof model !== 'string' || !model.trim()) return null;
  if (typeof provider !== 'string' || !provider.trim()) return null;
  const lat = o['lastHealthLatencyMs'];
  const latencyMs = typeof lat === 'number' && Number.isFinite(lat) ? lat : null;
  const errSum = o['lastHealthErrorSummary'];
  const errorSummary =
    errSum === null || errSum === undefined
      ? null
      : typeof errSum === 'string'
        ? errSum
        : null;
  const code = o['lastHealthErrorCode'];
  return {
    lastHealthStatus: st,
    lastHealthCheckedAt: checked,
    lastHealthLatencyMs: latencyMs,
    lastHealthErrorSummary: errorSummary,
    lastHealthModel: model.trim(),
    lastHealthProvider: provider.trim().toUpperCase(),
    ...(typeof code === 'string' && code ? { lastHealthErrorCode: code } : {}),
  };
}

/** Dashboard / active row: health only when snapshot matches live provider + model. */
export type ActiveAiHealthBadge = 'PASS' | 'FAIL' | 'UNKNOWN';

export function activeAiHealthFromSnapshot(
  activeProvider: string,
  activeModel: string,
  snapshot: AiModelHealthSnapshot | null,
): {
  healthBadge: ActiveAiHealthBadge;
  lastHealthCheckedAt: string | null;
  lastHealthLatencyMs: number | null;
  lastHealthErrorSummary: string | null;
} {
  const ap = activeProvider.toUpperCase();
  const am = activeModel.trim();
  if (!snapshot) {
    return {
      healthBadge: 'UNKNOWN',
      lastHealthCheckedAt: null,
      lastHealthLatencyMs: null,
      lastHealthErrorSummary: null,
    };
  }
  const match =
    snapshot.lastHealthProvider.toUpperCase() === ap && snapshot.lastHealthModel.trim() === am;
  if (!match) {
    return {
      healthBadge: 'UNKNOWN',
      lastHealthCheckedAt: null,
      lastHealthLatencyMs: null,
      lastHealthErrorSummary: null,
    };
  }
  return {
    healthBadge: snapshot.lastHealthStatus,
    lastHealthCheckedAt: snapshot.lastHealthCheckedAt,
    lastHealthLatencyMs: snapshot.lastHealthLatencyMs,
    lastHealthErrorSummary: snapshot.lastHealthErrorSummary,
  };
}

const MAX_SUMMARY = 420;

function clipSummary(s: string): string {
  const t = s.trim();
  return t.length > MAX_SUMMARY ? `${t.slice(0, MAX_SUMMARY)}…` : t;
}

/**
 * Safe client-facing summary for AI health checks (no keys; bodies redacted).
 */
export function agencyAiHealthErrorSummary(
  provider: 'OPENAI' | 'MINIMAX',
  err: unknown,
): { errorCode: string; errorSummary: string } {
  if (axios.isAxiosError(err)) {
    const status = err.response?.status;
    const code = status != null ? `HTTP_${status}` : 'HTTP_ERROR';
    if (provider === 'OPENAI' && status === 401) {
      return { errorCode: code, errorSummary: 'Invalid API key' };
    }
    let raw = '';
    try {
      const d = err.response?.data;
      if (d != null) {
        raw = typeof d === 'string' ? d : JSON.stringify(d);
      }
    } catch {
      raw = '(unserializable response body)';
    }
    const redacted = clipSummary(redactForLogs(raw || err.message || 'request failed'));
    if (provider === 'MINIMAX' && status === 400) {
      return {
        errorCode: code,
        errorSummary:
          redacted ||
          'MiniMax rejected the request (HTTP 400). Check model id, API base URL (https://api.minimax.io/v1), and group/org id if required.',
      };
    }
    return { errorCode: code, errorSummary: redacted || 'Request failed' };
  }
  const msg = err instanceof Error ? err.message : String(err);
  return { errorCode: 'ERR', errorSummary: clipSummary(redactForLogs(msg)) };
}
