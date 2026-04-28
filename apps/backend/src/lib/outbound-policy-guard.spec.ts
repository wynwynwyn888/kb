import { applyOutboundPolicyGuard } from './outbound-policy-guard';
import { MENU_PROMPT_NO_KB } from '../modules/conversation-policy/policy-menu-copy';

describe('applyOutboundPolicyGuard (universal — no hardcoded categories)', () => {
  it('replaces hours-like draft when intent is MENU without menu vocabulary', () => {
    const draft = 'We are open weekdays 9am to 11pm and weekends until midnight.';
    const out = applyOutboundPolicyGuard({
      latestIntent: 'MENU',
      menuSelectionActive: false,
      draftText: draft,
    });
    expect(out).toBe(MENU_PROMPT_NO_KB);
    expect(out).not.toMatch(/starters|mains|desserts|vegan/i);
  });

  it('does not replace when draft already mentions menu/services vocabulary', () => {
    const draft = 'Our service menu is available all day; please ask for a price list.';
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

  it('does not replace canonical menu clarification (already menu-shaped)', () => {
    expect(
      applyOutboundPolicyGuard({
        latestIntent: 'MENU',
        draftText: MENU_PROMPT_NO_KB,
      }),
    ).toBe(MENU_PROMPT_NO_KB);
  });

  it('never injects restaurant-specific options into salon flow', () => {
    const draft = 'We are open at 9am.';
    const out = applyOutboundPolicyGuard({
      latestIntent: 'SHORT_SELECTION',
      menuSelectionActive: true,
      draftText: draft,
    });
    expect(out).not.toMatch(/Starters|Mains|Desserts|Vegan options/);
  });
});
