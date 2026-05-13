import rateLimit from 'express-rate-limit';
import { config } from '../config';

export const apiRateLimit = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max:      config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { success: false, error: 'Too many requests — please slow down', code: 'RATE_LIMITED' },
  skip: (req) => req.path === '/health',
});

export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max:      20,
  message:  { success: false, error: 'Too many auth attempts', code: 'AUTH_RATE_LIMITED' },
});

export const matchRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max:      10,
  message:  { success: false, error: 'Too many match requests', code: 'MATCH_RATE_LIMITED' },
});
