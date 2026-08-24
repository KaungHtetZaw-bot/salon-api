import type { NextFunction, Request, Response } from 'express';
import type { AuthenticatedUser } from '../../middleware/auth.middleware';
import * as reviews from './reviews.service';
import * as loyalty from './loyalty.service';
import * as admin from './admin.service';

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

const pageOf = (req: Request): { page: number; pageSize: number } => ({
  page: Number(req.query.page ?? 1),
  pageSize: Number(req.query.pageSize ?? (req.path.includes('history') ? 20 : 10)),
});

// ────────────────────────── Reviews ──────────────────────────

export const listStaffReviews = wrap((req) =>
  reviews.listStaffReviews(String(req.params.staffId), pageOf(req).page, pageOf(req).pageSize),
);

export const createReview = wrap((req) => reviews.createReview(user(req).id, req.body), 201);
export const updateReview = wrap((req) =>
  reviews.updateOwnReview(user(req).id, String(req.params.id), req.body),
);
export const deleteReview = wrap(async (req) => {
  await reviews.deleteOwnReview(user(req).id, String(req.params.id));
  return { deleted: true };
});
export const replyToReview = wrap((req) =>
  reviews.replyToReview(user(req), String(req.params.id), req.body.reply),
);

// ────────────────────────── Loyalty ──────────────────────────

export const balance = wrap((req) => loyalty.getBalance(user(req).id));
export const history = wrap((req) => loyalty.getHistory(user(req).id, pageOf(req).page, pageOf(req).pageSize));
export const listRewards = wrap(() => loyalty.listRewards());
export const redeem = wrap((req) => loyalty.redeemReward(user(req).id, String(req.params.id)), 201);
export const myRedemptions = wrap((req) =>
  loyalty.myRedemptions(user(req).id, pageOf(req).page, pageOf(req).pageSize),
);
export const useVoucher = wrap((req) => loyalty.markVoucherUsed(user(req), String(req.params.id)));

// ────────────────────── Admin endpoints ──────────────────────

export const adjustPoints = wrap((req) => admin.adjustPoints(req.body), 201);
export const adminListRewards = wrap(() => admin.adminListRewards());
export const createReward = wrap((req) => admin.createReward(req.body), 201);
export const updateReward = wrap((req) => admin.updateReward(String(req.params.id), req.body));
export const deactivateReward = wrap((req) => admin.deactivateReward(String(req.params.id)));
