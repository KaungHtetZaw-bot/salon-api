import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate.middleware';
import * as controller from './engagement.controller';
import {
  adjustPointsSchema,
  createReviewSchema,
  createRewardSchema,
  idParamSchema,
  listReviewsQuerySchema,
  paginationQuerySchema,
  replyReviewSchema,
  staffIdParamSchema,
  updateReviewSchema,
  updateRewardSchema,
} from './engagement.schema';

const uuidParam = (name: string) =>
  z.object({ [name]: z.string().uuid('Invalid id format') });

// ────────────────────────── /reviews ─────────────────────────
export const reviewsRouter = Router();

// Public — browse a stylist's reviews
reviewsRouter.get(
  '/staff/:staffId',
  validateParams(staffIdParamSchema),
  validateQuery(listReviewsQuerySchema),
  controller.listStaffReviews,
);

// Authenticated — customers manage their own reviews; staff reply
reviewsRouter.use(authenticate);
reviewsRouter.post('/', validateBody(createReviewSchema), controller.createReview);
reviewsRouter.patch('/:id', validateParams(idParamSchema), validateBody(updateReviewSchema), controller.updateReview);
reviewsRouter.delete('/:id', validateParams(idParamSchema), controller.deleteReview);
reviewsRouter.post(
  '/:id/reply',
  requireRole('STAFF', 'ADMIN'),
  validateParams(idParamSchema),
  validateBody(replyReviewSchema),
  controller.replyToReview,
);

// ───────────────────────── /loyalty ──────────────────────────
export const loyaltyRouter = Router();
loyaltyRouter.use(authenticate);

loyaltyRouter.get('/balance', controller.balance);
loyaltyRouter.get('/history', validateQuery(paginationQuerySchema), controller.history);
loyaltyRouter.get('/rewards', controller.listRewards);
loyaltyRouter.post(
  '/rewards/:id/redeem',
  validateParams(uuidParam('id')),
  controller.redeem,
);
loyaltyRouter.get('/redemptions', validateQuery(paginationQuerySchema), controller.myRedemptions);
loyaltyRouter.patch(
  '/redemptions/:id/use',
  requireRole('STAFF', 'ADMIN'),
  validateParams(uuidParam('id')),
  controller.useVoucher,
);

// ─────────────── mounted under /api/admin (already guarded) ───────────────
export const adminEngagementRouter = Router();

adminEngagementRouter.get('/reviews', validateQuery(paginationQuerySchema), controller.adminListReviews);
adminEngagementRouter.post('/rewards', validateBody(createRewardSchema), controller.createReward);
adminEngagementRouter.get('/rewards', controller.adminListRewards);
adminEngagementRouter.patch(
  '/rewards/:id',
  validateParams(idParamSchema),
  validateBody(updateRewardSchema),
  controller.updateReward,
);
adminEngagementRouter.delete(
  '/rewards/:id',
  validateParams(idParamSchema),
  controller.deactivateReward,
);
adminEngagementRouter.post('/loyalty/adjust', validateBody(adjustPointsSchema), controller.adjustPoints);
