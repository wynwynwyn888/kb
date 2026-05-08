import {
  COMPLAINT_ESCALATION_REPLY,
  SAFE_UNSUPPORTED_BUSINESS_CLAIM_REPLY,
  detectComplaintServiceIssue,
  isTrustedExecutedBookSlotSource,
  isUnsupportedSalonScopeQuery,
  shouldRewriteUnrequestedMenuRepetition,
  textClaimsBookingConfirmed,
  userAskedForColourAlternatives,
  rewriteUnsupportedBusinessClaimsWhenNoKb,
  NO_KB_FALLBACK_BREED_OR_SPECIES_SERVICE,
  NO_KB_FALLBACK_HOURS,
  NO_KB_FALLBACK_MENU_SERVICE_LIST,
  NO_KB_FALLBACK_BROAD_SERVICE,
  NO_KB_FALLBACK_PRICE,
  NO_KB_FALLBACK_AVAILABILITY,
} from './outbound-safety-governor';
import { classifyConversationIntent } from '../modules/conversation-policy/conversation-intent';

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

    it('still mentions the team for internal escalation instructions', () => {
      expect(COMPLAINT_ESCALATION_REPLY.toLowerCase()).toContain('team');
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

    it('NO_KB_FALLBACK_PRICE asks which service instead of offering team connect', () => {
      noConnect(NO_KB_FALLBACK_PRICE);
      expect(NO_KB_FALLBACK_PRICE.toLowerCase()).toContain('service');
    });

    it('NO_KB_FALLBACK_HOURS is a plain uncertainty line', () => {
      noConnect(NO_KB_FALLBACK_HOURS);
      expect(NO_KB_FALLBACK_HOURS.toLowerCase()).not.toContain('team');
    });

    it('NO_KB_FALLBACK_AVAILABILITY prompts for scheduling preference', () => {
      noConnect(NO_KB_FALLBACK_AVAILABILITY);
      expect(NO_KB_FALLBACK_AVAILABILITY.toLowerCase()).toMatch(/date|time/);
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

  describe('rewriteUnsupportedBusinessClaimsWhenNoKb', () => {
    it('rewrites breed acceptance claims when KB is empty', () => {
      const r = rewriteUnsupportedBusinessClaimsWhenNoKb({
        kbChunksReturned: 0,
        replyText: 'Absolutely! We welcome all breeds, including Chihuahuas.',
      });
      expect(r.rewritten).toBe(true);
      expect(r.text).toBe(NO_KB_FALLBACK_BREED_OR_SPECIES_SERVICE);
      expect(r.text.toLowerCase()).not.toContain('welcome all breeds');
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
        replyText: 'Absolutely! We welcome all breeds, including Chihuahuas.',
      });
      expect(r.rewritten).toBe(false);
    });

    it('rewrites breed/package recommendation hallucination when user asked breed-specific grooming (no KB)', () => {
      const r = rewriteUnsupportedBusinessClaimsWhenNoKb({
        kbChunksReturned: 0,
        latestIntent: 'MENU',
        latestUserMessage: 'grooming for labrador',
        replyText: 'For a Labrador, we typically recommend our Essential Grooming package.',
      });
      expect(r.rewritten).toBe(true);
      expect(r.text).toBe(NO_KB_FALLBACK_BREED_OR_SPECIES_SERVICE);
      expect(r.text.toLowerCase()).not.toContain('essential grooming');
      expect(r.text.toLowerCase()).not.toMatch(/\btypically\s+recommend\b/);
    });

    it('broad menu browse + risky reply uses furkid-safe broad fallback', () => {
      const r = rewriteUnsupportedBusinessClaimsWhenNoKb({
        kbChunksReturned: 0,
        latestIntent: 'MENU',
        latestUserMessage: 'menu pls',
        replyText: 'Yes, we welcome all breeds and offer full grooming on site.',
      });
      expect(r.rewritten).toBe(true);
      expect(r.text).toBe(NO_KB_FALLBACK_BROAD_SERVICE);
    });

    it('does not promise all breeds when user named a breed (no KB)', () => {
      const r = rewriteUnsupportedBusinessClaimsWhenNoKb({
        kbChunksReturned: 0,
        latestUserMessage: 'can i bring chihuahua for service',
        replyText: 'Yes! All breeds are welcome here.',
      });
      expect(r.rewritten).toBe(true);
      expect(r.text).toBe(NO_KB_FALLBACK_BREED_OR_SPECIES_SERVICE);
    });

    it('rewrites ungrounded grooming price list when KB empty and corpus has no matching facts', () => {
      const r = rewriteUnsupportedBusinessClaimsWhenNoKb({
        kbChunksReturned: 0,
        latestIntent: 'PRICE',
        latestUserMessage: 'how much grooming',
        replyText: 'Yes, we offer grooming from $80.',
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
        replyText: 'Keratin Smoothing — from $999',
        tenantPricingCorpus:
          'Keratin Smoothing Treatment - from $250\nDeep Conditioning Treatment - from $60',
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
        'Deep Conditioning Treatment - from $60\nScalp Detox Treatment - from $70\nKeratin Smoothing Treatment - from $250';
      const reply =
        'Deep Conditioning Treatment - from $60\nScalp Detox Treatment - from $70\nKeratin Smoothing Treatment - from $250';
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
        replyText: 'Keratin — from $250',
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
