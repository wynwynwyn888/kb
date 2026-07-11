import {
  COMPLAINT_ESCALATION_REPLY,
  SAFE_UNSUPPORTED_BUSINESS_CLAIM_REPLY,
  detectComplaintServiceIssue,
  isTrustedExecutedBookSlotSource,
  textClaimsBookingConfirmed,
  rewriteUnsupportedBusinessClaimsWhenNoKb,
  NO_KB_FALLBACK_SERVICE,
  NO_KB_FALLBACK_HOURS,
  NO_KB_FALLBACK_MENU_SERVICE_LIST,
  NO_KB_FALLBACK_BROAD_SERVICE,
  NO_KB_FALLBACK_PRICE,
  NO_KB_FALLBACK_AVAILABILITY,
} from './outbound-safety-governor';

describe('outbound-safety-governor', () => {
  describe('textClaimsBookingConfirmed', () => {
    it('flags committed calendar claims', () => {
      expect(textClaimsBookingConfirmed('Your appointment is confirmed for tomorrow')).toBe(true);
      expect(textClaimsBookingConfirmed("I've booked you for 3pm")).toBe(true);
      expect(textClaimsBookingConfirmed('Booking is confirmed')).toBe(true);
      expect(textClaimsBookingConfirmed('Please arrive for your appointment')).toBe(true);
      expect(textClaimsBookingConfirmed('Your slot has been booked')).toBe(true);
    });

    it('does not flag tentative wording', () => {
      expect(textClaimsBookingConfirmed('I can check availability for you')).toBe(false);
      expect(
        textClaimsBookingConfirmed(
          "I've noted those details. Our team will confirm the appointment availability with you before anything is locked in.",
        ),
      ).toBe(false);
    });

    it('does not rewrite transport-fee confirmation offers', () => {
      expect(
        textClaimsBookingConfirmed('Our team can confirm the transport fee when you arrive.'),
      ).toBe(false);
    });

    it('does not rewrite uncertain fee disclaimers', () => {
      expect(textClaimsBookingConfirmed("I don't have the exact fee right now")).toBe(false);
    });

    it('explicit appointment confirmation flags', () => {
      expect(textClaimsBookingConfirmed('Your appointment is confirmed for 3pm')).toBe(true);
    });

    it('explicit slot booked wording flags', () => {
      expect(textClaimsBookingConfirmed('Your slot has been booked')).toBe(true);
    });
  });

  describe('detectComplaintServiceIssue', () => {
    it('detects a generic dissatisfied customer', () => {
      const r = detectComplaintServiceIssue('I am not satisfied with the service');
      expect(r.triggered).toBe(true);
      expect(r.tags).toContain('needs_human_review');
    });

    it('detects refund language', () => {
      const r = detectComplaintServiceIssue('I want a refund — this was terrible');
      expect(r.triggered).toBe(true);
      expect(r.tags).toContain('complaint_service_issue');
    });
  });

  describe('COMPLAINT_ESCALATION_REPLY', () => {
    it('does not promise arranged callbacks', () => {
      expect(COMPLAINT_ESCALATION_REPLY.toLowerCase()).not.toMatch(/\b(i'?ve\s+arranged|scheduled\s+a\s+call)\b/);
    });

    it('does not provide canned escalation copy', () => {
      expect(COMPLAINT_ESCALATION_REPLY).toBe('');
    });
  });

  describe('customer-facing no-KB fallbacks avoid proactive team-connect CTAs', () => {
    const noConnect = (s: string) => expect(s.toLowerCase()).not.toMatch(/connect you (with|to) the team/);

    it('SAFE_UNSUPPORTED_BUSINESS_CLAIM_REPLY', () => {
      noConnect(SAFE_UNSUPPORTED_BUSINESS_CLAIM_REPLY);
    });

    it('NO_KB_FALLBACK_BROAD_SERVICE', () => {
      noConnect(NO_KB_FALLBACK_BROAD_SERVICE);
    });

    it('NO_KB_FALLBACK_PRICE is empty because unsupported claims are blocked', () => {
      noConnect(NO_KB_FALLBACK_PRICE);
      expect(NO_KB_FALLBACK_PRICE).toBe('');
    });

    it('NO_KB_FALLBACK_HOURS is a plain uncertainty line', () => {
      noConnect(NO_KB_FALLBACK_HOURS);
      expect(NO_KB_FALLBACK_HOURS.toLowerCase()).not.toContain('team');
    });

    it('NO_KB_FALLBACK_AVAILABILITY is empty because unsupported claims are blocked', () => {
      noConnect(NO_KB_FALLBACK_AVAILABILITY);
      expect(NO_KB_FALLBACK_AVAILABILITY).toBe('');
    });
  });

  describe('isTrustedExecutedBookSlotSource', () => {
    it('allows legacy WHATSAPP_BOOKING and new CONVERSATION_BOOKING prefixes', () => {
      expect(isTrustedExecutedBookSlotSource('WHATSAPP_BOOKING:ap1')).toBe(true);
      expect(isTrustedExecutedBookSlotSource('CONVERSATION_BOOKING:ap1')).toBe(true);
    });

    it('allows AI source but rejects empty source', () => {
      expect(isTrustedExecutedBookSlotSource('AI')).toBe(true);
      expect(isTrustedExecutedBookSlotSource('')).toBe(false);
      expect(isTrustedExecutedBookSlotSource(undefined)).toBe(false);
    });

    it('rejects unrelated sources', () => {
      expect(isTrustedExecutedBookSlotSource('OTHER:ap1')).toBe(false);
    });
  });

  describe('rewriteUnsupportedBusinessClaimsWhenNoKb', () => {
    it('rewrites unsupported offering claims when KB is empty', () => {
      const r = rewriteUnsupportedBusinessClaimsWhenNoKb({
        kbChunksReturned: 0,
        replyText: 'Absolutely! We offer the Premium Plan.',
      });
      expect(r.rewritten).toBe(true);
      expect(r.text).toBe(NO_KB_FALLBACK_SERVICE);
      expect(r.text.toLowerCase()).not.toContain('premium plan');
    });

    it('rewrites no-KB opening hours / availability claims', () => {
      const r = rewriteUnsupportedBusinessClaimsWhenNoKb({
        kbChunksReturned: 0,
        replyText: "Yes, we are open from 9am to 6pm and we have availability today.",
      });
      expect(r.rewritten).toBe(true);
      expect(r.text).toBe(NO_KB_FALLBACK_HOURS);
    });

    it('does not rewrite when KB has support', () => {
      const r = rewriteUnsupportedBusinessClaimsWhenNoKb({
        kbChunksReturned: 2,
        replyText: 'Absolutely! We offer the Premium Plan.',
      });
      expect(r.rewritten).toBe(false);
    });

    it('rewrites an unsupported recommendation when no tenant facts exist', () => {
      const r = rewriteUnsupportedBusinessClaimsWhenNoKb({
        kbChunksReturned: 0,
        latestIntent: 'MENU',
        latestUserMessage: 'which plan should I choose',
        replyText: 'We recommend our Enterprise package.',
      });
      expect(r.rewritten).toBe(true);
      expect(r.text).toBe(NO_KB_FALLBACK_SERVICE);
      expect(r.text.toLowerCase()).not.toContain('enterprise package');
    });

    it('broad offerings browse with a risky reply uses the empty safe fallback', () => {
      const r = rewriteUnsupportedBusinessClaimsWhenNoKb({
        kbChunksReturned: 0,
        latestIntent: 'MENU',
        latestUserMessage: 'what services do you offer',
        replyText: 'Yes, we offer implementation and training.',
      });
      expect(r.rewritten).toBe(true);
      expect(r.text).toBe(NO_KB_FALLBACK_BROAD_SERVICE);
    });

    it('does not promise eligibility when no tenant facts exist', () => {
      const r = rewriteUnsupportedBusinessClaimsWhenNoKb({
        kbChunksReturned: 0,
        latestUserMessage: 'can my company join this plan',
        replyText: 'Yes, we accept every company.',
      });
      expect(r.rewritten).toBe(true);
      expect(r.text).toBe(NO_KB_FALLBACK_SERVICE);
    });

    it('rewrites an ungrounded price when KB is empty', () => {
      const r = rewriteUnsupportedBusinessClaimsWhenNoKb({
        kbChunksReturned: 0,
        latestIntent: 'PRICE',
        latestUserMessage: 'how much is onboarding',
        replyText: 'Yes, we offer onboarding from $80.',
        tenantPricingCorpus: '',
        tenantId: 't1',
        conversationId: 'c1',
      });
      expect(r.rewritten).toBe(true);
      expect(r.text).toBe(NO_KB_FALLBACK_PRICE);
    });

    it('does not allow PRICE intent alone without tenant-grounded dollar amounts', () => {
      const r = rewriteUnsupportedBusinessClaimsWhenNoKb({
        kbChunksReturned: 0,
        replyText: 'Premium Support — from $999',
        tenantPricingCorpus:
          'Premium Support - from $250\nBasic Support - from $60',
        latestIntent: 'PRICE',
        latestUserMessage: 'how much isit',
        tenantId: 't1',
        conversationId: 'c1',
      });
      expect(r.rewritten).toBe(true);
      expect(r.text).toBe(NO_KB_FALLBACK_PRICE);
      expect(r.supportCheckLog?.supportSource).toBe('unsupported');
    });

    it('allows explicit prices when KB empty but tenant corpus lists matching amounts and anchors', () => {
      const corpus =
        'Basic Support - from $60\nStandard Support - from $70\nPremium Support - from $250';
      const reply =
        'Basic Support - from $60\nStandard Support - from $70\nPremium Support - from $250';
      const r = rewriteUnsupportedBusinessClaimsWhenNoKb({
        kbChunksReturned: 0,
        replyText: reply,
        tenantPricingCorpus: corpus,
        tenantId: 't1',
        conversationId: 'c1',
        latestIntent: 'PRICE',
        latestUserMessage: 'how much isit',
      });
      expect(r.rewritten).toBe(false);
      expect(r.supportCheckLog?.supportSource).toBe('business_notes');
    });

    it('logs KB support source when chunks present even if tenant corpus empty', () => {
      const r = rewriteUnsupportedBusinessClaimsWhenNoKb({
        kbChunksReturned: 2,
        replyText: 'Premium Support — from $250',
        tenantPricingCorpus: '',
        latestIntent: 'MENU',
        tenantId: 't1',
        conversationId: 'c1',
      });
      expect(r.rewritten).toBe(false);
      expect(r.supportCheckLog?.supportSource).toBe('kb');
    });
  });
});
