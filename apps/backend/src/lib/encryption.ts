// Backend encryption utilities
// Provides encrypt/decrypt for sensitive data storage
// IMPORTANT: These utilities require a properly configured ENCRYPTION_KEY

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const REQUIRED_KEY_LENGTH = 32;

// Warning flag for development mode - must be explicitly enabled
const ALLOW_INSECURE_DEV_KEY = process.env.ALLOW_INSECURE_DEV_KEY === 'true';
let warnedAboutInsecureKey = false;

/**
 * Get and validate encryption key from environment
 *
 * Security behavior:
 * - If ENCRYPTION_KEY is missing and ALLOW_INSECURE_DEV_KEY=true, uses insecure dev fallback
 * - If ENCRYPTION_KEY is missing and ALLOW_INSECURE_DEV_KEY=false/unset, throws error
 * - If ENCRYPTION_KEY is set but invalid length, throws error
 *
 * @throws Error if key is missing or invalid (unless dev fallback explicitly allowed)
 */
function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;

  // Case 1: Key is set - validate and use it
  if (key && key.length > 0) {
    if (key.length !== REQUIRED_KEY_LENGTH) {
      throw new Error(
        `ENCRYPTION_KEY must be exactly ${REQUIRED_KEY_LENGTH} UTF-8 characters. ` +
        `Got ${key.length} characters. ` +
        `Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
      );
    }
    return Buffer.from(key, 'utf8');
  }

  // Case 2: Key is not set - check dev override flag
  if (ALLOW_INSECURE_DEV_KEY) {
    if (!warnedAboutInsecureKey) {
      console.error('╔════════════════════════════════════════════════════════════════╗');
      console.error('║  WARNING: ENCRYPTION_KEY not set - using INSECURE fallback       ║');
      console.error('║  DO NOT USE IN PRODUCTION                                       ║');
      console.error('║  Set ALLOW_INSECURE_DEV_KEY=false or configure ENCRYPTION_KEY   ║');
      console.error('╚════════════════════════════════════════════════════════════════╝');
      warnedAboutInsecureKey = true;
    }
    return Buffer.from('dev-fallback-key-32-chars!!!!!', 'utf8');
  }

  // Case 3: Key missing and dev override not allowed - fail fast
  throw new Error(
    `ENCRYPTION_KEY environment variable is required but not set. ` +
    `Set ENCRYPTION_KEY to exactly ${REQUIRED_KEY_LENGTH} UTF-8 characters. ` +
    `For development, you may set ALLOW_INSECURE_DEV_KEY=true to use an insecure fallback.`
  );
}

/**
 * Encrypt a sensitive value for storage
 * Returns base64 encoded string with IV and auth tag
 */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  // Format: base64(iv + authTag + encrypted)
  return Buffer.concat([
    Buffer.from(iv),
    Buffer.from(authTag),
    Buffer.from(encrypted, 'hex'),
  ]).toString('base64');
}

/**
 * Decrypt a value encrypted with encrypt()
 */
export function decrypt(ciphertext: string): string {
  const key = getEncryptionKey();
  const buffer = Buffer.from(ciphertext, 'base64');

  const iv = buffer.subarray(0, 16);
  const authTag = buffer.subarray(16, 32);
  const encrypted = buffer.subarray(32);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted);
  decrypted = Buffer.concat([decrypted, decipher.final()]);

  return decrypted.toString('utf8');
}

/**
 * Mask a token for safe display in logs/responses
 * Shows first 4 and last 4 characters
 */
export function maskToken(token: string): string {
  if (!token || token.length <= 8) {
    return '****';
  }
  return token.substring(0, 4) + '...' + token.substring(token.length - 4);
}

/**
 * Safe log object - replaces any sensitive fields with masked values
 */
export function safeLog(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const sensitivePatterns = ['token', 'key', 'secret', 'password', 'auth', 'access'];

  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    const isSensitive = sensitivePatterns.some(p => lowerKey.includes(p));

    if (isSensitive && typeof value === 'string') {
      result[key] = maskToken(value);
    } else if (typeof value === 'object' && value !== null) {
      result[key] = safeLog(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }

  return result;
}