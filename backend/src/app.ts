import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { env } from './config/env';
import { authRouter, authLimiter } from './modules/auth/auth.routes';
import { emailsRouter } from './modules/emails/emails.routes';
import { automationRouter } from './modules/automation/automation.routes';
import { rulesRouter } from './modules/automation/rules.routes';
import { analyticsRouter } from './modules/analytics/analytics.routes';
import { settingsRouter } from './modules/settings/settings.routes';
import { activityRouter } from './modules/activity/activity.routes';
import { eventsRouter } from './modules/events/sse';
import { errorHandler, notFoundHandler } from './middleware/error.middleware';
import { logger } from './utils/logger';

export function createApp() {
  const app = express();

  // Exactly one proxy hop (Render, Railway, nginx). Trusting every hop would
  // let a client spoof X-Forwarded-For and walk straight past the rate limiter.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      // The API returns JSON only; a strict policy costs nothing here.
      contentSecurityPolicy: {
        directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );

  app.use(
    cors({
      origin(origin, callback) {
        // Same-origin and server-to-server calls arrive with no Origin header.
        if (!origin) return callback(null, true);
        if (env.corsOrigins.includes(origin)) return callback(null, true);
        logger.warn(`Blocked cross-origin request from ${origin}`);
        // `false`, not an Error. Passing an Error hands the rejection to the
        // error handler, which turns a browser policy decision into a 500 and
        // a stack trace in the logs. Returning false simply withholds the
        // Access-Control-Allow-Origin header — the browser then blocks the
        // response, which is exactly what should happen.
        return callback(null, false);
      },
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    }),
  );

  app.use(express.json({ limit: '256kb' }));
  app.use(cookieParser());

  if (!env.isProd) {
    app.use(morgan('dev'));
  } else {
    // Query strings can carry a search term, which on this product means email
    // content. Only the path is logged in production.
    // originalUrl, not path: Express rewrites req.url when a request enters a
    // mounted router, so `path` logs `/logout` for `/api/auth/logout`. The
    // query string is still dropped — on this product it can carry email text.
    morgan.token('cleanpath', (req) => (req as express.Request).originalUrl.split('?')[0]);
    app.use(morgan(':method :cleanpath :status :response-time ms'));
  }

  app.use(
    '/api',
    rateLimit({
      windowMs: 60_000,
      limit: 300,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { error: 'Too many requests — slow down for a moment' },
    }),
  );

  // Password sign-in and the OAuth entry points get their own, much tighter
  // budget: 300/min is a brute-force allowance on a login endpoint.
  app.use('/api/auth', authLimiter);

  app.get('/health', (_req, res) =>
    res.json({ ok: true, env: env.nodeEnv, time: new Date().toISOString() }),
  );

  app.use('/api/auth', authRouter);
  app.use('/api/emails', emailsRouter);
  // Declared before the automation router so /api/automation/rules is never
  // swallowed by a broader route.
  app.use('/api/automation/rules', rulesRouter);
  app.use('/api/automation', automationRouter);
  app.use('/api/analytics', analyticsRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/activity', activityRouter);
  app.use('/api/events', eventsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
