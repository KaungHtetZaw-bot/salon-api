import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGIN: z.string().default('*'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 chars'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 chars'),
  ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().int().positive().default(15),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(200),
  TRUST_PROXY: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  // Optional — without it, pushes run in simulated mode (logged, not sent)
  FIREBASE_SERVICE_ACCOUNT_JSON: z.string().optional(),
});

// Treat blank env vars as unset so defaults apply (Vercel dashboards
// often accumulate empty-string entries that would break coercion).
const rawEnv = Object.fromEntries(
  Object.entries(process.env).filter(([, v]) => v !== ''),
);

const parsed = envSchema.safeParse(rawEnv);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('❌ Invalid environment configuration:');
  // eslint-disable-next-line no-console
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const isDev = env.NODE_ENV === 'development';
export const isProd = env.NODE_ENV === 'production';

// Production safety rails — refuse to boot in an unsafe state.
if (isProd) {
  if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
    // eslint-disable-next-line no-console
    console.error('❌ Production requires distinct JWT access & refresh secrets');
    process.exit(1);
  }
  if (env.CORS_ORIGIN === '*') {
    // eslint-disable-next-line no-console
    console.warn('⚠️  CORS is wide open ("*") in production — set CORS_ORIGIN to your app domains');
  }
}
