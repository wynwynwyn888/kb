/** User-facing billing copy helpers (internal API codes unchanged). */

/** Backend `quota_ledgers.movement_type` for one logical assistant reply. */
export const LEDGER_REPLY_DEBIT = 'reply_debit' as const;

export type QuotaAuditRowLike = {
  action: string;
  delta: number;
  previous_total: number | null;
  new_total: number | null;
  metadata: Record<string, unknown> | null;
};

export function formatCreditsInteger(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return Math.trunc(n).toLocaleString();
}

export function formatCreditsSignedDelta(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const x = Math.trunc(n);
  return x > 0 ? `+${x.toLocaleString()}` : x.toLocaleString();
}

export function quotaAuditActionLabel(action: string): string {
  const map: Record<string, string> = {
    'subaccount.topup': 'Credits added',
    'subaccount.manual_adjustment': 'Manual adjustment',
    'subaccount.wallet_policy': 'Credit policy updated',
    'agency.default_quota': 'Default annual allowance updated',
    'subaccount.create': 'Workspace created',
    'subaccount.renamed': 'Workspace renamed',
    'agency.ai_settings': 'AI settings updated',
    'subaccount.bot_mode': 'AI replies updated',
    'subaccount.deleted': 'Workspace deleted',
    'agency.reply_policy': 'Reply policy updated',
    'agency.active_provider': 'AI provider switched',
  };
  return map[action] ?? 'Account update';
}

/** For client-side filters on the Activity log (matches `quotaAuditActionLabel` groupings). */
export type QuotaAuditLogFilter = 'all' | 'workspace' | 'credits' | 'ai';

export function quotaAuditLogFilterKind(action: string): 'workspace' | 'credits' | 'ai' | 'other' {
  if (
    action === 'subaccount.create' ||
    action === 'subaccount.renamed' ||
    action === 'subaccount.deleted'
  ) {
    return 'workspace';
  }
  if (
    action === 'subaccount.topup' ||
    action === 'subaccount.manual_adjustment' ||
    action === 'agency.default_quota' ||
    action === 'subaccount.wallet_policy'
  ) {
    return 'credits';
  }
  if (
    action === 'agency.ai_settings' ||
    action === 'agency.active_provider' ||
    action === 'agency.reply_policy' ||
    action === 'subaccount.bot_mode'
  ) {
    return 'ai';
  }
  return 'other';
}

export function quotaAuditChangedByLabel(row: { actorName?: string | null; actorEmail?: string | null }): string {
  const n = typeof row.actorName === 'string' ? row.actorName.trim() : '';
  if (n) return n;
  const e = typeof row.actorEmail === 'string' ? row.actorEmail.trim() : '';
  if (e) return e;
  return '—';
}

export function quotaAuditWorkspaceLabel(
  row: { tenant_id: string | null; workspaceName?: string | null },
  fallbackByTenant?: Map<string, string>,
): string {
  const tid = row.tenant_id;
  const fromApi = typeof row.workspaceName === 'string' && row.workspaceName.trim() !== '' ? row.workspaceName.trim() : null;
  if (fromApi) return fromApi;
  if (tid && fallbackByTenant?.has(String(tid))) return fallbackByTenant.get(String(tid)) ?? 'Workspace';
  if (!tid) return '—';
  return 'Workspace';
}

