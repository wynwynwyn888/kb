import { describe, expect, it } from 'vitest';
import {
  LEDGER_REPLY_DEBIT,
  ledgerMovementCustomerLabel,
  projectedCreditsRemainingDaysDisplay,
  quotaAuditActionLabel,
  quotaAuditDeltaAndBalanceAfter,
  quotaAuditWorkspaceLabel,
  softenLedgerCustomerDescription,
} from './credits-billing-copy';

describe('credits-billing-copy', () => {
  it('maps audit action codes to customer labels', () => {
    expect(quotaAuditActionLabel('subaccount.topup')).toBe('Credits added');
    expect(quotaAuditActionLabel('subaccount.manual_adjustment')).toBe('Manual adjustment');
    expect(quotaAuditActionLabel('subaccount.wallet_policy')).toBe('Credit policy updated');
    expect(quotaAuditActionLabel('subaccount.plan_update')).toBe('Plan updated');
    expect(quotaAuditActionLabel('agency.default_quota')).toBe('Default annual allowance updated');
  });

  it('renders plan update rows as old → new annual allowance', () => {
    const o = quotaAuditDeltaAndBalanceAfter({
      action: 'subaccount.plan_update',
      delta: 0,
      previous_total: 36000,
      new_total: 50000,
      metadata: { previousPeriodEnd: '2027-05-10T00:00:00Z', newPeriodEnd: '2028-05-10T00:00:00Z' },
    });
    expect(o.change).toBe('36,000 → 50,000');
    expect(o.balanceAfter).toBe('50,000');
  });

  it('plan update with no allowance change still renders safely', () => {
    const o = quotaAuditDeltaAndBalanceAfter({
      action: 'subaccount.plan_update',
      delta: 0,
      previous_total: 36000,
      new_total: 36000,
      metadata: {},
    });
    expect(o.change).toBe('Recorded');
    expect(o.balanceAfter).toBe('36,000');
  });

  it('formats quota default rows without raw delta/range wording', () => {
    const o = quotaAuditDeltaAndBalanceAfter({
      action: 'agency.default_quota',
      delta: 0,
      previous_total: 3000,
      new_total: 3600,
      metadata: {},
    });
    expect(o.change).toBe('+600');
    expect(o.balanceAfter).toBe('3,600');
  });

  it('resolves workspace display name via API join or wallets map fallback', () => {
    expect(
      quotaAuditWorkspaceLabel({ tenant_id: 't-x', workspaceName: 'Acme HQ' }, new Map()),
    ).toBe('Acme HQ');
    const fb = new Map([['t-y', 'Fallback Name']]);
    expect(quotaAuditWorkspaceLabel({ tenant_id: 't-y', workspaceName: null }, fb)).toBe('Fallback Name');
    expect(quotaAuditWorkspaceLabel({ tenant_id: null }, fb)).toBe('—');
  });

  it('labels ledger movements for tenants', () => {
    expect(ledgerMovementCustomerLabel('reply_debit')).toBe('Assistant reply');
    expect(ledgerMovementCustomerLabel('top_up')).toBe('Credits added');
    expect(ledgerMovementCustomerLabel('manual_adjustment')).toBe('Adjustment');
    expect(ledgerMovementCustomerLabel('refund_credit')).toBe('Credit refund');
    expect(ledgerMovementCustomerLabel('system_correction')).toBe('Account adjustment');
    expect(ledgerMovementCustomerLabel('internal_only_type')).toBe('Account update');
  });

  it('generalizes assistant reply ledger reasons', () => {
    expect(
      softenLedgerCustomerDescription(
        'Assistant reply debit (conversation abc-123)',
        LEDGER_REPLY_DEBIT,
      ),
    ).toBe('Assistant replied to a customer');
    expect(
      softenLedgerCustomerDescription('Billing correction notes', null),
    ).toBe('Billing correction notes');
  });

  it('hides projected days when usage history is thin or the estimate is unstable', () => {
    expect(projectedCreditsRemainingDaysDisplay(36000, 0.001, 2).display).toBe('Not enough usage history yet');
    const earlyMonth = projectedCreditsRemainingDaysDisplay(5000, 0.5, 3);
    expect(earlyMonth.showNumber).toBe(false);
    const stable = projectedCreditsRemainingDaysDisplay(900, 3, 8);
    expect(stable.showNumber).toBe(true);
    expect(stable.display).toBe('300');
    const huge = projectedCreditsRemainingDaysDisplay(1e9, 5, 8);
    expect(huge.showNumber).toBe(false);
    expect(huge.display).toBe('Not enough usage history yet');
  });
});
