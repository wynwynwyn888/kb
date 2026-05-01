import {
  COMPLAINT_ESCALATION_REPLY,
  detectComplaintServiceIssue,
  isTrustedExecutedBookSlotSource,
  isUnsupportedSalonScopeQuery,
  shouldRewriteUnrequestedMenuRepetition,
  textClaimsBookingConfirmed,
  userAskedForColourAlternatives,
} from './outbound-safety-governor';
import { classifyConversationIntent } from '../modules/conversation-policy/conversation-intent';

describe('outbound-safety-governor', () => {
  describe('textClaimsBookingConfirmed', () => {
    it('flags common confirmation claims', () => {
      expect(textClaimsBookingConfirmed('Your appointment is confirmed for tomorrow')).toBe(true);
      expect(textClaimsBookingConfirmed("I've booked you for 3pm")).toBe(true);
      expect(textClaimsBookingConfirmed('Booking is confirmed')).toBe(true);
      expect(textClaimsBookingConfirmed('Please arrive for your appointment')).toBe(true);
    });

    it('does not flag tentative wording', () => {
      expect(textClaimsBookingConfirmed('I can check availability for you')).toBe(false);
      expect(
        textClaimsBookingConfirmed(
          "I've noted those details. Our team will confirm the appointment availability with you before anything is locked in.",
        ),
      ).toBe(false);
    });
  });

  describe('detectComplaintServiceIssue', () => {
    it('detects uneven colour result', () => {
      const r = detectComplaintServiceIssue(
        'I did colour yesterday but the result looks uneven',
      );
      expect(r.triggered).toBe(true);
      expect(r.tags).toContain('needs_human_review');
      expect(r.tags).toContain('complaint_colour');
    });

    it('detects refund language', () => {
      const r = detectComplaintServiceIssue('I want a refund — this was terrible');
      expect(r.triggered).toBe(true);
      expect(r.tags).toContain('complaint_service_issue');
    });
  });

  describe('isUnsupportedSalonScopeQuery', () => {
    it('detects neck massage scope question', () => {
      expect(isUnsupportedSalonScopeQuery('do you do neck massage?')).toBe(true);
    });

    it('does not flag generic hair question', () => {
      expect(isUnsupportedSalonScopeQuery('Do you do balayage for Asian hair?')).toBe(false);
    });
  });

  describe('shouldRewriteUnrequestedMenuRepetition', () => {
    it('rewrites when user states scalp concern and reply is a category dump', () => {
      const reply =
        'Colour\n- Opt A\n- Opt B\n- Opt C\n\nTreatment\n- T1\n- T2\n- T3\n\nStyling\n- S1\n- S2\n- S3';
      const sh = shouldRewriteUnrequestedMenuRepetition({
        replyText: reply,
        latestInboundText: 'oily scalp and dry ends',
        latestIntent: classifyConversationIntent('oily scalp and dry ends'),
      });
      expect(sh).toBe(true);
    });

    it('skips when user asked for menu', () => {
      const reply = 'Category A\n- a\n- b\n- c\n\nCategory B\n- d\n- e\n- f';
      const sh = shouldRewriteUnrequestedMenuRepetition({
        replyText: reply,
        latestInboundText: 'what categories do you have',
        latestIntent: classifyConversationIntent('what categories do you have'),
      });
      expect(sh).toBe(false);
    });
  });

  describe('COMPLAINT_ESCALATION_REPLY', () => {
    it('does not promise arranged callbacks', () => {
      expect(COMPLAINT_ESCALATION_REPLY.toLowerCase()).not.toMatch(/\b(i'?ve\s+arranged|scheduled\s+a\s+call)\b/);
    });
  });

  describe('userAskedForColourAlternatives', () => {
    it('detects alternative requests', () => {
      expect(userAskedForColourAlternatives('any other colour options?')).toBe(true);
    });
  });

  describe('isTrustedExecutedBookSlotSource', () => {
    it('allows legacy WHATSAPP_BOOKING and new CONVERSATION_BOOKING prefixes', () => {
      expect(isTrustedExecutedBookSlotSource('WHATSAPP_BOOKING:ap1')).toBe(true);
      expect(isTrustedExecutedBookSlotSource('CONVERSATION_BOOKING:ap1')).toBe(true);
    });

    it('allows AI and empty source', () => {
      expect(isTrustedExecutedBookSlotSource('AI')).toBe(true);
      expect(isTrustedExecutedBookSlotSource('')).toBe(true);
      expect(isTrustedExecutedBookSlotSource(undefined)).toBe(true);
    });

    it('rejects unrelated sources', () => {
      expect(isTrustedExecutedBookSlotSource('OTHER:ap1')).toBe(false);
    });
  });
});
