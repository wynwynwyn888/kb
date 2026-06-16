import { assertProductionSecretsConfigured } from './production-secrets-guard';

describe('assertProductionSecretsConfigured', () => {
  const prev = { ...process.env };

  afterEach(() => {
    process.env = { ...prev };
  });

  it('no-op in development', () => {
    process.env['NODE_ENV'] = 'development';
    delete process.env['WEBHOOK_SIGNATURE_SECRET'];
    expect(() => assertProductionSecretsConfigured()).not.toThrow();
  });

  it('throws in production when webhook secret missing', () => {
    process.env['NODE_ENV'] = 'production';
    process.env['ENCRYPTION_KEY'] = 'x'.repeat(32);
    delete process.env['WEBHOOK_SIGNATURE_SECRET'];
    expect(() => assertProductionSecretsConfigured()).toThrow(/WEBHOOK_SIGNATURE_SECRET/);
  });

  it('throws in production when insecure dev key enabled', () => {
    process.env['NODE_ENV'] = 'production';
    process.env['WEBHOOK_SIGNATURE_SECRET'] = 'secret';
    process.env['ALLOW_INSECURE_DEV_KEY'] = 'true';
    delete process.env['ENCRYPTION_KEY'];
    expect(() => assertProductionSecretsConfigured()).toThrow(/ENCRYPTION_KEY/);
  });
});
