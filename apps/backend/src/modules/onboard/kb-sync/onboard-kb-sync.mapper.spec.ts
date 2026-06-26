import { describe, it, expect } from '@jest/globals';
import { mapOnboardToKbPlan } from './onboard-kb-sync.mapper';

const FULL_INPUT = {
  tenantName: 'Dapper Dogs',
  agencyId: 'agency-001',
  clientContactName: 'James Tan',
  clientContactPhone: '+65****1234',
  clientContactEmail: 'james@dapperdogs.sg',
  persona: 'You are a friendly dog grooming consultant.',
  conversationGoals: 'Book appointments, answer FAQs',
  businessNotes: 'Premium grooming salon in Tiong Bahru.',
  toneRules: 'Friendly, professional',
  maxReplyTokens: 300,
  faqItems: [
    { question: 'How much is a full groom?', answer: 'S$80-120 depending on breed.', category: 'PRICING' },
    { question: 'Do you do walk-ins?', answer: 'By appointment only.', category: 'BOOKING' },
  ],
  bookingEnabled: true,
  bookingLink: 'https://dapperdogs.sg/book',
  leadFields: ['name', 'phone', 'breed'],
  followUpEnabled: true,
  followUpGoal: 'Remind about grooming appointments',
  followUpCadenceHours: 24,
  handoverEnabled: true,
  handoverPhone: '+65****1234',
};

