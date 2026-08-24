import type { NextFunction, Request, Response } from 'express';
import * as service from './staff.service';

const wrap =
  (
    fn: (req: Request) => Promise<unknown>,
    status = 200,
  ) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = await fn(req);
      res.status(status).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  };

// Public
export const listStaff = wrap(() => service.listStaff());
export const getStaff = wrap((req) => service.getStaff(String(req.params.id)));
export const listPortfolio = wrap((req) => service.listPortfolio(String(req.params.id)));

// Admin
export const adminListStaff = wrap(() => service.adminListStaff());
export const createStaff = wrap((req) => service.createStaff(req.body), 201);
export const updateStaff = wrap((req) => service.updateStaff(String(req.params.id), req.body));
export const replaceWorkingHours = wrap((req) =>
  service.replaceWorkingHours(String(req.params.id), req.body.hours),
);
export const addPortfolioItem = wrap(
  (req) => service.addPortfolioItem(String(req.params.id), req.body),
  201,
);
export const removePortfolioItem = wrap((req) =>
  service.removePortfolioItem(String(req.params.itemId)),
);
