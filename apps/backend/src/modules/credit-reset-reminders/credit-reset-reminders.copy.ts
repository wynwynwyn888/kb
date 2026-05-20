import { isAllowedResetReminderDay } from './credit-reset-reminders.constants';

export function sanitizeReminderDaysArray(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const out: number[] = [];
  for (const v of raw) {
    const n = typeof v === 'number' ? Math.floor(v) : Number.parseInt(String(v ?? ''), 10);
    if (Number.isFinite(n) && isAllowedResetReminderDay(n) && !out.includes(n)) {
      out.push(n);
    }
  }
  return out.sort((a, b) => b - a);
}

/** Whole calendar days from today (UTC) until period_end (UTC date). */
export function daysUntilResetDate(periodEndIso: string | null | undefined): number | null {
  if (typeof periodEndIso !== 'string' || !periodEndIso.trim()) return null;
  const end = new Date(periodEndIso);
  if (Number.isNaN(end.getTime())) return null;
  const now = new Date();
  const endDay = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  const nowDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((endDay - nowDay) / 86_400_000);
}

export interface ResetReminderRenderContext {
  clientName?: string | null;
  workspaceName?: string | null;
  remainingCredits: number;
  agencyName?: string | null;
  resetDate?: string | null;
  daysBefore: number;
}

export function renderResetReminderMessage(template: string, ctx: ResetReminderRenderContext): string {
  const safe = (v: string | null | undefined, fallback: string) => {
    const s = typeof v === 'string' ? v.trim() : '';
    return s.length > 0 ? s : fallback;
  };
  const vars: Record<string, string> = {
    clientName: safe(ctx.clientName, 'there'),
    workspaceName: safe(ctx.workspaceName, 'your workspace'),
    remainingCredits: Number.isFinite(ctx.remainingCredits) ? Math.trunc(ctx.remainingCredits).toLocaleString() : '0',
    agencyName: safe(ctx.agencyName, 'your agency'),
    resetDate: safe(ctx.resetDate, 'Not configured'),
    daysBefore: String(ctx.daysBefore),
  };
  return String(template ?? '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => {
    return Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] ?? '' : `{{${key}}}`;
  });
}