describe('mapOnboardToKbPlan', () => {
  it('produces phased plan with 4 phases', () => {
    const plans = mapOnboardToKbPlan(FULL_INPUT);
    expect(plans).toHaveLength(4);
    expect(plans[0]!.phaseName).toBe('Tenant & Identity Map');
    expect(plans[1]!.phaseName).toBe('Knowledge Base');
    expect(plans[2]!.phaseName).toBe('Bot Profile & Prompt Config');
    expect(plans[3]!.phaseName).toBe('Automation Settings');
  });

  it('phase 1 creates tenant with correct fields', () => {
    const plans = mapOnboardToKbPlan(FULL_INPUT);
    const tenantOp = plans[0]!.operations[0]!;
    expect(tenantOp.table).toBe('tenants');
    expect(tenantOp.operation).toBe('CREATE');
    expect(tenantOp.fields['name']).toBe('Dapper Dogs');
    expect(tenantOp.fields['status']).toBe('active');
    expect(tenantOp.fields['client_contact_name']).toBe('James Tan');
    expect(tenantOp.fields['client_contact_phone']).toBe('+65****1234');
  });

  it('phase 1 includes identity map update', () => {
    const plans = mapOnboardToKbPlan(FULL_INPUT);
    const idOp = plans[0]!.operations[1]!;
    expect(idOp.table).toBe('onboarding_identity_map');
    expect(idOp.operation).toBe('UPDATE');
  });

  it('phase 2 creates FAQ documents', () => {
    const plans = mapOnboardToKbPlan(FULL_INPUT);
    const faqOps = plans[1]!.operations.filter(o => o.table === 'knowledge_documents');
    expect(faqOps).toHaveLength(2);
    expect(faqOps[0]!.fields['title']).toBe('How much is a full groom?');
    expect(faqOps[1]!.fields['title']).toBe('Do you do walk-ins?');
    expect(faqOps[0]!.fields['document_kind']).toBe('faq');
    expect(faqOps[0]!.fields['status']).toBe('READY');
  });

  it('phase 3 creates bot profile with persona', () => {
    const plans = mapOnboardToKbPlan(FULL_INPUT);
    const bpOp = plans[2]!.operations[0]!;
    expect(bpOp.table).toBe('tenant_bot_profiles');
    expect(bpOp.fields['persona']).toBe('You are a friendly dog grooming consultant.');
    expect(bpOp.fields['is_active']).toBe(true);
  });

  it('phase 4 includes upserts for enabled automation settings', () => {
    const plans = mapOnboardToKbPlan(FULL_INPUT);
    const tables = plans[3]!.operations.map(o => o.table);
    expect(tables).toContain('tenant_booking_settings');
    expect(tables).toContain('tenant_follow_up_settings');
    expect(tables).toContain('tenant_human_escalation_settings');
  });

  it('follow-up is disabled by default regardless of followUpEnabled', () => {
    const plans = mapOnboardToKbPlan(FULL_INPUT);
    const fuOp = plans[3]!.operations.find(o => o.table === 'tenant_follow_up_settings')!;
    expect(fuOp.fields['enabled']).toBe(false);
  });

  it('follow-up uses ai_decides mode only', () => {
    const plans = mapOnboardToKbPlan(FULL_INPUT);
    const fuOp = plans[3]!.operations.find(o => o.table === 'tenant_follow_up_settings')!;
    const steps = fuOp.fields['steps_json'] as Array<Record<string, unknown>>;
    expect(steps).toBeDefined();
    expect(steps[0]!['mode']).toBe('ai_decides');
  });

  it('excludes no GHL operations', () => {
    const plans = mapOnboardToKbPlan(FULL_INPUT);
    for (const plan of plans) {
      for (const op of plan.operations) {
        expect(op.table).not.toBe('tenant_ghl_connections');
      }
    }
  });

  it('excludes no outbound/queue/messaging tables', () => {
    const plans = mapOnboardToKbPlan(FULL_INPUT);
    const allTables = plans.flatMap(p => p.operations.map(o => o.table));
    expect(allTables).not.toContain('outbound_sends');
    expect(allTables).not.toContain('messages');
    expect(allTables).not.toContain('conversations');
    expect(allTables).not.toContain('webhook_events');
    expect(allTables).not.toContain('quota_ledgers');
  });

  it('excludes full phone numbers (only masked present)', () => {
    const plans = mapOnboardToKbPlan(FULL_INPUT);
    const json = JSON.stringify(plans);
    expect(json).not.toContain('87651234'); // unmasked digits
    expect(json).not.toContain('+6587651234'); // full phone
    expect(json).toContain('+65****1234'); // masked
  });

  it('excludes API keys, secrets, credentials', () => {
    const plans = mapOnboardToKbPlan({ tenantName: 'Test', agencyId: 'a1' });
    const json = JSON.stringify(plans);
    expect(json).not.toContain('sk-');
    expect(json).not.toContain('api_key');
    expect(json).not.toContain('password');
    expect(json).not.toContain('token');
    expect(json).not.toContain('secret');
  });

  it('returns only tenant phase when no faqItems, persona, or automation', () => {
    const plans = mapOnboardToKbPlan({ tenantName: 'T', agencyId: 'a1' });
    expect(plans).toHaveLength(1); // Only phase 1 (no FAQ, no persona, no automation)
    expect(plans[0]!.phaseName).toBe('Tenant & Identity Map');
  });

  it('skips bot profile phase when no persona', () => {
    const plans = mapOnboardToKbPlan({ tenantName: 'T', agencyId: 'a1' });
    expect(plans.find(p => p.phaseName === 'Bot Profile & Prompt Config')).toBeUndefined();
  });

  it('skips automation phase when no settings enabled', () => {
    const plans = mapOnboardToKbPlan({ tenantName: 'T', agencyId: 'a1' });
    expect(plans.find(p => p.phaseName === 'Automation Settings')).toBeUndefined();
  });

  it('deterministic ordering: same input → same output', () => {
    const a = JSON.stringify(mapOnboardToKbPlan(FULL_INPUT));
    const b = JSON.stringify(mapOnboardToKbPlan(FULL_INPUT));
    expect(a).toBe(b);
  });

  it('phases are in correct numerical order', () => {
    const plans = mapOnboardToKbPlan(FULL_INPUT);
    for (let i = 1; i < plans.length; i++) {
      expect(plans[i]!.phase).toBeGreaterThan(plans[i - 1]!.phase);
    }
  });

  it('each phase has preconditions', () => {
    const plans = mapOnboardToKbPlan(FULL_INPUT);
    for (const plan of plans) {
      expect(plan.preconditions.length).toBeGreaterThan(0);
    }
  });

  it('each phase has rollbackNotes', () => {
    const plans = mapOnboardToKbPlan(FULL_INPUT);
    for (const plan of plans) {
      expect(plan.rollbackNotes.length).toBeGreaterThan(0);
    }
  });
});
