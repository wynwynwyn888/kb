// Shared enum type definitions
// These are re-declared here because Prisma's `export *` re-export chain
// does not reliably expose type aliases through @prisma/client in ESM contexts.

export const AgencyRole = {
  OWNER: 'OWNER',
  ADMIN: 'ADMIN',
  OPERATOR: 'OPERATOR',
  MEMBER: 'MEMBER',
} as const;
export type AgencyRole = (typeof AgencyRole)[keyof typeof AgencyRole];

export const TenantRole = {
  ADMIN: 'ADMIN',
  AGENT: 'AGENT',
  VIEWER: 'VIEWER',
} as const;
export type TenantRole = (typeof TenantRole)[keyof typeof TenantRole];

export const WebhookProcessingStatus = {
  RECEIVED: 'RECEIVED',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  DUPLICATE: 'DUPLICATE',
} as const;
export type WebhookProcessingStatus = (typeof WebhookProcessingStatus)[keyof typeof WebhookProcessingStatus];
