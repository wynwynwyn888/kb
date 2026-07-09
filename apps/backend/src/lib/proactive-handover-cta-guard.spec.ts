import { COMPLAINT_ESCALATION_REPLY } from './outbound-safety-governor';
import { stripProactiveHandoverCtaIfNeeded } from './proactive-handover-cta-guard';

describe('stripProactiveHandoverCtaIfNeeded', () => {
  it('removes sentences that offer to connect the customer with the team for MENU flow', () => {
    const before =
      'Happy to help. Could you tell me more? If you’d like, I can connect you with the team for the full details.';
    const r = stripProactiveHandoverCtaIfNeeded({
      replyText: before,
      latestIntent: 'MENU',
      latestUserMessage: 'menu pls',
    });
    expect(r.removed).toBe(true);
    expect(r.text.toLowerCase()).not.toMatch(/connect you (with|to) the team/);
    expect(r.text.toLowerCase()).toContain('happy');
  });

  it('does not mutate replies when escalation intent allows team-connect language', () => {
    const body =
      "Thanks — I’ll connect you with the team now so they can assist.";
    const r = stripProactiveHandoverCtaIfNeeded({
      replyText: body,
      latestIntent: 'COMPLAINT',
      latestUserMessage: 'I want a refund',
    });
    expect(r.removed).toBe(false);
    expect(r.text).toBe(body);
  });

  it('allows empty complaint escalation compatibility copy without substitution', () => {
    const r = stripProactiveHandoverCtaIfNeeded({
      replyText: COMPLAINT_ESCALATION_REPLY,
      latestIntent: 'MENU',
      latestUserMessage: 'menu pls',
    });
    expect(r.removed).toBe(false);
    expect(r.text).toBe('');
  });

  it('still allows detectComplaintServiceIssue probe to bypass stripping for mixed batch context', () => {
    const body = 'Sorry — connect you with the team is available.';
    const r = stripProactiveHandoverCtaIfNeeded({
      replyText: body,
      latestIntent: 'MENU',
      latestUserMessage: 'thanks',
      combinedHumanMessagesText: 'this is unacceptable I want a refund',
    });
    expect(r.removed).toBe(false);
  });
});