export function quotaAuditDeltaAndBalanceAfter(row: QuotaAuditRowLike): { change: string; balanceAfter: string } {
  const md = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
  switch (row.action) {
    case 'agency.default_quota': {
      const p = row.previous_total;
      const n = row.new_total;
      if (typeof p === 'number' && typeof n === 'number' && Number.isFinite(p) && Number.isFinite(n)) {
        return { change: formatCreditsSignedDelta(n - p), balanceAfter: formatCreditsInteger(n) };
      }
      if (typeof n === 'number' && Number.isFinite(n)) return { change: '—', balanceAfter: formatCreditsInteger(n) };
      return { change: '—', balanceAfter: '—' };
    }
    case 'subaccount.topup':
    case 'subaccount.manual_adjustment':
    case 'subaccount.create': {
      const d = row.delta;
      if (typeof d === 'number' && Number.isFinite(d) && d !== 0)
        return {
          change: formatCreditsSignedDelta(d),
          balanceAfter:
            typeof row.new_total === 'number' && Number.isFinite(row.new_total)
              ? formatCreditsInteger(row.new_total)
              : 'Recorded',
        };
      const nt = row.new_total;
      if (typeof nt === 'number' && Number.isFinite(nt)) return { change: 'Recorded', balanceAfter: formatCreditsInteger(nt) };
      return { change: 'Recorded', balanceAfter: 'Recorded' };
    }
    case 'subaccount.wallet_policy':
    case 'agency.ai_settings':
    case 'agency.active_provider':
    case 'agency.reply_policy':
      return { change: 'Recorded', balanceAfter: '—' };
    case 'subaccount.renamed': {
      const pn = md['previousName'];
      const nn = md['newName'];
      if (typeof pn === 'string' && typeof nn === 'string')
        return { change: `${pn} → ${nn}`, balanceAfter: '—' };
      return { change: 'Recorded', balanceAfter: '—' };
    }
    case 'subaccount.bot_mode': {
      const bm = md['botMode'];
      return { change: typeof bm === 'string' ? bm : 'Recorded', balanceAfter: '—' };
    }
    case 'subaccount.deleted': {
      const name = md['name'];
      return { change: typeof name === 'string' ? `Removed (${name})` : 'Recorded', balanceAfter: '—' };
    }
    default: {
      const d = row.delta;
      const nt = row.new_total;
      if (typeof d === 'number' && Number.isFinite(d) && d !== 0) {
        return {
          change: formatCreditsSignedDelta(d),
          balanceAfter: typeof nt === 'number' && Number.isFinite(nt) ? formatCreditsInteger(nt) : 'Recorded',
        };
      }
      if (typeof nt === 'number' && Number.isFinite(nt)) return { change: 'Recorded', balanceAfter: formatCreditsInteger(nt) };
      return { change: 'Recorded', balanceAfter: 'Recorded' };
    }
  }
}

export function ledgerMovementCustomerLabel(movementType: string | null | undefined, fallbackType?: string): string {
  const k = movementType ?? fallbackType ?? '';
  const map: Record<string, string> = {
    reply_debit: 'Assistant reply',
    top_up: 'Credits added',
    manual_adjustment: 'Manual adjustment',
    refund_credit: 'Credit refund',
    system_correction: 'System correction',
  };
  if (map[k]) return map[k];
  return k.replace(/_/g, ' ').trim() || '—';
}

/** Default customer-facing wording for ledger rows (`reply_debit` stays backend-only elsewhere). */
export function softenLedgerCustomerDescription(desc: unknown, movementType: string | null | undefined): string {
  const d = typeof desc === 'string' ? desc.trim() : '';
  const mt = movementType ?? '';
  if (mt === LEDGER_REPLY_DEBIT) return 'Assistant replied to a customer';
  return d || '—';
}

export type ProjectedDaysOutcome = { showNumber: boolean; display: string };

export function projectedCreditsRemainingDaysDisplay(
  balance: number,
  avgDailyReplyCredits: number | null | undefined,
  dayOfMonth: number,
): ProjectedDaysOutcome {
  const b = Number.isFinite(balance) ? balance : 0;
  const avg = avgDailyReplyCredits != null && Number.isFinite(avgDailyReplyCredits) ? Math.max(0, avgDailyReplyCredits) : null;
  const enoughHistory = dayOfMonth >= 7 || (avg != null && avg >= 1);
  if (!enoughHistory || avg == null || avg <= 0 || b <= 0) return { showNumber: false, display: 'Not enough usage history yet' };

  const raw = Math.floor(b / avg);
  if (!Number.isFinite(raw) || raw > 999) return { showNumber: false, display: 'Not enough usage history yet' };

  return { showNumber: true, display: raw.toLocaleString() };
}
