import { Types, type FilterQuery } from 'mongoose';
import { Email, type EmailDoc, type EmailStatus } from '../../models/email.model';
import { User, type UserDoc } from '../../models/user.model';
import { Template } from '../../models/template.model';
import { providerFor } from '../../providers';
import { draftReply } from '../ai/ai.service';
import { isSendableAddress, replySubject, validateReplyBody } from '../ai/safety';
import { checkReplyLoop } from '../automation/loop-guard';
import { record } from '../activity/activity.service';
import { publish } from '../events/sse';
import { badRequest, forbidden, notFound } from '../../utils/http';
import { logger } from '../../utils/logger';
import { env } from '../../config/env';

export interface ListParams {
  status?: EmailStatus | 'all';
  category?: string;
  q?: string;
  page?: number;
  limit?: number;
}

/** Rejects a malformed id with a 400 instead of letting Mongoose throw a 500. */
function objectId(id: string, label = 'email'): Types.ObjectId {
  if (!Types.ObjectId.isValid(id)) throw badRequest(`That is not a valid ${label} id`);
  return new Types.ObjectId(id);
}

export async function list(userId: string, params: ListParams) {
  const { status = 'all', category, q, page = 1, limit = 30 } = params;

  const filter: FilterQuery<EmailDoc> = { userId: objectId(userId, 'user') };
  if (status !== 'all') filter.status = status;
  if (category) filter.category = category;
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ subject: rx }, { snippet: rx }, { fromName: rx }, { fromEmail: rx }];
  }

  const [items, total] = await Promise.all([
    Email.find(filter)
      .sort({ receivedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      // The full body and extracted attachment text are only needed on the
      // detail view; keeping them out of the list query is the difference
      // between a few KB and several MB on a busy mailbox.
      // Extracted text can be tens of KB per attachment and is only used by the
      // model, never by the list.
      .select('-body -thread -attachments.extractedText')
      .lean(),
    Email.countDocuments(filter),
  ]);

  return { items, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) };
}

export async function counts(userId: string) {
  const rows = await Email.aggregate<{ _id: EmailStatus; n: number }>([
    { $match: { userId: objectId(userId, 'user') } },
    { $group: { _id: '$status', n: { $sum: 1 } } },
  ]);

  const base: Record<string, number> = {
    all: 0,
    unread: 0,
    pending: 0,
    replied: 0,
    failed: 0,
    ignored: 0,
  };
  for (const r of rows) {
    if (r._id in base) base[r._id] = r.n;
    base.all += r.n;
  }
  return base;
}

export async function getOne(userId: string, id: string) {
  const email = await Email.findOne({ _id: objectId(id), userId: objectId(userId, 'user') }).lean();
  if (!email) throw notFound('Email not found');
  return email;
}

/** Opening an unread email moves it into the approval queue. */
export async function markOpened(userId: string, id: string) {
  const email = await Email.findOneAndUpdate(
    { _id: objectId(id), userId: objectId(userId, 'user'), status: 'unread' },
    { $set: { status: 'pending' } },
    { new: true },
  );
  if (email) return email.toObject();

  // Not unread (or already open) — return the current record rather than 404.
  return getOne(userId, id);
}

export async function saveDraft(userId: string, id: string, body: string) {
  const owner = await User.findById(objectId(userId, 'user')).lean();
  if (!owner) throw notFound('User not found');

  const existing = await Email.findOne({ _id: objectId(id), userId: owner._id });
  if (!existing) throw notFound('Email not found');
  if (existing.sendState === 'sent') {
    throw badRequest('This reply has already been sent and can no longer be edited');
  }

  // A human-written draft is still checked for header injection before it is
  // stored, because the same string is later handed to a mail provider.
  const checked = validateReplyBody(body, {
    recipient: existing.fromEmail,
    ownEmail: owner.email,
  });
  if (!checked.body) throw badRequest('The draft is empty');

  existing.aiReply = checked.body;
  existing.aiProblems = checked.problems;
  await existing.save();
  return existing.toObject();
}

export async function regenerate(userId: string, id: string) {
  const uid = objectId(userId, 'user');
  const [email, user] = await Promise.all([
    Email.findOne({ _id: objectId(id), userId: uid }),
    User.findById(uid),
  ]);
  if (!email || !user) throw notFound('Email not found');
  if (email.sendState !== 'idle') {
    throw badRequest('A reply is already being sent for this email');
  }

  const templates = await Template.find({ userId: uid, active: true }).limit(8).lean();
  const draft = await draftReply({
    fromName: email.fromName,
    fromEmail: email.fromEmail,
    subject: email.subject,
    body: email.body,
    ownEmail: user.email,
    settings: user.settings,
    templates: templates.map((t) => ({ name: t.name, category: t.category, body: t.body })),
    attachments: (email.attachments ?? []).map((a) => ({
      filename: a.filename,
      mimeType: a.mimeType,
      extractedText: a.extractedText,
      extractStatus: a.extractStatus,
      extractDetail: a.extractDetail,
    })),
  });

  applyDraft(email, draft);
  await email.save();

  await record(userId, 'ai_generated', 'AI generated reply', `Confidence ${draft.confidence}%`, id);
  publish(userId, 'email:updated', { id });
  return email.toObject();
}

