import type { NextFunction, Request, Response } from 'express';
import * as service from './catalog.service';

const wrap =
  (fn: (req: Request) => Promise<unknown>, status = 200) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = await fn(req);
      res.status(status).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  };

// Public
export const listCategories = wrap(() => service.listCategories());
export const listServices = wrap((req) =>
  service.listServices(
    typeof req.query.categoryId === 'string' ? req.query.categoryId : undefined,
  ),
);

// Admin
export const createCategory = wrap((req) => service.createCategory(req.body), 201);
export const updateCategory = wrap((req) => service.updateCategory(String(req.params.id), req.body));
export const deactivateCategory = wrap((req) => service.deactivateCategory(String(req.params.id)));

export const adminListServices = wrap(() => service.adminListServices());
export const createService = wrap((req) => service.createService(req.body), 201);
export const updateService = wrap((req) => service.updateService(String(req.params.id), req.body));
export const deactivateService = wrap((req) => service.deactivateService(String(req.params.id)));
