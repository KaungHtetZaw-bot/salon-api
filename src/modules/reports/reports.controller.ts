import type { NextFunction, Request, Response } from 'express';
import * as service from './reports.service';

const wrap =
  (fn: (req: Request) => Promise<unknown>) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = await fn(req);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  };

const q = (req: Request, name: string): string | undefined =>
  typeof req.query[name] === 'string' ? (req.query[name] as string) : undefined;

export const overview = wrap((req) => service.getOverview(q(req, 'from'), q(req, 'to')));

export const revenueSeries = wrap((req) =>
  service.getRevenueSeries(
    q(req, 'groupBy') === 'month' ? 'month' : 'day',
    q(req, 'from'),
    q(req, 'to'),
  ),
);

export const topServices = wrap((req) =>
  service.getTopServices(Number(req.query.limit ?? 10), q(req, 'from'), q(req, 'to')),
);

export const staffPerformance = wrap((req) =>
  service.getStaffPerformance(q(req, 'from'), q(req, 'to')),
);
