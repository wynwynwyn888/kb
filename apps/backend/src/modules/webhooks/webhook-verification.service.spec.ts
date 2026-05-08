import { createHmac } from 'node:crypto';
import { WebhookVerificationService } from './webhook-verification.service';

describe('WebhookVerificationService', () => {
  const prev = process.env['WEBHOOK_SIGNATURE_SECRET'];

  afterEach(() => {
    process.env['WEBHOOK_SIGNATURE_SECRET'] = prev;
  });

  it('secret absent → accepts (configured=false)', async () => {
    process.env['WEBHOOK_SIGNATURE_SECRET'] = '';
    const svc = new WebhookVerificationService();
    const res = await svc.verifySignature({ a: 1 }, 'whatever');
    expect(res.valid).toBe(true);
    expect(res.configured).toBe(false);
  });

  it('secret present + valid signature → accepts', async () => {
    process.env['WEBHOOK_SIGNATURE_SECRET'] = 'secret123';
    const body = { hello: 'world' };
    const sig = createHmac('sha256', 'secret123').update(JSON.stringify(body), 'utf8').digest('hex');
    const svc = new WebhookVerificationService();
    const res = await svc.verifySignature(body, sig);
    expect(res.valid).toBe(true);
    expect(res.configured).toBe(true);
  });

  it('secret present + invalid signature → rejects', async () => {
    process.env['WEBHOOK_SIGNATURE_SECRET'] = 'secret123';
    const body = { hello: 'world' };
    const svc = new WebhookVerificationService();
    const res = await svc.verifySignature(body, 'deadbeef');
    expect(res.valid).toBe(false);
    expect(res.configured).toBe(true);
  });
});

