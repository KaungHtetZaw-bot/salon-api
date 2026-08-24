import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { isDev } from './env';

// Prisma 7 uses driver adapters — no query engine binary.
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });

export const prisma = new PrismaClient({
  adapter,
  log: isDev ? ['warn', 'error'] : ['warn', 'error'],
});
