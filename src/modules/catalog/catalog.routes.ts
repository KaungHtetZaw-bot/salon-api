import { Router } from 'express';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate.middleware';
import * as controller from './catalog.controller';
import {
  createCategorySchema,
  createServiceSchema,
  idParamSchema,
  listServicesQuerySchema,
  updateCategorySchema,
  updateServiceSchema,
} from './catalog.schema';

/** Customer-facing endpoints — no auth required */
export const publicCatalogRouter = Router();

publicCatalogRouter.get('/categories', controller.listCategories);
publicCatalogRouter.get(
  '/services',
  validateQuery(listServicesQuerySchema),
  controller.listServices,
);

/** Admin management — mounted behind authenticate + requireRole('ADMIN') */
export const adminCatalogRouter = Router();

adminCatalogRouter.post('/categories', validateBody(createCategorySchema), controller.createCategory);
adminCatalogRouter.patch(
  '/categories/:id',
  validateParams(idParamSchema),
  validateBody(updateCategorySchema),
  controller.updateCategory,
);
adminCatalogRouter.delete(
  '/categories/:id',
  validateParams(idParamSchema),
  controller.deactivateCategory,
);

adminCatalogRouter.get('/services', controller.adminListServices);
adminCatalogRouter.post('/services', validateBody(createServiceSchema), controller.createService);
adminCatalogRouter.patch(
  '/services/:id',
  validateParams(idParamSchema),
  validateBody(updateServiceSchema),
  controller.updateService,
);
adminCatalogRouter.delete(
  '/services/:id',
  validateParams(idParamSchema),
  controller.deactivateService,
);
