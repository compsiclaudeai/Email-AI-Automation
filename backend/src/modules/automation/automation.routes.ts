import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.middleware';
import { asyncHandler, badRequest, notFound } from '../../utils/http';
import { env } from '../../config/env';
import { User } from '../../models/user.model';
import { Email } from '../../models/email.model';
import { runAutomation, syncMailbox } from './automation.service';
import { aiHealth } from '../ai/ai.service';
import { record } from '../activity/activity.service';

export const automationRouter = Router();
automationRouter.use(requireAuth);

automationRouter.get(
  '/status',
  asyncHandler(async (req, res) => {
    const userId = new Types.ObjectId(req.userId!);
    const user = await User.findById(userId);
    // A missing user used to leave `$match: { userId: undefined }` in the
    // aggregate, which is not the same query as "this user's rows".
    if (!user) throw notFound('User not found');

    const since = new Date();
    since.setHours(0, 0, 0, 0);
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [queued, sentToday, autoToday, replied, failed, sentLast24h, avg] = await Promise.all([
      Email.countDocuments({ userId, status: 'pending' }),
      Email.countDocuments({ userId, status: 'replied', sentAt: { $gte: since } }),
      Email.countDocuments({ userId, sentBy: 'ai', sentAt: { $gte: since } }),
      Email.countDocuments({ userId, status: 'replied' }),
      Email.countDocuments({ userId, status: 'failed' }),
      Email.countDocuments({ userId, sendState: 'sent', sentAt: { $gte: dayAgo } }),
      Email.aggregate<{ ms: number; conf: number }>([
        { $match: { userId, responseTimeMs: { $ne: null } } },
        { $group: { _id: null, ms: { $avg: '$responseTimeMs' }, conf: { $avg: '$aiConfidence' } } },
      ]),
    ]);

    const total = replied + failed;
    const cap = user.settings.dailySendCap ?? env.limits.dailySendCap;

    res.json({
      running: !user.settings.paused && user.settings.autoReply,
      paused: user.settings.paused,
      aiConfidence: Math.round(avg[0]?.conf ?? 0),
      queued,
      repliedToday: sentToday,
      autoRepliedToday: autoToday,
      failed,
      averageReplySeconds: Math.round((avg[0]?.ms ?? 0) / 1000),
      successRate: total ? Math.round((replied / total) * 100) : 100,
      lastSyncAt: user.lastSyncAt ?? null,
      mailFolder: user.mailFolder ?? user.imap?.folder ?? '',
      // Surfaced so the dashboard can say plainly that no model is configured
      // rather than presenting stub templates as AI output.
      aiConfigured: !env.openai.mock,
      // The actual reason drafting is falling back, not just whether a key is set.
      ai: aiHealth(),
      dailySendCap: cap,
      sentLast24h,
      capReached: cap > 0 && sentLast24h >= cap,
    });
  }),
);

automationRouter.post(
  '/run',
  asyncHandler(async (req, res) => {
    res.json(await runAutomation(req.userId!));
  }),
);

const syncBody = z.object({ folder: z.string().max(255).optional() });

automationRouter.post(
  '/sync',
  asyncHandler(async (req, res) => {
    const parsed = syncBody.safeParse(req.body ?? {});
    if (!parsed.success) throw badRequest('Invalid folder', parsed.error.flatten());
    // Undefined means "use whatever the account has configured", resolved
    // inside syncMailbox rather than defaulting to the inbox here.
    res.json(await syncMailbox(req.userId!, parsed.data.folder));
  }),
);

automationRouter.post(
  '/pause',
  asyncHandler(async (req, res) => {
    await User.findByIdAndUpdate(req.userId, { $set: { 'settings.paused': true } });
    await record(req.userId!, 'settings_changed', 'Automation paused');
    res.json({ paused: true });
  }),
);

automationRouter.post(
  '/resume',
  asyncHandler(async (req, res) => {
    await User.findByIdAndUpdate(req.userId, { $set: { 'settings.paused': false } });
    await record(req.userId!, 'settings_changed', 'Automation resumed');
    res.json({ paused: false });
  }),
);

/** Grouped hints the dashboard shows in the AI suggestions card. */
automationRouter.get(
  '/suggestions',
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const [invoices, complaints, hr, lowConfidence, stale] = await Promise.all([
      Email.countDocuments({ userId, category: 'invoice', status: { $in: ['unread', 'pending'] } }),
      Email.countDocuments({ userId, category: 'support', priority: 'high', status: 'pending' }),
      Email.countDocuments({ userId, category: 'hr', status: 'pending' }),
      Email.countDocuments({ userId, status: 'pending', aiConfidence: { $lt: 75 } }),
      Email.countDocuments({
        userId,
        status: 'replied',
        sentAt: { $lt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000) },
      }),
    ]);

    res.json([
      { key: 'invoice', count: invoices, title: 'Invoice emails detected', detail: 'Payment advices matched to open invoices.' },
      { key: 'complaint', count: complaints, title: 'Complaints need attention', detail: 'High-priority support threads waiting.' },
      { key: 'hr', count: hr, title: 'HR inquiries waiting', detail: 'These involve personal data and never auto-send.' },
      { key: 'followup', count: stale, title: 'Follow-up reminders due', detail: 'Sent over five days ago with no customer reply.' },
      { key: 'lowconf', count: lowConfidence, title: 'Low-confidence replies to approve', detail: 'Approving these teaches the model your tone.' },
    ]);
  }),
);
