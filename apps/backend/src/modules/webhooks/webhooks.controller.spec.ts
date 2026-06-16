import { jest as jestGlobal } from '@jest/globals';
import { createHmac } from 'node:crypto';
import { WebhooksController } from './webhooks.controller';

describe('WebhooksController signature safe-mode', () => {
  const prev = process.env['WEBHOOK_SIGNATURE_SECRET'];

  afterEach(() => {
    process.env['WEBHOOK_SIGNATURE_SECRET'] = prev;
  });

  function reqFor(body: unknown) {
    return { rawBody: Buffer.from(JSON.stringify(body), 'utf8') };
  }

  it('secret absent → processes event', async () => {
    process.env['WEBHOOK_SIGNATURE_SECRET'] = '';
    const webhooksService = { handleGhlWebhook: jestGlobal.fn(async () => ({ success: true, eventId: 'e1' })) };
    const verifier = { verify: jestGlobal.fn(async () => ({ valid: true, configured: false })) };
    const controller = new WebhooksController(webhooksService as never, verifier as never);

    const body = { locationId: 'loc', event: 'conversation_message_created', data: { id: 'm1', conversationId: 'c1', message: 'Hi' } };
    await controller.handleWebhook(reqFor(body) as never, body as never, '', '', undefined);
    expect(webhooksService.handleGhlWebhook).toHaveBeenCalled();
    expect(verifier.verify).toHaveBeenCalled();
  });

  it('secret present + invalid → returns 200 but does not process', async () => {
    process.env['WEBHOOK_SIGNATURE_SECRET'] = 'secret';
    const webhooksService = { handleGhlWebhook: jestGlobal.fn(async () => ({ success: true, eventId: 'e1' })) };
    const verifier = { verify: jestGlobal.fn(async () => ({ valid: false, configured: true, reason: 'invalid_signature' })) };
    const controller = new WebhooksController(webhooksService as never, verifier as never);

    const body = { locationId: 'loc', event: 'conversation_message_created', data: { id: 'm1', conversationId: 'c1', message: 'Hi' } };
    const res = await controller.handleWebhook(reqFor(body) as never, body as never, 'bad', '', undefined);
    expect(webhooksService.handleGhlWebhook).not.toHaveBeenCalled();
    expect(res).toEqual(expect.objectContaining({ success: true, skipped: true }));
  });

  it('secret present + valid → processes event', async () => {
    process.env['WEBHOOK_SIGNATURE_SECRET'] = 'secret';
    const webhooksService = { handleGhlWebhook: jestGlobal.fn(async () => ({ success: true, eventId: 'e1' })) };
    const body = { locationId: 'loc', event: 'conversation_message_created', data: { id: 'm1', conversationId: 'c1', message: 'Hi' } };
    const rawBody = Buffer.from(JSON.stringify(body), 'utf8');
    const sig = createHmac('sha256', 'secret').update(rawBody).digest('hex');
    const verifier = {
      verify: jestGlobal.fn(async (input: { rawBody: Buffer; hmacSignature?: string }) => {
        const expected = createHmac('sha256', 'secret').update(input.rawBody).digest('hex');
        return { valid: sig === expected, configured: true };
      }),
    };
    const controller = new WebhooksController(webhooksService as never, verifier as never);

    await controller.handleWebhook({ rawBody } as never, body as never, sig, '', undefined);
    expect(webhooksService.handleGhlWebhook).toHaveBeenCalled();
  });

  it('propagates skippedReason from service result', async () => {
    process.env['WEBHOOK_SIGNATURE_SECRET'] = '';
    const webhooksService = {
      handleGhlWebhook: jestGlobal.fn(async () => ({
        success: true,
        skippedReason: 'duplicate_crm_location',
      })),
    };
    const verifier = { verify: jestGlobal.fn(async () => ({ valid: true, configured: false })) };
    const controller = new WebhooksController(webhooksService as never, verifier as never);

    const body = { locationId: 'loc', event: 'conversation_message_created', data: { id: 'm1', conversationId: 'c1', message: 'Hi' } };
    const res = await controller.handleWebhook(reqFor(body) as never, body as never, '', '', undefined);
    expect(res).toEqual(
      expect.objectContaining({
        success: true,
        skippedReason: 'duplicate_crm_location',
      }),
    );
  });
});
