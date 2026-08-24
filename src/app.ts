import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import swaggerUi from 'swagger-ui-express';
import { env, isDev } from './config/env';
import swaggerSpec from './config/swagger';
import { apiLimiter } from './middleware/rateLimiter.middleware';
import { errorHandler, notFoundHandler } from './middleware/error.middleware';
import { authRouter } from './modules/auth/auth.routes';

export function createApp(): express.Express {
  const app = express();

  // Security & parsing
  app.use(helmet());
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

  // API surface
  const api = express.Router();
  api.use(apiLimiter);

  api.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

  // Module routers
  api.use('/auth', authRouter);
  //   api.use('/catalog', catalogRouter)  ← phase 3
  //   api.use('/staff', staffRouter)      ← phase 3
  //   api.use('/bookings', bookingRouter) ← phase 4

  app.use('/api', api);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
