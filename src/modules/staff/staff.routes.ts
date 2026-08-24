import { Router } from 'express';
import { z } from 'zod';
import { validateBody, validateParams } from '../../middleware/validate.middleware';
import * as controller from './staff.controller';
import {
  createPortfolioItemSchema,
  createStaffSchema,
  idParamSchema,
  replaceWorkingHoursSchema,
  updateStaffSchema,
} from './staff.schema';

/** Customer-facing endpoints — no auth required */
export const publicStaffRouter = Router();

publicStaffRouter.get('/', controller.listStaff);
publicStaffRouter.get('/:id', validateParams(idParamSchema), controller.getStaff);
publicStaffRouter.get(
  '/:id/portfolio',
  validateParams(idParamSchema),
  controller.listPortfolio,
);

/** Admin management — mounted behind authenticate + requireRole('ADMIN') */
export const adminStaffRouter = Router();

const portfolioIdParamSchema = z.object({ itemId: z.string().uuid('Invalid id format') });

adminStaffRouter.get('/', controller.adminListStaff);
adminStaffRouter.post('/', validateBody(createStaffSchema), controller.createStaff);
adminStaffRouter.patch(
  '/:id',
  validateParams(idParamSchema),
  validateBody(updateStaffSchema),
  controller.updateStaff,
);
adminStaffRouter.put(
  '/:id/working-hours',
  validateParams(idParamSchema),
  validateBody(replaceWorkingHoursSchema),
  controller.replaceWorkingHours,
);

adminStaffRouter.post(
  '/:id/portfolio',
  validateParams(idParamSchema),
  validateBody(createPortfolioItemSchema),
  controller.addPortfolioItem,
);
adminStaffRouter.delete(
  '/portfolio/:itemId',
  validateParams(portfolioIdParamSchema),
  controller.removePortfolioItem,
);
