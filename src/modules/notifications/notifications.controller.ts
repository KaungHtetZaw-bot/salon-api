import type { NextFunction, Request, Response } from 'express';
import * as service from './notifications.service';
import type { RegisterDeviceInput } from './notifications.schema';

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

export const registerDevice = wrap(
  (req) => service.registerDevice(req.user!.id, req.body as RegisterDeviceInput),
  201,
);
export const removeDevice = wrap((req) =>
  service.removeDevice(req.user!.id, String(req.body.fcmToken)),
);
export const listDevices = wrap((req) => service.listDevices(req.user!.id));
export const listNotifications = wrap((req) =>
  service.listNotifications(req.user!.id, Number(req.query.page ?? 1), Number(req.query.pageSize ?? 20)),
);
export const markRead = wrap((req) => service.markRead(req.user!.id, String(req.params.id)));
export const markAllRead = wrap((req) => service.markAllRead(req.user!.id));
