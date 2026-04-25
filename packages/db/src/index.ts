// Database client and schema exports
// TODO: Prisma schema not yet created - this is the interface we expect

import { PrismaClient } from '@prisma/client';

export interface DbClient {
  prisma: PrismaClient;
}

// Singleton pattern for serverless environments
let prismaInstance: PrismaClient | null = null;

export function getPrismaClient(): PrismaClient {
  if (!prismaInstance) {
    prismaInstance = new PrismaClient({
      log: process.env['NODE_ENV'] === 'development' ? ['query', 'error', 'warn'] : ['error'],
    });
  }
  return prismaInstance;
}

export function disconnectPrisma(): Promise<void> {
  if (prismaInstance) {
    return prismaInstance.$disconnect();
  }
  return Promise.resolve();
}

// Re-export Prisma client type for convenience
export type { PrismaClient } from '@prisma/client';

// Schema export placeholder - will be populated when prisma schema is created
export const schemaExports = {
  // Placeholder for generated Prisma types
  // Will be imported from @aisbp/db/schema after prisma generate
} as const;