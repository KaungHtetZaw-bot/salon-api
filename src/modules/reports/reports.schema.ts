import { z } from 'zod';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const dateStr = z.string().regex(DATE_RE, 'Use YYYY-MM-DD');

export const reportRangeQuerySchema = z
  .object({
    from: dateStr.optional(),
    to: dateStr.optional(),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    message: '"from" must be on or before "to"',
  });

export const revenueQuerySchema = reportRangeQuerySchema.and(
  z.object({
    groupBy: z.enum(['day', 'month']).default('day'),
  }),
);

export const topServicesQuerySchema = reportRangeQuerySchema.and(
  z.object({
    limit: z.coerce.number().int().min(1).max(50).default(10),
  }),
);
