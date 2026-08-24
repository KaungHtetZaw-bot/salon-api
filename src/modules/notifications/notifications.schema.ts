import { z } from 'zod';

export const platformSchema = z.enum(['IOS', 'ANDROID']);

export const registerDeviceSchema = z.object({
  fcmToken: z.string().trim().min(20, 'FCM token looks invalid').max(4096),
  platform: platformSchema,
});

export const removeDeviceSchema = z.object({
  fcmToken: z.string().trim().min(20).max(4096),
});

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

export type RegisterDeviceInput = z.infer<typeof registerDeviceSchema>;
