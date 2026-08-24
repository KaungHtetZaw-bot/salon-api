import { z } from 'zod';

export const idParamSchema = z.object({
  id: z.string().uuid('Invalid id format'),
});

export const listServicesQuerySchema = z.object({
  categoryId: z.string().uuid().optional(),
});

export const createCategorySchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(50),
  displayOrder: z.number().int().min(0).max(999).default(0),
});

export const updateCategorySchema = z
  .object({
    name: z.string().trim().min(2).max(50).optional(),
    displayOrder: z.number().int().min(0).max(999).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

export const createServiceSchema = z.object({
  categoryId: z.string().uuid('Invalid category id'),
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(100),
  description: z.string().trim().max(500).optional(),
  basePrice: z
    .number()
    .positive('Price must be greater than 0')
    .max(1_000_000, 'Price looks unrealistic'),
  baseDurationMin: z
    .number()
    .int('Duration must be whole minutes')
    .min(5, 'Minimum duration is 5 minutes')
    .max(480, 'Maximum duration is 8 hours'),
  imageUrl: z.string().url('imageUrl must be a valid URL').optional(),
});

export const updateServiceSchema = z
  .object({
    categoryId: z.string().uuid().optional(),
    name: z.string().trim().min(2).max(100).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    basePrice: z.number().positive().max(1_000_000).optional(),
    baseDurationMin: z.number().int().min(5).max(480).optional(),
    imageUrl: z.string().url().nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
export type CreateServiceInput = z.infer<typeof createServiceSchema>;
export type UpdateServiceInput = z.infer<typeof updateServiceSchema>;
