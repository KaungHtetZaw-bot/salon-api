import { z } from 'zod';

export const idParamSchema = z.object({
  id: z.string().uuid('Invalid id format'),
});

export const staffIdParamSchema = z.object({
  staffId: z.string().uuid('Invalid id format'),
});

// ────────────────────────── Reviews ──────────────────────────

export const createReviewSchema = z.object({
  appointmentId: z.string().uuid('Invalid appointment id'),
  rating: z.number().int('Rating must be a whole number').min(1, 'Rating is 1–5').max(5, 'Rating is 1–5'),
  comment: z.string().trim().max(1000).optional(),
});

export const updateReviewSchema = z
  .object({
    rating: z.number().int().min(1).max(5).optional(),
    comment: z.string().trim().max(1000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

export const replyReviewSchema = z.object({
  reply: z.string().trim().min(2, 'Reply too short').max(1000),
});

export const listReviewsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
});

// ────────────────────────── Loyalty ──────────────────────────

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

export const adjustPointsSchema = z.object({
  customerId: z.string().uuid('Invalid customer id'),
  points: z
    .number()
    .int('Points must be a whole number')
    .refine((v) => v !== 0, 'Points cannot be zero'),
  description: z.string().trim().max(300).optional(),
});

// ────────────────────── Rewards (admin) ──────────────────────

export const createRewardSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    description: z.string().trim().max(300).optional(),
    pointsCost: z.number().int().min(1, 'Cost at least 1 point').max(1_000_000),
    serviceId: z.string().uuid().optional(), // free-service reward
    discountPct: z.number().int().min(1).max(90).optional(),
  })
  .refine((v) => !v.serviceId || !v.discountPct, {
    message: 'Choose either a free service or a discount — not both',
  });

export const updateRewardSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    description: z.string().trim().max(300).nullable().optional(),
    pointsCost: z.number().int().min(1).max(1_000_000).optional(),
    discountPct: z.number().int().min(1).max(90).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

export type CreateReviewInput = z.infer<typeof createReviewSchema>;
export type UpdateReviewInput = z.infer<typeof updateReviewSchema>;
export type AdjustPointsInput = z.infer<typeof adjustPointsSchema>;
export type CreateRewardInput = z.infer<typeof createRewardSchema>;
export type UpdateRewardInput = z.infer<typeof updateRewardSchema>;
