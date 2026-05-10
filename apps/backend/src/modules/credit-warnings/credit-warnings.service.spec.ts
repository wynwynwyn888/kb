// Trigger-orchestration tests for CreditWarningsService.maybeSendForCreditDebit.
// The Supabase chain is intricate, so we stub the private "load*" helpers via jest.spyOn
// and exercise only the decision tree (skip cases, dedupe, send + record).

import { jest as jestGlobal } from '@jest/globals';
import { CreditWarningsService } from './credit-warnings.service';
import { createMockSupabase } from '../../test/mock-supabase';

const mockSupabase = createMockSupabase();

jestGlobal.mock('../../lib/supabase', () => ({
  getSupabaseService: () => mockSupabase,
}));

jestGlobal.mock('@aisbp/ghl-client', () => {
  return {
    createGhlClient: () => ({
      findContactByPhone: jest.fn(async () => ({ success: true, contact: { id: 'contact-1' } })),
      createContact: jest.fn(async () => ({ success: true, contactId: 'contact-1' })),
      sendMessage: jest.fn(async () => ({ success: true })),
    }),
  };
});

jestGlobal.mock('../../lib/encryption', () => ({
  decrypt: (s: string) => s || 'decrypted',
}));

const ENABLED_SETTINGS = {
  agencyId: 'a1',
  agencyName: 'Acme Agency',
  enabled: true,
  thresholds: [2000, 1000, 500, 200],
  messageTemplate:
    'Hi {{clientName}}, workspace "{{workspaceName}}" has {{remainingCredits}} (level {{threshold}}).',
  sendViaAgencyWorkspace: true,
};

const TENANT_BASE = {
  tenantId: 't1',
  workspaceName: 'Client Workspace',
  isAgencyWorkspace: false,
  creditsUnlimited: false,
  agencyId: 'a1',
  clientPhone: '+15551234567',
  clientName: 'Alex',
};

const AGENCY_CRM = {
  tenantId: 'agency-ws-1',
  ghlLocationId: 'loc-1',
  decryptedToken: 'tok',
};

function freshService() {
  jestGlobal.clearAllMocks();
  const svc = new CreditWarningsService();
  // Default stubs: tenant present + agency settings enabled + CRM connected + nothing already sent + record helpers no-op.
  jest.spyOn(svc as any, 'loadTenantContext').mockResolvedValue(TENANT_BASE);
  jest.spyOn(svc as any, 'loadAgencyContext').mockResolvedValue(ENABLED_SETTINGS);
  jest.spyOn(svc as any, 'loadAgencySystemWorkspaceCrm').mockResolvedValue(AGENCY_CRM);
  jest.spyOn(svc as any, 'alreadySentForPeriod').mockResolvedValue(false);
  jest.spyOn(svc as any, 'reserveSentEvent').mockResolvedValue({ eventId: 'evt-1', alreadyExists: false });
  jest.spyOn(svc as any, 'markEventFailed').mockResolvedValue(undefined);
  jest.spyOn(svc as any, 'recordEvent').mockResolvedValue('evt-skip-1');
  return svc;
}

