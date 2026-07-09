import { describe, expect, it } from '@jest/globals';
import {
  buildWebsiteKnowledgeCards,
  renderWebsiteKnowledgeCardForRetrieval,
} from './website-knowledge-cards';

const AISBP_SAMPLE = `
Menu
Login
Accept all cookies
Never Miss A Sale - AI Sales Bot Pro
AI SALES BOT PRO is an AI sales agent that replies to new leads 24/7, qualifies prospects, follows up automatically, and helps businesses turn missed enquiries into booked conversations.
It works across SMS and WhatsApp depending on the connected channel and inbox setup.

WhatsApp and SMS Inbox
The AI can reply to WhatsApp and SMS enquiries from the business number, answer common questions, and keep the conversation moving.
It can hand over when the customer asks for a human.

Automatic Follow Up
AI SALES BOT PRO can follow up automatically when a lead has not replied.
Follow-up timing and wording should match the business playbook.

Appointment Booking
The AI can book appointments by collecting the right details and using the connected calendar setup.
It should confirm availability from the approved booking configuration.

Is this just a chatbot?
No. It is positioned as an AI sales agent for lead capture, follow-up, qualification, and appointment booking, not just a generic chatbot widget.

Missed Leads
Fast replies reduce missed leads because prospects get an answer while they are still interested.
The AI can reply within seconds when automation and channel setup are healthy.

Industries
Clinics, salons, agencies, real estate teams, fitness studios, and local service businesses can use AI SALES BOT PRO when they receive inbound leads.

ROI Calculator
The ROI calculator estimates potential recovered revenue from missed leads using assumptions like lead volume, close rate, average order value, and response speed.
Results vary by industry, offer, traffic quality, and implementation.

Pricing
Plans and pricing shown on the website are marketing information and may require confirmation before purchase.

What should I do next if I am interested?
Book a demo or contact the team so they can check your business use case and setup requirements.

Book demo
Learn more
Privacy Policy
`;

function retrievalTextForAll(): string {
  const result = buildWebsiteKnowledgeCards({
    sourceUrl: 'https://aisalesbot.pro/',
    pageTitle: 'AI SALES BOT PRO',
    text: AISBP_SAMPLE,
    lastCrawledAt: '2026-07-09T09:00:00.000Z',
  });
  return result.cards.map(renderWebsiteKnowledgeCardForRetrieval).join('\n\n---\n\n');
}

describe('website knowledge cards', () => {
  it('turns website copy into typed retrieval cards instead of raw page chunks', () => {
    const result = buildWebsiteKnowledgeCards({
      sourceUrl: 'https://aisalesbot.pro/',
      pageTitle: 'AI SALES BOT PRO',
      text: AISBP_SAMPLE,
      lastCrawledAt: '2026-07-09T09:00:00.000Z',
    });

    const types = new Set(result.cards.map((card) => card.chunkType));
    expect(types.has('product_overview')).toBe(true);
    expect(types.has('feature')).toBe(true);
    expect(types.has('faq')).toBe(true);
    expect(types.has('roi_claim')).toBe(true);
    expect(types.has('pricing_claim')).toBe(true);
    expect(types.has('cta')).toBe(true);

    const rendered = result.cards.map(renderWebsiteKnowledgeCardForRetrieval).join('\n\n');
    expect(rendered).toContain('Title:');
    expect(rendered).toContain('Canonical question:');
    expect(rendered).not.toContain('Accept all cookies');
    expect(rendered).not.toContain('Privacy Policy');
    expect(rendered).not.toContain(AISBP_SAMPLE.trim());

    const roi = result.cards.find((card) => card.chunkType === 'roi_claim');
    expect(roi?.disclaimers.join(' ')).toMatch(/results vary/i);
  });

  it.each([
    ['What is AI SALES BOT PRO?', /ai sales bot pro|sales agent/i],
    ['Does it support WhatsApp?', /whatsapp/i],
    ['Can it follow up automatically?', /follow up automatically|follow-up/i],
    ['Can it book appointments?', /book appointments|appointment booking/i],
    ['Is this just a chatbot?', /not just|chatbot/i],
    ['How does it reduce missed leads?', /missed leads|fast replies/i],
    ['What industries can use it?', /clinics|salons|industries/i],
    ['How does the ROI calculator work?', /roi calculator|lead volume/i],
    ['How fast can it reply?', /within seconds|fast replies/i],
    ['What should I do next if I am interested?', /book a demo|contact the team/i],
  ])('keeps a clean card available for "%s"', (_query, expected) => {
    expect(retrievalTextForAll()).toMatch(expected);
  });
});
