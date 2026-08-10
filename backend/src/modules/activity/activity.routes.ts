import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import { asyncHandler } from '../../utils/http';
import { z } from 'zod';
import { recent } from './activity.service';
import { badRequest } from '../../utils/http';

const limitQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) });

export const activityRouter = Router();

activityRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    // A non-numeric ?limit used to reach Mongoose as NaN and throw.
    const parsed = limitQuery.safeParse(req.query);
    if (!parsed.success) throw badRequest('limit must be a whole number between 1 and 100');
    res.json(await recent(req.userId!, parsed.data.limit));
  }),
);
