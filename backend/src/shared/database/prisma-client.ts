/**
 * Prisma client singleton.
 * Prisma 7 requires an adapter for database connection.
 * Reuses the same client instance across hot-reloads in development.
 */
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    log: ['error', 'warn'],
  });
}

export const prisma = globalForPrisma.prisma || createPrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
