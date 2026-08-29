import { z } from 'zod';

export const updateSalonSettingsSchema = z
  .object({
    salonName: z.string().trim().min(2).max(100).optional(),
    cancellationWindowHrs: z.number().int().min(0).max(168).optional(),
    loyaltyPointsPerVisit: z.number().int().min(0).max(10_000).optional(),
    slotBufferMinutes: z.number().int().min(0).max(240).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'No settings to update' });

export type UpdateSalonSettingsInput = z.infer<typeof updateSalonSettingsSchema>;
