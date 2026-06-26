import { describe, it, expect } from '@jest/globals';
import { validateFixtureSafety, validateNoGhlMutation, validateNoExecution } from './fixture-safety';
import { PILOT_CLIENT_FIXTURE, PILOT_ANSWERS_FIXTURE, PILOT_ANALYSIS_FIXTURE, PILOT_APPROVAL_FIXTURE } from './pilot-client.fixture';
import { SAMPLE_AGENT_INTAKE_PAYLOADS, SAMPLE_AGENT_RESPONSES } from './agent-intake.fixture';
import { SAMPLE_KB_DRY_RUN_RESPONSE, SAMPLE_KB_APPLY_RESPONSE, SAMPLE_SYNC_RUNS } from './kb-sync.fixture';
import { SAMPLE_GHL_VALIDATE_RESPONSE, SAMPLE_GHL_DRY_RUN_RESPONSE } from './ghl-validation.fixture';

describe('Pilot client fixture safety', () => {
  it('has no real emails', () => {
    const r = validateFixtureSafety('pilot-client', PILOT_CLIENT_FIXTURE);
    expect(r.safe).toBe(true);
  });

  it('has no tokens or secrets', () => {
    const r = validateFixtureSafety('pilot-client', PILOT_CLIENT_FIXTURE);
    expect(r.issues.filter(i => i.includes('token') || i.includes('secret')).length).toBe(0);
  });

  it('has masked phone field', () => {
    expect(PILOT_CLIENT_FIXTURE.contactPhoneMasked).toContain('****');
  });

  it('uses example.com email', () => {
    expect(PILOT_CLIENT_FIXTURE.contactEmail).toContain('example.com');
  });
});

describe('Agent intake fixture safety', () => {
  it('analysis has no tokens or secrets', () => {
    const r = validateFixtureSafety('analysis', PILOT_ANALYSIS_FIXTURE);
    expect(r.safe).toBe(true);
  });

  it('answers have no real phone numbers in values', () => {
    for (const a of PILOT_ANSWERS_FIXTURE.answers) {
      const r = validateFixtureSafety(`answer-${a.questionKey}`, a);
      expect(r.safe).toBe(true);
    }
  });

  it('agent responses have no secrets', () => {
    const r = validateFixtureSafety('agent-responses', SAMPLE_AGENT_RESPONSES);
    expect(r.safe).toBe(true);
  });
});

describe('KB sync fixture safety', () => {
  it('dry-run response has no secrets', () => {
    const r = validateFixtureSafety('kb-dry-run', SAMPLE_KB_DRY_RUN_RESPONSE);
    expect(r.safe).toBe(true);
  });

  it('dry-run has no execution enabled', () => {
    const r = validateNoExecution(SAMPLE_KB_DRY_RUN_RESPONSE);
    expect(r.safe).toBe(true);
  });

  it('dry-run has no GHL mutation', () => {
    const r = validateNoGhlMutation(SAMPLE_KB_DRY_RUN_RESPONSE);
    expect(r.safe).toBe(true);
  });

  it('apply response has outboundEnabled false', () => {
    expect(SAMPLE_KB_APPLY_RESPONSE.outboundEnabled).toBe(false);
  });

  it('apply response has botConfigSynced false', () => {
    expect(SAMPLE_KB_APPLY_RESPONSE.botConfigSynced).toBe(false);
  });

  it('apply response has no messages sent', () => {
    expect(SAMPLE_KB_APPLY_RESPONSE.noMessagesSent).toBe(true);
  });

  it('apply response has no GHL sync', () => {
    expect(SAMPLE_KB_APPLY_RESPONSE.noGhlSync).toBe(true);
  });

  it('sync runs exclude full phone numbers', () => {
    const r = validateFixtureSafety('sync-runs', SAMPLE_SYNC_RUNS);
    expect(r.safe).toBe(true);
  });
});

describe('GHL fixture safety', () => {
  it('validate response has noGhlApiCalls true', () => {
    expect(SAMPLE_GHL_VALIDATE_RESPONSE.noGhlApiCalls).toBe(true);
  });

  it('validate response has noGhlMutation true', () => {
    expect(SAMPLE_GHL_VALIDATE_RESPONSE.noGhlMutation).toBe(true);
  });

  it('dry-run has all operations disabled', () => {
    for (const op of SAMPLE_GHL_DRY_RUN_RESPONSE.proposedOperations) {
      expect(op.noWrite).toBe(true);
      expect(op.disabledForNow).toBe(true);
    }
  });

  it('dry-run has no execution enabled', () => {
    const r = validateNoExecution(SAMPLE_GHL_DRY_RUN_RESPONSE);
    expect(r.safe).toBe(true);
  });

  it('dry-run has no GHL mutation', () => {
    const r = validateNoGhlMutation(SAMPLE_GHL_DRY_RUN_RESPONSE);
    expect(r.safe).toBe(true);
  });

  it('dry-run safety checks all true', () => {
    const sc = SAMPLE_GHL_DRY_RUN_RESPONSE.safetyChecks;
    expect(sc.noGhlMutation).toBe(true);
    expect(sc.noMessagesSent).toBe(true);
    expect(sc.noWorkflowTriggered).toBe(true);
    expect(sc.noAppointmentCreated).toBe(true);
    expect(sc.noOutboundEnabled).toBe(true);
    expect(sc.noGhlApiCalls).toBe(true);
  });
});

describe('Approval fixture safety', () => {
  it('has no secrets in approval payloads', () => {
    const r = validateFixtureSafety('approval', PILOT_APPROVAL_FIXTURE);
    expect(r.safe).toBe(true);
  });
});
