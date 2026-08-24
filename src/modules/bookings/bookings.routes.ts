import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate.middleware';
import * as controller from './bookings.controller';
import {
  availabilityQuerySchema,
  cancelSchema,
  createAppointmentSchema,
  idParamSchema,
  listAppointmentsQuerySchema,
  rescheduleSchema,
  scheduleQuerySchema,
  statusUpdateSchema,
  walkInSchema,
} from './bookings.schema';

export const bookingsRouter = Router();

// Public — customers browse slots before logging in
bookingsRouter.get(
  '/availability',
  validateQuery(availabilityQuerySchema),
  controller.availability,
);

// Everything below requires an account
bookingsRouter.use(authenticate);

// Customer
const staffOnly = requireRole('STAFF', 'ADMIN');

bookingsRouter.post(
  '/appointments',
  requireRole('CUSTOMER', 'ADMIN'),
  validateBody(createAppointmentSchema),
  controller.create,
);
bookingsRouter.get('/appointments', validateQuery(listAppointmentsQuerySchema), controller.listMine);
bookingsRouter.get('/appointments/:id', validateParams(idParamSchema), controller.detail);
bookingsRouter.patch(
  '/appointments/:id/cancel',
  validateParams(idParamSchema),
  validateBody(cancelSchema),
  controller.cancel,
);
bookingsRouter.patch(
  '/appointments/:id/reschedule',
  validateParams(idParamSchema),
  validateBody(rescheduleSchema),
  controller.reschedule,
);

// Staff / Admin
bookingsRouter.post('/walk-in', staffOnly, validateBody(walkInSchema), controller.walkIn);
bookingsRouter.patch(
  '/appointments/:id/status',
  staffOnly,
  validateParams(idParamSchema),
  validateBody(statusUpdateSchema),
  controller.updateStatus,
);
bookingsRouter.get(
  '/schedule',
  staffOnly,
  validateQuery(scheduleQuerySchema),
  controller.schedule,
);
