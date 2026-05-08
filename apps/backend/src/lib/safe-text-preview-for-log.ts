import { createHash } from 'node:crypto';
 
 export type SafeTextPreviewForLog = {
   /** Original string length (after String() coercion). */
   length: number;
   /** Short stable hash for correlation across logs (sha256 hex, 10 chars). */
   hash: string;
   /** Optional short head snippet (only when explicitly allowed). */
   head?: string;
 };
 
 function sha256ShortHex(input: string, chars = 10): string {
   const hex = createHash('sha256').update(input, 'utf8').digest('hex');
   return hex.slice(0, Math.max(6, Math.min(64, chars)));
 }
 
 export function isProductionEnv(): boolean {
   return String(process.env['NODE_ENV'] ?? '').trim().toLowerCase() === 'production';
 }
 
 export function safeTextPreviewForLog(
   text: unknown,
   options?: {
     /** When true, include the first `headChars` characters (production only). */
     allowHeadInProduction?: boolean;
     headChars?: number;
     /** Optional label included in the hash derivation to reduce accidental collisions. */
     hashSalt?: string;
   },
 ): SafeTextPreviewForLog {
   const raw = String(text ?? '');
   const normalized = raw.replace(/\r\n/g, '\n');
   const length = normalized.length;
   const salt = options?.hashSalt ? String(options.hashSalt) : '';
   const hash = sha256ShortHex(`${salt}::${normalized}`);
 
   // Default: never include message bodies in production logs.
   if (isProductionEnv()) {
     const allowHead = options?.allowHeadInProduction === true;
     const headChars = Math.max(0, Math.min(24, Math.floor(options?.headChars ?? 12)));
     const head = allowHead && headChars > 0 ? normalized.slice(0, headChars) : undefined;
     return head ? { length, hash, head } : { length, hash };
   }
 
   // Non-production: allow short head by default (still limited).
   const headChars = Math.max(0, Math.min(80, Math.floor(options?.headChars ?? 60)));
   const head = headChars > 0 ? normalized.slice(0, headChars) : undefined;
   return head ? { length, hash, head } : { length, hash };
 }
 
