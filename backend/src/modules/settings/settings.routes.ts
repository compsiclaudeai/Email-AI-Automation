import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.middleware';
import { asyncHandler, badRequest, notFound } from '../../utils/http';
import { User } from '../../models/user.model';
import { Template } from '../../models/template.model';
import { record } from '../activity/activity.service';
import { Types } from 'mongoose';

const oid = (id: string) => {
  if (!Types.ObjectId.isValid(id)) throw badRequest('That is not a valid template id');
  return new Types.ObjectId(id);
};

export const settingsRouter = Router();
settingsRouter.use(requireAuth);

const CATEGORIES = ['invoice', 'support', 'hr', 'sales', 'marketing', 'spam', 'other'] as const;
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

const settingsSchema = z.object({
  autoReply: z.boolean().optional(),
  approvalMode: z.enum(['automatic', 'manual']).optional(),
  confidenceThreshold: z.number().min(0).max(100).optional(),
  tone: z.enum(['Professional', 'Friendly', 'Formal', 'Casual']).optional(),
  businessHoursEnabled: z.boolean().optional(),
  // The old /^\d{2}:\d{2}$/ accepted 99:99, which then silently disabled the
  // business-hours window because no clock reading is ever >= "99:99".
  businessHoursFrom: z.string().regex(HHMM, 'Use a 24-hour time such as 09:00').optional(),
  businessHoursTo: z.string().regex(HHMM, 'Use a 24-hour time such as 18:00').optional(),
  timezone: z
    .string()
    .max(64)
    .refine((tz) => {
      try {
        new Intl.DateTimeFormat('en-GB', { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, 'Unknown timezone')
    .optional(),
  signature: z.string().max(2000).optional(),
  enabledCategories: z.array(z.enum(CATEGORIES)).max(7).optional(),
  dailySendCap: z.number().int().min(0).max(5000).optional(),
  neverAutoSendMoney: z.boolean().optional(),
  neverAutoSendPersonalData: z.boolean().optional(),
  pauseAfterBounces: z.number().min(1).max(50).optional(),
  paused: z.boolean().optional(),
});

settingsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.userId);
    if (!user) throw notFound('User not found');
    res.json(user.settings);
  }),
);

settingsRouter.patch(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = settingsSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Invalid settings', parsed.error.flatten());

    const $set = Object.fromEntries(
      Object.entries(parsed.data).map(([k, v]) => [`settings.${k}`, v]),
    );
    const user = await User.findByIdAndUpdate(req.userId, { $set }, { new: true });
    if (!user) throw notFound('User not found');

    await record(req.userId!, 'settings_changed', 'Settings updated', Object.keys(parsed.data).join(', '));
    res.json(user.settings);
  }),
);

/* ------------------------------ templates ------------------------------ */

const templateSchema = z.object({
  name: z.string().min(2).max(120),
  category: z.enum(CATEGORIES),
  body: z.string().min(10).max(8000),
  active: z.boolean().optional(),
});

/** The source folder lives on the user, not inside settings. */
const mailboxSchema = z.object({ mailFolder: z.string().max(255) });

settingsRouter.patch(
  '/mailbox',
  asyncHandler(async (req, res) => {
    const parsed = mailboxSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Invalid folder', parsed.error.flatten());

    const folder = parsed.data.mailFolder.trim();
    const $set: Record<string, unknown> = { mailFolder: folder };
    const user = await User.findById(req.userId);
    if (!user) throw notFound('User not found');
    // IMAP keeps its own copy, because the provider is constructed from it.
    if (user.provider === 'imap' && user.imap) $set['imap.folder'] = folder || 'INBOX';

    const updated = await User.findByIdAndUpdate(req.userId, { $set }, { new: true });
    await record(req.userId!, 'settings_changed', 'Source folder changed', folder || 'Inbox');
    res.json({ mailFolder: updated?.mailFolder ?? '' });
  }),
);

settingsRouter.get(
  '/templates',
  asyncHandler(async (req, res) => {
    res.json(await Template.find({ userId: req.userId }).sort({ usageCount: -1 }).lean());
  }),
);

settingsRouter.post(
  '/templates',
  asyncHandler(async (req, res) => {
    const parsed = templateSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Invalid template', parsed.error.flatten());
    const doc = await Template.create({ ...parsed.data, userId: req.userId });
    res.status(201).json(doc);
  }),
);

settingsRouter.patch(
  '/templates/:id',
  asyncHandler(async (req, res) => {
    const parsed = templateSchema.partial().safeParse(req.body);
    if (!parsed.success) throw badRequest('Invalid template', parsed.error.flatten());
    const doc = await Template.findOneAndUpdate(
      { _id: oid(req.params.id), userId: req.userId },
      { $set: parsed.data },
      { new: true },
    );
    if (!doc) throw notFound('Template not found');
    res.json(doc);
  }),
);

settingsRouter.delete(
  '/templates/:id',
  asyncHandler(async (req, res) => {
    const doc = await Template.findOneAndDelete({ _id: oid(req.params.id), userId: req.userId });
    if (!doc) throw notFound('Template not found');
    res.json({ ok: true });
  }),
);
