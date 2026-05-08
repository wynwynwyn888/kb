import { jest as jestGlobal } from '@jest/globals';
import { WebhooksController } from './webhooks.controller';

describe('WebhooksController signature safe-mode', () => {
  const prev = process.env['WEBHOOK_SIGNATURE_SECRET'];

  afterEach(() => {
    process.env['WEBHOOK_SIGNATURE_SECRET'] = prev;
  });

  it('secret absent → processes event', async () => {
    process.env['WEBHOOK_SIGNATURE_SECRET'] = '';
    const webhooksService = { handleGhlWebhook: jestGlobal.fn(async () => ({ success: true, eventId: 'e1' })) };
    const verifier = { verifySignature: jestGlobal.fn(async () => ({ valid: true, configured: false })) };
    const controller = new WebhooksController(webhooksService as never, verifier as never);

    const body = { locationId: 'loc', event: 'conversation_message_created', data: { id: 'm1', conversationId: 'c1', message: 'Hi' } };
    await controller.handleWebhook(body as never, '', undefined);
    expect(webhooksService.handleGhlWebhook).toHaveBeenCalled();
  });

  it('secret present + invalid → returns 200 but does not process', async () => {
    process.env['WEBHOOK_SIGNATURE_SECRET'] = 'secret';
    const webhooksService = { handleGhlWebhook: jestGlobal.fn(async () => ({ success: true, eventId: 'e1' })) };
    const verifier = { verifySignature: jestGlobal.fn(async () => ({ valid: false, configured: true, reason: 'invalid_signature' })) };
    const controller = new WebhooksController(webhooksService as never, verifier as never);

    const body = { locationId: 'loc', event: 'conversation_message_created', data: { id: 'm1', conversationId: 'c1', message: 'Hi' } };
    const res = await controller.handleWebhook(body as never, 'bad', undefined);
    expect(webhooksService.handleGhlWebhook).not.toHaveBeenCalled();
    expect(res).toEqual(expect.objectContaining({ success: true, skipped: true }));
  });

  it('secret present + valid → processes event', async () => {
    process.env['WEBHOOK_SIGNATURE_SECRET'] = 'secret';
    const webhooksService = { handleGhlWebhook: jestGlobal.fn(async () => ({ success: true, eventId: 'e1' })) };
    const verifier = { verifySignature: jestGlobal.fn(async () => ({ valid: true, configured: true })) };
    const controller = new WebhooksController(webhooksService as never, verifier as never);

    const body = { locationId: 'loc', event: 'conversation_message_created', data: { id: 'm1', conversationId: 'c1', message: 'Hi' } };
    await controller.handleWebhook(body as never, 'good', undefined);
    expect(webhooksService.handleGhlWebhook).toHaveBeenCalled();
  });
});

