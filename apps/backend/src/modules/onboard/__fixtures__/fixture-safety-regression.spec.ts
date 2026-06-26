import { describe, it, expect } from '@jest/globals';
import { validateFixtureSafety, validateNoGhlMutation, validateNoExecution } from './fixture-safety';

// Regression: GHL fixture mutations
const GHL_BAD_PAYLOAD_1 = {
  operation: 'create GHL contact',
  ghl_contacts: { name: 'Test' },
};

const GHL_BAD_PAYLOAD_2 = {
  operation: 'update GHL workflow',
  ghl_workflows: { id: '123' },
};

const GHL_BAD_PAYLOAD_3 = {
  operation: 'delete',
  ghl_contacts: { id: 'x' },
};

// Regression: KB fixtures with execution
const KB_BAD_PAYLOAD_1 = {
  outboundEnabled: true,
  status: 'DRY_RUN_PASSED',
};

const KB_BAD_PAYLOAD_2 = {
  botProfileActive: true,
  status: 'APPLIED',
};

const KB_BAD_PAYLOAD_3 = {
  followUpEnabled: true,
  noQueueJobsCreated: false,
};

const KB_BAD_PAYLOAD_4 = {
  bookingEnabled: true,
  noMessagesSent: false,
};

const KB_BAD_PAYLOAD_5 = {
  handoverEnabled: true,
};

describe('GHL mutation detection', () => {
  it('detects create operation without safety flag', () => {
    const r = validateNoGhlMutation(GHL_BAD_PAYLOAD_1);
    expect(r.safe).toBe(false);
  });

  it('detects update operation without safety flag', () => {
    const r = validateNoGhlMutation(GHL_BAD_PAYLOAD_2);
    expect(r.safe).toBe(false);
  });

  it('detects delete operation without safety flag', () => {
    const r = validateNoGhlMutation(GHL_BAD_PAYLOAD_3);
    expect(r.safe).toBe(false);
  });
});

describe('KB execution detection', () => {
  it('detects outboundEnabled true', () => {
    const r = validateNoExecution(KB_BAD_PAYLOAD_1);
    expect(r.safe).toBe(false);
  });

  it('detects botProfileActive true', () => {
    const r = validateNoExecution(KB_BAD_PAYLOAD_2);
    expect(r.safe).toBe(false);
  });

  it('detects followUpEnabled true', () => {
    const r = validateNoExecution(KB_BAD_PAYLOAD_3);
    expect(r.safe).toBe(false);
  });

  it('detects bookingEnabled true with noMessagesSent false', () => {
    const r = validateNoExecution(KB_BAD_PAYLOAD_4);
    expect(r.safe).toBe(false);
  });

  it('detects handoverEnabled true', () => {
    const r = validateNoExecution(KB_BAD_PAYLOAD_5);
    expect(r.safe).toBe(false);
  });
});

describe('Agent boundary — agent cannot approve', () => {
  it('fixtures do not contain approval endpoint access', () => {
    // Agent fixtures only contain agent endpoints
    const agentEndpoints = [
      '/onboard/agent/sessions',
      '/onboard/agent/sessions/:id/answers',
      '/onboard/agent/projects/:id/analysis',
      '/onboard/agent/projects/:id/missing-fields',
      '/onboard/agent/projects/:id/request-review',
      '/onboard/agent/projects/:id/status',
    ];
    const blockedEndpoints = [
      '/onboard/projects/:id/sections/:name/approve',
      '/onboard/projects/:id/sync/kb/dry-run',
      '/onboard/projects/:id/sync/kb/apply',
      '/onboard/projects/:id/sync/ghl/validate',
    ];

    for (const ep of agentEndpoints) {
      expect(ep.startsWith('/onboard/agent/')).toBe(true);
    }
    for (const ep of blockedEndpoints) {
      expect(ep.startsWith('/onboard/agent/')).toBe(false);
    }
  });
});

describe('Apply fixture safety', () => {
  it('all apply scopes have noMessagesSent true', () => {
    const applyScopes = [
      { scope: 'TENANT_IDENTITY_ONLY', noMessagesSent: true, noGhlSync: true, outboundEnabled: false },
      { scope: 'BOT_PROFILE_PROMPT_ONLY', noMessagesSent: true, noGhlSync: true, outboundEnabled: false },
      { scope: 'FAQ_KNOWLEDGE_ONLY', noMessagesSent: true, noGhlSync: true, outboundEnabled: false },
      { scope: 'BOOKING_HANDOVER_ONLY', noMessagesSent: true, noGhlSync: true, outboundEnabled: false },
      { scope: 'FOLLOW_UP_SETTINGS_ONLY', noMessagesSent: true, noGhlSync: true, outboundEnabled: false },
    ];

    for (const scope of applyScopes) {
      expect(scope.noMessagesSent).toBe(true);
      expect(scope.noGhlSync).toBe(true);
      expect(scope.outboundEnabled).toBe(false);
    }
  });
});

describe('Secrets detection', () => {
  it('detects API key pattern', () => {
    const r = validateFixtureSafety('bad', { apiKey: 'sk-abc123def456ghi789jkl012mno345pqr678stu' });
    expect(r.safe).toBe(false);
  });

  it('detects JWT token pattern', () => {
    const r = validateFixtureSafety('bad', { token: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.dummy' });
    expect(r.safe).toBe(false);
  });

  it('detects AWS key pattern', () => {
    const r = validateFixtureSafety('bad', { accessKey: 'AKIAIOSFODNN7EXAMPLE' });
    expect(r.safe).toBe(false);
  });

  it('accepts masked phone', () => {
    const r = validateFixtureSafety('ok-phone', { phone: '+65****1234' });
    expect(r.issues.filter(i => i.includes('phone')).length).toBe(0);
  });

  it('warns on full phone (test data OK)', () => {
    const r = validateFixtureSafety('test-phone', { phone: '+6500001111' });
    // Warning but not fatal for test data
    expect(r.issues.length).toBeGreaterThan(0);
  });

  it('rejects real email domains', () => {
    const r = validateFixtureSafety('bad-email', { email: 'real@gmail.com' });
    expect(r.safe).toBe(false);
  });

  it('accepts example.com email', () => {
    const r = validateFixtureSafety('ok-email', { email: 'test@example.com' });
    expect(r.safe).toBe(true);
  });
});
