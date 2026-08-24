import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { authLimiter } from '../../middleware/rateLimiter.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import * as controller from './auth.controller';
import { loginSchema, logoutSchema, refreshSchema, registerSchema } from './auth.schema';

export const authRouter = Router();

// Public — strict rate limiting against brute force
authRouter.post('/register', authLimiter, validateBody(registerSchema), controller.register);
authRouter.post('/login', authLimiter, validateBody(loginSchema), controller.login);
authRouter.post('/refresh', authLimiter, validateBody(refreshSchema), controller.refresh);

// Authenticated
authRouter.post('/logout', authenticate, validateBody(logoutSchema), controller.logout);
authRouter.get('/me', authenticate, controller.me);
