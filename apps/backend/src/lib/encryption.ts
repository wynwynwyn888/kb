// Backend encryption utilities
// Provides encrypt/decrypt for sensitive data storage

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';

// Get encryption key from environment
function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    // For development only - in production, key must be set
    console.warn('[Encryption] ENCRYPTION_KEY not set, using fallback (NOT SECURE)');
    return Buffer.from('default-32-char-key-for-dev!!');
  }
  if (key.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be exactly 32 characters');
  }
  return Buffer.from(key);
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
  if (token.length <= 8) {
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