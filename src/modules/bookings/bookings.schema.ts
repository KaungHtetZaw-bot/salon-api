import { z } from 'zod';

export const idParamSchema = z.object({
  id: z.string().uuid('Invalid id format'),
});

export const dateParam = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD');

/** Salon-local naive datetime: "2026-09-01T11:00" (seconds optional). */
export const localDateTime = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/,
    'Use salon-local time: YYYY-MM-DDTHH:mm',
  )
  .transform((v) => (v.length === 16 ? `${v}:00` : v));

export const availabilityQuerySchema = z.object({
  serviceId: z.string().uuid('Invalid service id'),
  date: dateParam,
  staffId: z.string().uuid().optional(),
});

export const createAppointmentSchema = z.object({
  serviceId: z.string().uuid('Invalid service id'),
  staffId: z.string().uuid().optional(),
  scheduledFor: localDateTime,
  notes: z.string().trim().max(500).optional(),
});

export const listAppointmentsQuerySchema = z.object({
  status: z.enum(['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW']).optional(),
  date: dateParam.optional(),
});

export const cancelSchema = z.object({
  reason: z.string().trim().max(300).optional(),
});

export const rescheduleSchema = z.object({
  scheduledFor: localDateTime,
});

export const statusUpdateSchema = z.object({
  status: z.enum(['CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW']),
  reason: z.string().trim().max(300).optional(),
});

export const walkInSchema = z
  .object({
    customerId: z.string().uuid().optional(),
    customerName: z.string().trim().min(2, 'Customer name required').max(100).optional(),
    phone: z.string().trim().min(6).max(20).optional(),
    serviceId: z.string().uuid('Invalid service id'),
    staffId: z.string().uuid().optional(), // admins may direct to any stylist
    scheduledFor: localDateTime.optional(),
    notes: z.string().trim().max(500).optional(),
  })
  .refine((v) => Boolean(v.customerId) !== Boolean(v.customerName), {
    message: 'Provide either customerId or customerName',
  });

export const scheduleQuerySchema = z.object({
  date: dateParam,
  staffId: z.string().uuid().optional(),
});

export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>;
export type StatusUpdateInput = z.infer<typeof statusUpdateSchema>;
export type WalkInInput = z.infer<typeof walkInSchema>;
