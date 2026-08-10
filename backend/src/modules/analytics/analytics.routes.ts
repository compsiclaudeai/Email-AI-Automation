import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import { asyncHandler } from '../../utils/http';
import { z } from 'zod';
import { kpis, overview } from './analytics.service';
import { badRequest } from '../../utils/http';

// Number(undefined) is NaN, and Math.min/Math.max propagate it: `days` used to
// reach Mongo as NaN, which builds an Invalid Date and throws a 500.
const daysQuery = z.object({ days: z.coerce.number().int().min(1).max(90).default(14) });

export const analyticsRouter = Router();
analyticsRouter.use(requireAuth);

analyticsRouter.get(
  '/kpis',
  asyncHandler(async (req, res) => {
    res.json(await kpis(req.userId!));
  }),
);

analyticsRouter.get(
  '/overview',
  asyncHandler(async (req, res) => {
    const parsed = daysQuery.safeParse(req.query);
    if (!parsed.success) throw badRequest('days must be a whole number between 1 and 90');
    res.json(await overview(req.userId!, parsed.data.days));
  }),
);
