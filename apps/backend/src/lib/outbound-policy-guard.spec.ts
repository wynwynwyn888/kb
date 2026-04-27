import { applyOutboundPolicyGuard } from './outbound-policy-guard';
import { MENU_CATEGORY_PROMPT } from '../modules/conversation-policy/policy-menu-copy';

describe('applyOutboundPolicyGuard', () => {
  it('replaces hours-like draft when intent is MENU without menu vocabulary', () => {
    const draft = 'We are open weekdays 9am to 11pm and weekends until midnight.';
    const out = applyOutboundPolicyGuard({
      latestIntent: 'MENU',
      menuSelectionActive: false,
      draftText: draft,
    });
    expect(out).toContain('Our menu covers');
    expect(out).toContain('A) Starters');
    expect(out).not.toMatch(/9am/i);
  });

  it('does not replace when draft already mentions menu items', () => {
    const draft = 'Our starters menu is available from 9am; we also open at 9am weekdays.';
    const out = applyOutboundPolicyGuard({
      latestIntent: 'MENU',
      menuSelectionActive: false,
      draftText: draft,
    });
    expect(out).toBe(draft);
  });

  it('allows hours answer for BUSINESS_HOURS intent', () => {
    const draft = 'We open at 9am on weekdays.';
    expect(
      applyOutboundPolicyGuard({
        latestIntent: 'BUSINESS_HOURS',
        draftText: draft,
      }),
    ).toBe(draft);
  });

  it('H: does not replace canonical menu category prompt (already menu-shaped)', () => {
    expect(
      applyOutboundPolicyGuard({
        latestIntent: 'MENU',
        draftText: MENU_CATEGORY_PROMPT,
      }),
    ).toBe(MENU_CATEGORY_PROMPT);
  });
});
