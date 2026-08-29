import { Router } from 'express';
import { validateBody } from '../../middleware/validate.middleware';
import * as controller from './settings.controller';
import { updateSalonSettingsSchema } from './settings.schema';

/** Mounted below /api/admin, so every route is ADMIN-only. */
export const adminSettingsRouter = Router();

adminSettingsRouter.get('/', controller.getSettings);
adminSettingsRouter.patch('/', validateBody(updateSalonSettingsSchema), controller.updateSettings);
