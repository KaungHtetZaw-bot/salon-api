import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import swaggerUi from 'swagger-ui-express';
import { env, isDev } from './config/env';
import { prisma } from './config/prisma';
import swaggerSpec from './config/swagger';
import { apiLimiter } from './middleware/rateLimiter.middleware';
import { errorHandler, notFoundHandler } from './middleware/error.middleware';
import { authenticate, requireRole } from './middleware/auth.middleware';
import { authRouter } from './modules/auth/auth.routes';
import {
  adminCatalogRouter,
  publicCatalogRouter,
} from './modules/catalog/catalog.routes';
import { adminStaffRouter, publicStaffRouter } from './modules/staff/staff.routes';
import { bookingsRouter } from './modules/bookings/bookings.routes';
import { reportsRouter } from './modules/reports/reports.routes';
import {
  adminEngagementRouter,
  loyaltyRouter,
  reviewsRouter,
} from './modules/engagement/engagement.routes';
import { notificationsRouter } from './modules/notifications/notifications.routes';
import { adminSettingsRouter } from './modules/settings/settings.routes';

export function createApp(): express.Express {
  const app = express();

  // Behind nginx/ALB/etc: trust one proxy hop so rate limiting sees real IPs.
  if (env.TRUST_PROXY) {
    app.set('trust proxy', 1);
  }

  // Security & parsing
  app.use(helmet());
  app.use(compression());
  app.use(
    cors({
      origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(','),
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));

  if (isDev) {
    app.use(morgan('dev'));
  }

  // Liveness probe — no DB dependency
  app.get('/health', (_req, res) => {
    res.json({
      success: true,
      status: 'ok',
      service: 'salon-shop-api',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });

  // Readiness probe — verifies the database connection for orchestrators
  app.get('/health/ready', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ success: true, status: 'ready', database: 'up' });
    } catch {
      res.status(503).json({ success: false, status: 'degraded', database: 'down' });
    }
  });

  // API surface
  const api = express.Router();
  api.use(apiLimiter);

  // Machine-readable OpenAPI document + interactive UI
  api.get('/docs/json', (_req, res) => {
    res.json(swaggerSpec);
  });
  api.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

  // Module routers
  api.use('/auth', authRouter);

  // Public browsing
  api.use('/catalog', publicCatalogRouter);
  api.use('/staff', publicStaffRouter);

  // Admin — every route below requires a valid ADMIN token
  const adminApi = express.Router();
  adminApi.use(authenticate, requireRole('ADMIN'));
  adminApi.use('/catalog', adminCatalogRouter);
  adminApi.use('/staff', adminStaffRouter);
  adminApi.use('/settings', adminSettingsRouter);
  adminApi.use(adminEngagementRouter);
  adminApi.use('/reports', reportsRouter);
  api.use('/admin', adminApi);

  api.use('/bookings', bookingsRouter);
  api.use('/reviews', reviewsRouter);
  api.use('/loyalty', loyaltyRouter);
  api.use('/notifications', notificationsRouter);

  app.use('/api', api);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export default createApp();