/** Copies a draft result onto the record. Kept here so both callers agree. */
export function applyDraft(
  email: EmailDoc,
  draft: Awaited<ReturnType<typeof draftReply>>,
): void {
  email.aiReply = draft.reply;
  email.aiConfidence = draft.confidence;
  email.aiReason = draft.reason;
  email.aiModel = draft.model;
  email.aiGeneratedAt = new Date();
  email.aiInjectionSuspected = draft.injection;
  email.aiProblems = draft.problems;
  email.aiIsStub = draft.stub;
  email.category = draft.category;
  email.priority = draft.priority;
}

/* ------------------------------- sending -------------------------------- */

export interface SendOptions {
  overrideBody?: string;
  /** 'user' for an approve click, 'ai' for the automation. */
  actor?: 'ai' | 'user';
}

/**
 * Every deterministic check that must pass before a provider is called.
 *
 * The AI never decides any of this. The recipient is taken from the stored
 * email record, not from anything the model produced.
 */
async function assertSendable(user: UserDoc, email: EmailDoc, body: string): Promise<void> {
  if (!body.trim()) throw badRequest('There is no draft to send');

  if (!isSendableAddress(email.fromEmail)) {
    throw badRequest(`The stored sender address is not one deliverable address: ${email.fromEmail}`);
  }
  if (email.fromEmail.toLowerCase() === user.email.toLowerCase()) {
    throw forbidden('That email came from this mailbox — replying to it would loop');
  }

  // The loop guard runs again here, not only at draft time: settings can
  // change, and a draft can sit in the queue for hours before approval.
  const [repliesInThread, repliesToSender] = await Promise.all([
    Email.countDocuments({
      userId: user._id,
      threadId: email.threadId,
      sendState: 'sent',
      _id: { $ne: email._id },
    }),
    Email.countDocuments({
      userId: user._id,
      fromEmail: email.fromEmail,
      sendState: 'sent',
      sentAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    }),
  ]);

  const loop = checkReplyLoop({
    fromEmail: email.fromEmail,
    subject: email.subject,
    toEmail: email.toEmail,
    ownEmail: user.email,
    repliesAlreadySent: repliesInThread,
    repliesToSenderRecently: repliesToSender,
  });
  if (loop.block) throw forbidden(loop.reason);

  const cap = user.settings.dailySendCap ?? env.limits.dailySendCap;
  if (cap > 0) {
    const sentToday = await Email.countDocuments({
      userId: user._id,
      sendState: 'sent',
      sentAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    });
    if (sentToday >= cap) {
      throw forbidden(`Daily send limit of ${cap} replies reached — nothing more will go out today`);
    }
  }
}

/**
 * Approves the current draft and sends it through the user's mail provider.
 *
 * Sending is idempotent. The email is claimed with a single atomic update
 * (idle -> sending); a second concurrent call finds nothing to claim and
 * returns without touching the provider. A crashed worker's claim expires
 * after SEND_LOCK_MS so the message is not stuck forever.
 */