describe('CreditWarningsService.maybeSendForCreditDebit', () => {
  it('skips when tenant is the agency workspace', async () => {
    const svc = freshService();
    jest.spyOn(svc as any, 'loadTenantContext').mockResolvedValue({ ...TENANT_BASE, isAgencyWorkspace: true });
    const r = await svc.maybeSendForCreditDebit({ tenantId: 't1', balanceBefore: 2500, balanceAfter: 900 });
    expect(r.status).toBe('SKIPPED');
    if (r.status === 'SKIPPED') expect(r.reason).toBe('is_agency_workspace');
  });

  it('skips when tenant has unlimited credits', async () => {
    const svc = freshService();
    jest.spyOn(svc as any, 'loadTenantContext').mockResolvedValue({ ...TENANT_BASE, creditsUnlimited: true });
    const r = await svc.maybeSendForCreditDebit({ tenantId: 't1', balanceBefore: 2500, balanceAfter: 900 });
    expect(r.status).toBe('SKIPPED');
    if (r.status === 'SKIPPED') expect(r.reason).toBe('unlimited_credits');
  });

  it('skips when warnings disabled at agency', async () => {
    const svc = freshService();
    jest.spyOn(svc as any, 'loadAgencyContext').mockResolvedValue({ ...ENABLED_SETTINGS, enabled: false });
    const r = await svc.maybeSendForCreditDebit({ tenantId: 't1', balanceBefore: 2500, balanceAfter: 900 });
    expect(r.status).toBe('SKIPPED');
    if (r.status === 'SKIPPED') expect(r.reason).toBe('warnings_disabled');
  });

  it('skips when no threshold was crossed by this debit', async () => {
    const svc = freshService();
    const r = await svc.maybeSendForCreditDebit({ tenantId: 't1', balanceBefore: 5000, balanceAfter: 4900 });
    expect(r.status).toBe('SKIPPED');
    if (r.status === 'SKIPPED') expect(r.reason).toBe('no_threshold_crossed');
  });

  it('skips and records when client phone is missing', async () => {
    const svc = freshService();
    jest.spyOn(svc as any, 'loadTenantContext').mockResolvedValue({ ...TENANT_BASE, clientPhone: null });
    const r = await svc.maybeSendForCreditDebit({ tenantId: 't1', balanceBefore: 2500, balanceAfter: 900 });
    expect(r.status).toBe('SKIPPED');
    if (r.status === 'SKIPPED') expect(r.reason).toBe('client_phone_missing');
  });

  it('skips and records when agency workspace CRM is not connected', async () => {
    const svc = freshService();
    jest.spyOn(svc as any, 'loadAgencySystemWorkspaceCrm').mockResolvedValue('not_connected');
    const r = await svc.maybeSendForCreditDebit({ tenantId: 't1', balanceBefore: 2500, balanceAfter: 900 });
    expect(r.status).toBe('SKIPPED');
    if (r.status === 'SKIPPED') expect(r.reason).toBe('agency_workspace_crm_not_connected');
  });

  it('only fires the most-urgent threshold when several are crossed at once', async () => {
    const svc = freshService();
    const reserveSpy = jest.spyOn(svc as any, 'reserveSentEvent').mockResolvedValue({
      eventId: 'evt-x',
      alreadyExists: false,
    });
    const r = await svc.maybeSendForCreditDebit({ tenantId: 't1', balanceBefore: 2500, balanceAfter: 150 });
    expect(r.status).toBe('SENT');
    if (r.status === 'SENT') expect(r.threshold).toBe(200);
    expect(reserveSpy).toHaveBeenCalledTimes(1);
    expect(reserveSpy.mock.calls[0]?.[0]).toMatchObject({ threshold: 200 });
  });

  it('skips with threshold_already_sent_for_period when SENT row exists', async () => {
    const svc = freshService();
    jest.spyOn(svc as any, 'alreadySentForPeriod').mockResolvedValue(true);
    const r = await svc.maybeSendForCreditDebit({
      tenantId: 't1',
      balanceBefore: 2500,
      balanceAfter: 900,
      periodEnd: '2027-05-10T00:00:00Z',
    });
    expect(r.status).toBe('SKIPPED');
    if (r.status === 'SKIPPED') expect(r.reason).toBe('threshold_already_sent_for_period');
  });

  it('skips quietly when reserveSentEvent reports a duplicate (race winner already sent)', async () => {
    const svc = freshService();
    jest.spyOn(svc as any, 'reserveSentEvent').mockResolvedValue({ eventId: 'evt-y', alreadyExists: true });
    const r = await svc.maybeSendForCreditDebit({ tenantId: 't1', balanceBefore: 2500, balanceAfter: 900 });
    expect(r.status).toBe('SKIPPED');
    if (r.status === 'SKIPPED') expect(r.reason).toBe('threshold_already_sent_for_period');
  });

  it('returns SENT for a single threshold crossing', async () => {
    const svc = freshService();
    const r = await svc.maybeSendForCreditDebit({ tenantId: 't1', balanceBefore: 2500, balanceAfter: 900 });
    expect(r.status).toBe('SENT');
    if (r.status === 'SENT') {
      expect(r.threshold).toBe(1000);
      expect(r.eventId).toBe('evt-1');
    }
  });
});
