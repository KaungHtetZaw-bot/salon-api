import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.middleware';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate.middleware';
import * as controller from './notifications.controller';
import {
  paginationQuerySchema,
  registerDeviceSchema,
  removeDeviceSchema,
} from './notifications.schema';

export const notificationsRouter = Router();

// Everything here requires an account — both customers and staff receive pushes.
notificationsRouter.use(authenticate);

// Device management
notificationsRouter.post('/devices', validateBody(registerDeviceSchema), controller.registerDevice);
notificationsRouter.get('/devices', controller.listDevices);
notificationsRouter.delete('/devices', validateBody(removeDeviceSchema), controller.removeDevice);

// Notification center
notificationsRouter.get('/', validateQuery(paginationQuerySchema), controller.listNotifications);
notificationsRouter.patch(
  '/:id/read',
  validateParams(z.object({ id: z.string().uuid() })),
  controller.markRead,
);
notificationsRouter.patch('/read-all', controller.markAllRead);