export async function approveAndSend(userId: string, id: string, options: SendOptions = {}) {
  const uid = objectId(userId, 'user');
  const emailId = objectId(id);
  const actor = options.actor ?? 'user';

  const user = await User.findById(uid);
  if (!user) throw notFound('User not found');

  const current = await Email.findOne({ _id: emailId, userId: uid });
  if (!current) throw notFound('Email not found');

  if (current.sendState === 'sent') {
    // Not an error: a double-click, a retried job and a re-delivered webhook
    // all land here, and all of them mean "already done".
    logger.info(`Send skipped for ${id} — already sent`);
    return current.toObject();
  }

  const body = (options.overrideBody ?? current.aiReply ?? '').trim();
  await assertSendable(user, current, body);

  const staleBefore = new Date(Date.now() - env.limits.sendLockMs);

  // The claim. Only one caller can win this.
  const claimed = await Email.findOneAndUpdate(
    {
      _id: emailId,
      userId: uid,
      $or: [
        { sendState: 'idle' },
        { sendState: 'sending', sendLockAt: { $lt: staleBefore } },
      ],
    },
    { $set: { sendState: 'sending', sendLockAt: new Date() } },
    { new: true },
  );

  if (!claimed) {
    logger.warn(`Send already in flight for ${id} — this call is a duplicate and was dropped`);
    return current.toObject();
  }

  const signed = user.settings.signature ? `${body}\n\n${user.settings.signature}` : body;

  try {
    const provider = await providerFor(userId);
    const sent = await provider.sendReply({
      to: claimed.fromEmail,
      subject: replySubject(claimed.subject),
      body: signed,
      threadId: claimed.threadId,
      inReplyTo: claimed.externalId,
    });

    claimed.aiReply = body;
    claimed.status = 'replied';
    claimed.sendState = 'sent';
    claimed.sendLockAt = undefined;
    claimed.sentMessageId = sent.externalId;
    claimed.sentBy = actor;
    claimed.sentAt = new Date();
    claimed.failureReason = undefined;
    claimed.approvedBy = actor === 'user' ? uid : undefined;
    claimed.responseTimeMs = Date.now() - claimed.receivedAt.getTime();
    claimed.thread.push({
      from: user.email,
      fromName: user.name,
      outbound: true,
      body: signed,
      sentAt: new Date(),
    });
    await claimed.save();

    await record(
      userId,
      'email_sent',
      actor === 'ai' ? 'Reply auto-sent by automation' : 'Reply sent after approval',
      `${claimed.fromEmail} · ${claimed.subject}`,
      id,
    );
    publish(userId, 'email:updated', { id, status: 'replied' });
  } catch (e) {
    const reason = e instanceof Error ? e.message : 'Unknown send failure';

    // Release the claim so a deliberate retry can run, but leave the record
    // marked failed so nothing retries it automatically.
    claimed.status = 'failed';
    claimed.sendState = 'idle';
    claimed.sendLockAt = undefined;
    claimed.failureReason = reason;
    claimed.retryCount += 1;
    await claimed.save();

    logger.error(`Send failed for email ${id}: ${reason}`);
    await record(userId, 'delivery_failed', 'Delivery failed', reason, id);
    publish(userId, 'email:updated', { id, status: 'failed' });
    throw e;
  }

  return claimed.toObject();
}

/**
 * Rewrites every draft that came from the offline stub.
 *
 * The recovery path for an AI outage: emails drafted while the model was
 * unreachable keep a canned template that the automation will not touch on its
 * own, so after the model is fixed this replaces them in one pass.
 */
export async function regenerateStubDrafts(userId: string, max = 100) {
  const uid = objectId(userId, 'user');
  const stale = await Email.find({
    userId: uid,
    aiIsStub: true,
    sendState: { $ne: 'sent' },
    status: { $in: ['unread', 'pending', 'failed'] },
  })
    .sort({ receivedAt: -1 })
    .limit(max)
    .select('_id')
    .lean();

  let rewritten = 0;
  let failed = 0;
  for (const e of stale) {
    try {
      await regenerate(userId, e._id.toString());
      rewritten += 1;
    } catch (err) {
      failed += 1;
      logger.warn(
        `Could not regenerate ${e._id.toString()}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  if (rewritten) {
    await record(userId, 'ai_generated', 'Stub drafts rewritten', `${rewritten} redrafted`);
  }
  return { found: stale.length, rewritten, failed };
}

export async function reject(userId: string, id: string) {
  const email = await Email.findOneAndUpdate(
    { _id: objectId(id), userId: objectId(userId, 'user'), sendState: { $ne: 'sent' } },
    { $set: { status: 'pending', aiReason: 'Draft rejected — regenerate or write a manual reply.' } },
    { new: true },
  );
  if (!email) throw notFound('Email not found, or its reply has already been sent');
  await record(userId, 'reply_rejected', 'Draft rejected', email.subject, id);
  publish(userId, 'email:updated', { id, status: 'pending' });
  return email.toObject();
}

/**
 * Retries failed sends one at a time.
 *
 * Serial on purpose: firing them in parallel meant a rate-limited provider
 * failed most of the batch, and every failure incremented retryCount without
 * anything actually going out.
 */
export async function retryFailed(userId: string, max = 25) {
  const failed = await Email.find({
    userId: objectId(userId, 'user'),
    status: 'failed',
    sendState: { $ne: 'sent' },
  })
    .sort({ receivedAt: -1 })
    .limit(max)
    .select('_id')
    .lean();

  let sent = 0;
  let stillFailing = 0;
  const errors: string[] = [];

  for (const e of failed) {
    try {
      await approveAndSend(userId, e._id.toString(), { actor: 'user' });
      sent += 1;
    } catch (err) {
      stillFailing += 1;
      const message = err instanceof Error ? err.message : 'Unknown error';
      if (!errors.includes(message)) errors.push(message);
    }
  }

  return { attempted: failed.length, sent, stillFailing, errors: errors.slice(0, 3) };
}
