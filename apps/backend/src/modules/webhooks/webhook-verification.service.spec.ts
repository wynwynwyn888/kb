import { createHmac } from 'node:crypto';
import { WebhookVerificationService } from './webhook-verification.service';

describe('WebhookVerificationService', () => {
  const prev = process.env['WEBHOOK_SIGNATURE_SECRET'];
  const prevNodeEnv = process.env['NODE_ENV'];

  afterEach(() => {
    process.env['WEBHOOK_SIGNATURE_SECRET'] = prev;
    process.env['NODE_ENV'] = prevNodeEnv;
  });

  it('secret absent in non-production → accepts (configured=false)', async () => {
    process.env['NODE_ENV'] = 'test';
    process.env['WEBHOOK_SIGNATURE_SECRET'] = '';
    const svc = new WebhookVerificationService();
    const body = Buffer.from(JSON.stringify({ a: 1 }), 'utf8');
    const res = await svc.verifySignature(body, 'whatever');
    expect(res.valid).toBe(true);
    expect(res.configured).toBe(false);
  });

  it('secret absent in production → rejects', async () => {
    process.env['NODE_ENV'] = 'production';
    process.env['WEBHOOK_SIGNATURE_SECRET'] = '';
    const svc = new WebhookVerificationService();
    const res = await svc.verifySignature(Buffer.from('{}'), '');
    expect(res.valid).toBe(false);
    expect(res.configured).toBe(false);
    expect(res.reason).toBe('not_configured');
  });

  it('secret present + valid raw-body signature → accepts', async () => {
    process.env['WEBHOOK_SIGNATURE_SECRET'] = 'secret123';
    const body = Buffer.from(JSON.stringify({ hello: 'world' }), 'utf8');
    const sig = createHmac('sha256', 'secret123').update(body).digest('hex');
    const svc = new WebhookVerificationService();
    const res = await svc.verifySignature(body, sig);
    expect(res.valid).toBe(true);
    expect(res.configured).toBe(true);
  });

  it('secret present + invalid signature → rejects', async () => {
    process.env['WEBHOOK_SIGNATURE_SECRET'] = 'secret123';
    const body = Buffer.from(JSON.stringify({ hello: 'world' }), 'utf8');
    const svc = new WebhookVerificationService();
    const res = await svc.verifySignature(body, 'deadbeef');
    expect(res.valid).toBe(false);
    expect(res.configured).toBe(true);
  });

  it('secret present + missing raw body → rejects', async () => {
    process.env['WEBHOOK_SIGNATURE_SECRET'] = 'secret123';
    const svc = new WebhookVerificationService();
    const res = await svc.verifySignature(undefined, 'abc');
    expect(res.valid).toBe(false);
    expect(res.reason).toBe('missing_raw_body');
  });
});
