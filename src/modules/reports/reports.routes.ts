import { Router } from 'express';
import { validateQuery } from '../../middleware/validate.middleware';
import * as controller from './reports.controller';
import {
  reportRangeQuerySchema,
  revenueQuerySchema,
  topServicesQuerySchema,
} from './reports.schema';

// Mounted under /api/admin — authenticate + requireRole('ADMIN') already applied.
export const reportsRouter = Router();

reportsRouter.get('/overview', validateQuery(reportRangeQuerySchema), controller.overview);
reportsRouter.get('/revenue', validateQuery(revenueQuerySchema), controller.revenueSeries);
reportsRouter.get('/top-services', validateQuery(topServicesQuerySchema), controller.topServices);
reportsRouter.get('/staff-performance', validateQuery(reportRangeQuerySchema), controller.staffPerformance);
