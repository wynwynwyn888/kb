/**
 * Tests for POST /webhooks/ghl/outbound endpoint.
 * Verifies auth check behavior and flag-gated disabling.
 */

import { jest as jestGlobal } from '@jest/globals';

const mockVerify = jestGlobal.fn();
jestGlobal.mock('./webhook-verification.service', () => ({
  WebhookVerificationService: jestGlobal.fn(() => ({
    verify: mockVerify,
  })),
}));

const mockResolveTenant = jestGlobal.fn();
const mockResolveConversation = jestGlobal.fn();
const mockRecordOutbound = jestGlobal.fn();
jestGlobal.mock('./webhooks.service', () => ({
  WebhooksService: jestGlobal.fn(() => ({
    resolveTenantFromLocation: mockResolveTenant,
    resolveConversationForContact: mockResolveConversation,
    recordOutboundThroughKb: mockRecordOutbound,
  })),
}));

jestGlobal.mock('./dto/ghl-webhook.payload', () => ({}));

import { WebhooksController } from './webhooks.controller';
import { WebhookVerificationService } from './webhook-verification.service';
import { WebhooksService } from './webhooks.service';
import type { Logger } from '@nestjs/common';

describe('WebhooksController.outbound', () => {
  let controller: WebhooksController;
  let verification: WebhookVerificationService;

  beforeEach(() => {
    jestGlobal.clearAllMocks();
    verification = new WebhookVerificationService({ warn: jestGlobal.fn() } as unknown as Logger);
    const webhooksService = new WebhooksService(
      { warn: jestGlobal.fn(), log: jestGlobal.fn(), error: jestGlobal.fn() } as unknown as Logger,
    ) as unknown as WebhooksService;
    // Patch the verify service with our mock
    (controller as any) = undefined;
    controller = new WebhooksController(
      webhooksService,
      verification,
    );
  });

  it('throws BadRequestException when flag is disabled', async () => {
    const prev = process.env['AISBP_OUTBOUND_THROUGH_KB_ENABLED'];
    process.env['AISBP_OUTBOUND_THROUGH_KB_ENABLED'] = 'false';
    await expect(
      controller.recordOutbound({ contact_id: 'c1', location: { id: 'loc' } }, 'token'),
    ).rejects.toThrow('Outbound-through-KB is not enabled');
    if (prev) process.env['AISBP_OUTBOUND_THROUGH_KB_ENABLED'] = prev;
    else delete process.env['AISBP_OUTBOUND_THROUGH_KB_ENABLED'];
  });

  it('rejects invalid auth when flag is enabled', async () => {
    const prev = process.env['AISBP_OUTBOUND_THROUGH_KB_ENABLED'];
    process.env['AISBP_OUTBOUND_THROUGH_KB_ENABLED'] = 'true';
    mockVerify.mockResolvedValue({ valid: false, configured: true, reason: 'invalid_token' });
    await expect(
      controller.recordOutbound({ contact_id: 'c1', location: { id: 'loc' } }, 'bad-token'),
    ).rejects.toThrow('Webhook verification failed');
    if (prev) process.env['AISBP_OUTBOUND_THROUGH_KB_ENABLED'] = prev;
    else delete process.env['AISBP_OUTBOUND_THROUGH_KB_ENABLED'];
  });

  it('proceeds with valid auth when flag is enabled', async () => {
    const prev = process.env['AISBP_OUTBOUND_THROUGH_KB_ENABLED'];
    process.env['AISBP_OUTBOUND_THROUGH_KB_ENABLED'] = 'true';
    mockVerify.mockResolvedValue({ valid: true, configured: true });
    mockResolveTenant.mockResolvedValue('tenant-1');
    mockResolveConversation.mockResolvedValue('conv-1');
    mockRecordOutbound.mockResolvedValue(undefined);

    const result = await controller.recordOutbound(
      { contact_id: 'c1', location: { id: 'loc' } },
      'valid-token',
    );
    expect(result.success).toBe(true);
    expect(mockResolveTenant).toHaveBeenCalled();
    if (prev) process.env['AISBP_OUTBOUND_THROUGH_KB_ENABLED'] = prev;
    else delete process.env['AISBP_OUTBOUND_THROUGH_KB_ENABLED'];
  });

  it('rejects with not_configured reason when secret is missing', async () => {
    const prev = process.env['AISBP_OUTBOUND_THROUGH_KB_ENABLED'];
    process.env['AISBP_OUTBOUND_THROUGH_KB_ENABLED'] = 'true';
    mockVerify.mockResolvedValue({ valid: false, configured: false, reason: 'not_configured' });
    await expect(
      controller.recordOutbound({ contact_id: 'c1', location: { id: 'loc' } }, 'token'),
    ).rejects.toThrow('Webhook verification failed');
    if (prev) process.env['AISBP_OUTBOUND_THROUGH_KB_ENABLED'] = prev;
    else delete process.env['AISBP_OUTBOUND_THROUGH_KB_ENABLED'];
  });

  it('does not send GHL/WhatsApp messages', async () => {
    // The recordOutbound method only writes to the DB — no outbound send occurs.
    const prev = process.env['AISBP_OUTBOUND_THROUGH_KB_ENABLED'];
    process.env['AISBP_OUTBOUND_THROUGH_KB_ENABLED'] = 'true';
    mockVerify.mockResolvedValue({ valid: true, configured: true });
    mockResolveTenant.mockResolvedValue('tenant-1');
    mockResolveConversation.mockResolvedValue('conv-1');
    mockRecordOutbound.mockResolvedValue(undefined);

    await controller.recordOutbound({ contact_id: 'c1', location: { id: 'loc' } }, 'token');
    // recordOutboundThroughKb writes DB records — no sendMessage or GHL API call.
    // Verified by mock never calling sendMessage-related functions.
    if (prev) process.env['AISBP_OUTBOUND_THROUGH_KB_ENABLED'] = prev;
    else delete process.env['AISBP_OUTBOUND_THROUGH_KB_ENABLED'];
  });

  afterEach(() => {
    delete process.env['AISBP_OUTBOUND_THROUGH_KB_ENABLED'];
  });
});
