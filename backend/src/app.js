import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { attachAuth, csrfProtect, requireAuth } from './auth/middleware.js';
import { config } from './config.js';
import { errorHandler, notFoundHandler } from './errors.js';
import { adminRoutes } from './routes/admin.js';
import { adminIngestionRoutes } from './routes/adminIngestion.js';
import { authRoutes } from './routes/auth.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { mastersRoutes } from './routes/masters.js';
import { orgRoutes } from './routes/org.js';
import { publicRoutes } from './routes/public.js';
import { savedSearchRoutes, tendersRoutes } from './routes/tenders.js';

function buildLimiters(enabled) {
  const make = (limit, windowMs = 15 * 60 * 1000) =>
    enabled
      ? rateLimit({
          windowMs,
          limit,
          standardHeaders: 'draft-7',
          legacyHeaders: false,
          message: { error: { message: 'Too many requests. Please try again later.', code: 'rate_limited' } },
        })
      : (req, res, next) => next();
  return { login: make(20), passwordReset: make(10), enquiry: make(5) };
}

/**
 * @param {{db: Awaited<ReturnType<typeof import('./db/index.js').createDatabase>>,
 *          rateLimits?: boolean,
 *          makeTenderbookClient?: () => object,
 *          mount?: (api: import('express').Router, deps: object) => void}} options
 *   `makeTenderbookClient` lets tests replace the network client; `mount` attaches extra routers.
 */
export function createApp({ db, rateLimits = true, makeTenderbookClient, mount } = {}) {
  const app = express();
  app.disable('x-powered-by');
  if (config.isProd) app.set('trust proxy', 1);
  app.locals.db = db;

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: config.corsOrigins, credentials: true }));
  app.use(cookieParser());
  app.use(express.json({ limit: '1mb' }));

  const limiters = buildLimiters(rateLimits);
  const api = express.Router();

  api.get('/health', async (req, res) => {
    try {
      await db.health();
      res.json({ status: 'ok', time: new Date().toISOString() });
    } catch {
      res.status(503).json({ status: 'unavailable' });
    }
  });

  api.use('/public', publicRoutes({ limiters }));

  api.use(attachAuth(db));
  api.use(csrfProtect({ exempt: ['/auth/login', '/auth/forgot-password', '/auth/reset-password'] }));

  api.use('/auth', authRoutes({ limiters }));
  api.use('/org', orgRoutes());
  api.use('/masters', mastersRoutes());
  api.use('/tenders', tendersRoutes());
  api.use('/saved-searches', savedSearchRoutes());
  api.use('/dashboard', dashboardRoutes());
  api.use('/admin/ingestion', requireAuth, adminIngestionRoutes({ makeClient: makeTenderbookClient }));
  api.use('/admin', requireAuth, adminRoutes());
  mount?.(api, { db, limiters });

  app.use('/api/v1', api);
  app.use('/api', notFoundHandler);
  app.use(errorHandler);
  return app;
}

