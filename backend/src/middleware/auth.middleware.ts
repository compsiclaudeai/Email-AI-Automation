import type { NextFunction, Request, Response } from 'express';
import { unauthorized } from '../utils/http';
import { verifyJwt } from '../modules/auth/auth.service';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

/** Reads the session cookie, falling back to a bearer header for API clients. */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const fromCookie = req.cookies?.ea_session as string | undefined;
  const header = req.headers.authorization;
  const fromHeader = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  const token = fromCookie ?? fromHeader;

  if (!token) return next(unauthorized());
  try {
    req.userId = verifyJwt(token).sub;
    next();
  } catch {
    next(unauthorized('Session expired — sign in again'));
  }
}
