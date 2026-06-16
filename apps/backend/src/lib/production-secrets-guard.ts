import { isProductionEnv } from './safe-text-preview-for-log';

export function assertProductionSecretsConfigured(): void {
  if (!isProductionEnv()) return;

  const missing: string[] = [];

  if (!String(process.env['WEBHOOK_SIGNATURE_SECRET'] ?? '').trim()) {
    missing.push('WEBHOOK_SIGNATURE_SECRET');
  }

  const encryptionKey = String(process.env['ENCRYPTION_KEY'] ?? '').trim();
  const allowInsecure = process.env['ALLOW_INSECURE_DEV_KEY'] === 'true';
  if (!encryptionKey && allowInsecure) {
    missing.push('ENCRYPTION_KEY (ALLOW_INSECURE_DEV_KEY must not be true in production)');
  } else if (!encryptionKey) {
    missing.push('ENCRYPTION_KEY');
  }

  if (missing.length > 0) {
    throw new Error(
      `Production boot blocked — configure required secrets: ${missing.join(', ')}`,
    );
  }
}
