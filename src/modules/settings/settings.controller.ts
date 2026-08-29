import type { NextFunction, Request, Response } from 'express';
import * as service from './settings.service';

const wrap =
  (fn: (req: Request) => Promise<unknown>) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.json({ success: true, data: await fn(req) });
    } catch (error) {
      next(error);
    }
  };

export const getSettings = wrap(() => service.getSalonSettings());
export const updateSettings = wrap((req) => service.updateSalonSettings(req.body));
