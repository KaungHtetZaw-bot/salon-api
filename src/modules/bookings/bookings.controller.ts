import type { NextFunction, Request, Response } from 'express';
import * as service from './bookings.service';
import type { AuthenticatedUser } from '../../middleware/auth.middleware';

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

const user = (req: Request): NonNullable<AuthenticatedUser> => req.user!;

export const availability = wrap((req) =>
  service.getAvailability(
    String(req.query.serviceId),
    String(req.query.date),
    typeof req.query.staffId === 'string' ? req.query.staffId : undefined,
  ),
);

export const create = wrap((req) => service.createAppointment(user(req).id, req.body), 201);
export const listMine = wrap((req) =>
  service.listAppointments(user(req), {
    status: typeof req.query.status === 'string' ? req.query.status : undefined,
    date: typeof req.query.date === 'string' ? req.query.date : undefined,
  }),
);
export const detail = wrap((req) => service.getAppointmentDetail(user(req), String(req.params.id)));
export const cancel = wrap((req) =>
  service.cancelAppointment(user(req), String(req.params.id), req.body?.reason),
);
export const reschedule = wrap((req) =>
  service.rescheduleAppointment(user(req).id, String(req.params.id), req.body.scheduledFor),
);
export const walkIn = wrap((req) => service.addWalkIn(user(req), req.body), 201);
export const updateStatus = wrap((req) =>
  service.updateStatus(user(req), String(req.params.id), req.body),
);
export const schedule = wrap((req) =>
  service.getSchedule(
    user(req),
    String(req.query.date),
    typeof req.query.staffId === 'string' ? req.query.staffId : undefined,
  ),
);
