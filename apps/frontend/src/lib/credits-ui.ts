export type CreditStatus =
  | 'ACTIVE'
  | 'LOW_CREDIT'
  | 'PAUSED_NO_CREDITS'
  | 'NEGATIVE_ALLOWED'
  | 'OVER_NEGATIVE_LIMIT'
  | string;

export function creditStatusLabel(status: CreditStatus): string {
  if (status === 'ACTIVE') return 'Active';
  if (status === 'LOW_CREDIT') return 'Low credit';
  if (status === 'PAUSED_NO_CREDITS') return 'Paused: no credits';
  if (status === 'NEGATIVE_ALLOWED') return 'Negative allowed';
  if (status === 'OVER_NEGATIVE_LIMIT') return 'Over negative limit';
  return String(status || 'Active');
}

export function formatSignedInt(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return n > 0 ? `+${Math.trunc(n)}` : String(Math.trunc(n));
}

