import type { NextFunction, Request, Response } from 'express';
import { HttpError } from '../utils/http';
import { logger } from '../utils/logger';
import { env } from '../config/env';

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: `No route for ${req.method} ${req.path}` });
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, details: err.details });
    return;
  }
  const message = err instanceof Error ? err.message : 'Unexpected error';
  logger.error('Unhandled error', err);
  res.status(500).json({
    error: env.isProd ? 'Something went wrong on our side' : message,
  });
}
