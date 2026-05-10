// Pure helpers for low-credit warning threshold selection + message rendering.
// Kept dependency-free so the unit tests can exercise crossing rules without Supabase.

import { isAllowedWarningThreshold } from './credit-warnings.constants';

export interface ThresholdCrossingInput {
  /** Wallet balance immediately before the successful debit. */
  balanceBefore: number;
  /** Wallet balance immediately after the successful debit. */
  balanceAfter: number;
  /** Set of thresholds (descending) currently enabled by the agency. */
  enabledThresholds: number[];
}

/**
 * Choose the single most-urgent threshold the wallet just crossed below.
 *
 * Crossing rule (per spec):
 *   - balance was strictly above threshold before the debit, and
 *   - balance is now at or below threshold after the debit.
 *
 * If multiple thresholds are crossed in one debit (rare large debit), only the
 * smallest (lowest remaining) crossed threshold is returned so we send the
 * **most urgent** warning instead of one warning per threshold. Examples in spec:
 *   2500 → 900  → returns 1000
 *   2500 → 150  → returns 200
 */
export function selectCrossedThreshold(input: ThresholdCrossingInput): number | null {
  const { balanceBefore, balanceAfter, enabledThresholds } = input;
  if (!Array.isArray(enabledThresholds) || enabledThresholds.length === 0) return null;
  const sortedDesc = [...new Set(enabledThresholds.filter(t => Number.isFinite(t) && t > 0))].sort((a, b) => b - a);
  const crossed = sortedDesc.filter(t => balanceBefore > t && balanceAfter <= t);
  if (crossed.length === 0) return null;
  return crossed[crossed.length - 1] ?? null;
}

/** Whitelist a JSON value coming from the DB into a sanitized threshold array. */
export function sanitizeThresholdsArray(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const out: number[] = [];
  for (const v of raw) {
    const n = typeof v === 'number' ? Math.floor(v) : Number.parseInt(String(v ?? ''), 10);
    if (Number.isFinite(n) && isAllowedWarningThreshold(n) && !out.includes(n)) {
      out.push(n);
    }
  }
  return out.sort((a, b) => b - a);
}

export interface WarningRenderContext {
  clientName?: string | null;
  workspaceName?: string | null;
  remainingCredits: number;
  threshold: number;
  agencyName?: string | null;
  resetDate?: string | null;
}

/** Render `{{var}}` placeholders. Unknown vars stay as-is. Missing values use safe fallback. */
export function renderWarningMessage(template: string, ctx: WarningRenderContext): string {
  const safe = (v: string | null | undefined, fallback: string) => {
    const s = typeof v === 'string' ? v.trim() : '';
    return s.length > 0 ? s : fallback;
  };
  const vars: Record<string, string> = {
    clientName: safe(ctx.clientName, 'there'),
    workspaceName: safe(ctx.workspaceName, 'your workspace'),
    remainingCredits: Number.isFinite(ctx.remainingCredits) ? Math.trunc(ctx.remainingCredits).toLocaleString() : '0',
    threshold: Number.isFinite(ctx.threshold) ? Math.trunc(ctx.threshold).toLocaleString() : String(ctx.threshold),
    agencyName: safe(ctx.agencyName, 'your agency'),
    resetDate: safe(ctx.resetDate, 'Not configured'),
  };
  return String(template ?? '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => {
    return Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] ?? '' : `{{${key}}}`;
  });
}

/** Format an ISO timestamp into a UI-friendly reset date string (returns null if invalid). */
export function formatResetDateForMessage(iso: string | null | undefined): string | null {
  if (typeof iso !== 'string' || !iso.trim()) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}
