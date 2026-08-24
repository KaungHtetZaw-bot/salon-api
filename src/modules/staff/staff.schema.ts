import { z } from 'zod';

export const idParamSchema = z.object({
  id: z.string().uuid('Invalid id format'),
});

const workingHourSchema = z
  .object({
    weekday: z.number().int().min(0, 'Weekday 0=Sunday').max(6, 'Weekday 6=Saturday'),
    startMinute: z.number().int().min(0).max(1439),
    endMinute: z.number().int().min(1).max(1440),
  })
  .refine((h) => h.startMinute < h.endMinute, {
    message: 'startMinute must be before endMinute',
  });

export const createStaffSchema = z.object({
  fullName: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8, 'Password must be at least 8 characters').max(72),
  phone: z.string().trim().min(6).max(20).optional(),
  title: z.string().trim().max(80).optional(),
  bio: z.string().trim().max(500).optional(),
  commissionRate: z.number().min(0).max(100).default(0),
  workingHours: z.array(workingHourSchema).max(7).optional(),
});

export const updateStaffSchema = z
  .object({
    fullName: z.string().trim().min(2).max(100).optional(), // underlying user row
    phone: z.string().trim().min(6).max(20).nullable().optional(),
    title: z.string().trim().max(80).nullable().optional(),
    bio: z.string().trim().max(500).nullable().optional(),
    commissionRate: z.number().min(0).max(100).optional(),
    isBookable: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

export const replaceWorkingHoursSchema = z
  .object({
    hours: z.array(workingHourSchema).max(7),
  })
  .refine(
    (v) => new Set(v.hours.map((h) => h.weekday)).size === v.hours.length,
    { message: 'Each weekday may appear only once' },
  );

export const createPortfolioItemSchema = z.object({
  imageUrl: z.string().url('imageUrl must be a valid URL'),
  caption: z.string().trim().max(200).optional(),
  serviceId: z.string().uuid().optional(),
});

export type CreateStaffInput = z.infer<typeof createStaffSchema>;
export type UpdateStaffInput = z.infer<typeof updateStaffSchema>;
export type WorkingHoursInput = z.infer<typeof workingHourSchema>[];
