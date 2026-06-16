import { isProductionEnv } from './safe-text-preview-for-log';

/**
 * Production boot guard — required secrets for a safe live deployment.
 */
export function assertProductionSecretsConfigured(): void {
  if (!isProductionEnv()) return;

  const missing: string[] = [];

  const encryptionKey = String(process.env['ENCRYPTION_KEY'] ?? '').trim();
  const allowInsecure = process.env['ALLOW_INSECURE_DEV_KEY'] === 'true';
  if (!encryptionKey && allowInsecure) {
    missing.push('ENCRYPTION_KEY (ALLOW_INSECURE_DEV_KEY must not be true in production)');
  } else if (!encryptionKey) {
    missing.push('ENCRYPTION_KEY');
  }

  const webhookSecret = String(process.env['WEBHOOK_SIGNATURE_SECRET'] ?? '').trim();
  if (!webhookSecret) {
    missing.push('WEBHOOK_SIGNATURE_SECRET');
  }

  const jwtSecret = String(process.env['JWT_SECRET'] ?? '').trim();
  if (!jwtSecret || jwtSecret === 'supersecret-dev-key') {
    missing.push('JWT_SECRET');
  }

  if (missing.length > 0) {
    throw new Error(
      `Production boot blocked — configure required secrets: ${missing.join(', ')}`,
    );
  }
}
