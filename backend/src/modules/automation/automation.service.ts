import { Types } from 'mongoose';
import { Email, type EmailDoc } from '../../models/email.model';
import { Template } from '../../models/template.model';
import { User, type AutomationSettings, type UserDoc } from '../../models/user.model';
import { providerFor } from '../../providers';
import { draftReply } from '../ai/ai.service';
import { extractText } from '../ai/extract.service';
import { checkReplyLoop } from './loop-guard';
import { Rule } from '../../models/rule.model';
import { evaluateRules, toEvaluationInput } from './rules.service';
import { record } from '../activity/activity.service';
import { publish } from '../events/sse';
import { applyDraft, approveAndSend } from '../emails/emails.service';
import { logger } from '../../utils/logger';
import { env } from '../../config/env';
import type { MailProvider, FetchedAttachment } from '../../providers';

/* --------------------------- safety rails ------------------------------ */

const MONEY = /\b(refund|credit note|discount|price|pricing|quote|quotation|invoice amount|payment of|PKR|USD|\$|£|€)\b/i;
const PERSONAL = /\b(cnic|passport|salary|payslip|medical|reference check|employment record|date of birth|national id)\b/i;

export interface GateResult {
  send: boolean;
  reason: string;
}

export interface GateInput {
  confidence: number;
  category: string;
  body: string;
  now?: Date;
  /** True when the email tried to give the AI instructions. */
  injection?: boolean;
  /** True when the draft came from the offline stub rather than a model. */
  stub?: boolean;
  /** Anything deterministic validation objected to. */
  problems?: string[];
}

/**
 * Decides whether a draft may go out with no human in the loop.
 *
 * Ordered cheapest-and-most-absolute first. Every branch returns a sentence
 * that is shown to the user verbatim, so the reason a reply is sitting in the
 * queue is never a mystery.
 */
export function gate(settings: AutomationSettings, input: GateInput): GateResult {
  const { category, body, now = new Date() } = input;

  // Confidence is never trusted as a number without checking it: a model that
  // returns "high" would otherwise produce NaN, and `NaN < threshold` is false,
  // which would let a completely unscored draft through the threshold check.
  const confidence = Number.isFinite(input.confidence) ? input.confidence : 0;

  if (settings.paused) return { send: false, reason: 'Automation is paused.' };
  if (!settings.autoReply) return { send: false, reason: 'Auto reply is switched off.' };

  if (input.injection) {
    return {
      send: false,
      reason: 'This email tried to give the AI instructions — never auto-sent, always reviewed.',
    };
  }
  if (input.problems?.length) {
    return { send: false, reason: `Held by validation: ${input.problems[0]}` };
  }
  if (input.stub) {
    return {
      send: false,
      reason: 'No AI model is configured, so this is a canned template — it needs a human.',
    };
  }

  if (settings.approvalMode === 'manual') return { send: false, reason: 'Manual approval mode.' };
  if (!settings.enabledCategories.includes(category))
    return { send: false, reason: `The ${category} category is not enabled for automation.` };
  if (confidence < settings.confidenceThreshold)
    return {
      send: false,
      reason: `Confidence ${confidence}% is under the ${settings.confidenceThreshold}% threshold.`,
    };
  if (settings.neverAutoSendMoney && MONEY.test(body))
    return { send: false, reason: 'Draft mentions money — held by a safety rail.' };
  if (settings.neverAutoSendPersonalData && PERSONAL.test(body))
    return { send: false, reason: 'Draft touches personal data — held by a safety rail.' };
  if (settings.businessHoursEnabled && !withinBusinessHours(settings, now))
    return { send: false, reason: 'Outside business hours — queued until the next working window.' };

  return { send: true, reason: 'Cleared every rail and the confidence threshold.' };
}

/**
 * Business-hours check in the account's own timezone.
 *
 * Handles a window that crosses midnight (22:00 to 06:00), which a plain
 * `from <= now <= to` comparison gets exactly backwards.
 */
export function withinBusinessHours(settings: AutomationSettings, now: Date): boolean {
  let current: string;
  try {
    current = new Intl.DateTimeFormat('en-GB', {
      timeZone: settings.timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(now);
  } catch {
    // An invalid timezone string must not take the automation down with it.
    logger.warn(`Unknown timezone "${settings.timezone}" — falling back to UTC`);
    current = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'UTC',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(now);
  }

  const from = settings.businessHoursFrom;
  const to = settings.businessHoursTo;
  if (from === to) return true;
  if (from < to) return current >= from && current <= to;
  return current >= from || current <= to; // window wraps past midnight
}

/* ------------------------------ locking --------------------------------- */

const LOCK_MS = 5 * 60 * 1000;

/** Claims a per-user lock. Returns false when someone else already holds it. */
async function claimLock(userId: string, field: 'automationLockAt' | 'syncLockAt'): Promise<boolean> {
  const stale = new Date(Date.now() - LOCK_MS);
  const claimed = await User.findOneAndUpdate(
    {
      _id: new Types.ObjectId(userId),
      $or: [{ [field]: { $exists: false } }, { [field]: null }, { [field]: { $lt: stale } }],
    },
    { $set: { [field]: new Date() } },
    { new: true },
  );
  return Boolean(claimed);
}

async function releaseLock(userId: string, field: 'automationLockAt' | 'syncLockAt'): Promise<void> {
  await User.findByIdAndUpdate(userId, { $unset: { [field]: 1 } });
}

/* ------------------------------ pipeline ------------------------------- */

export interface RunResult {
  scanned: number;
  /** Emails where at least one rule matched. */
  ruleMatches: number;
  drafted: number;
  /** Drafts replaced because the stored one came from the offline stub. */
  redrafted: number;
  autoSent: number;
  heldForApproval: number;
  ignored: number;
  failed: number;
  skipped?: string;
}

/**
 * Drafts a reply for every email that still needs one, then sends the ones
 * the gate clears. Emails without a draft-worthy category are left alone.
 *
 * Guarded by a per-user lock: the cron loop and a person clicking "Run
 * automation" used to be able to run this concurrently, which drafted twice
 * and could send twice.
 */
export async function runAutomation(userId: string): Promise<RunResult> {
  const empty: RunResult = {
    scanned: 0, ruleMatches: 0, drafted: 0, redrafted: 0, autoSent: 0, heldForApproval: 0, ignored: 0, failed: 0,
  };

  if (!(await claimLock(userId, 'automationLockAt'))) {
    logger.info(`Automation already running for ${userId} — this run was skipped`);
    return { ...empty, skipped: 'An automation run is already in progress.' };
  }

  try {
    return await runAutomationLocked(userId);
  } finally {
    await releaseLock(userId, 'automationLockAt');
  }
}

async function runAutomationLocked(userId: string): Promise<RunResult> {
  const uid = new Types.ObjectId(userId);
  const user = await User.findById(uid);
  if (!user) throw new Error('User not found');

  const pending = await Email.find({
    userId: uid,
    status: { $in: ['unread', 'pending'] },
    sendState: 'idle',
  })
    .sort({ receivedAt: -1 })
    .limit(env.limits.automationBatch);

  const templates = await Template.find({ userId: uid, active: true }).limit(8).lean();
  // Loaded once per run rather than once per email.
  const rules = await Rule.find({ userId: uid, enabled: true })
    .sort({ priority: 1, createdAt: 1 })
    .limit(200)
    .lean();

  const result: RunResult = {
    scanned: pending.length,
    ruleMatches: 0,
    drafted: 0,
    redrafted: 0,
    autoSent: 0,
    heldForApproval: 0,
    ignored: 0,
    failed: 0,
  };

  for (const email of pending) {
    try {
      const handled = await processOne(email, user, templates, rules, result);
      if (!handled) continue;
    } catch (e) {
      result.failed += 1;
      // The email itself is never logged — only its id and the failure.
      logger.error(
        `Automation failed on email ${email._id.toString()}: ${e instanceof Error ? e.message : e}`,
      );
      email.status = 'pending';
      email.aiReason = 'The automation hit an error on this email. It is waiting for a human.';
      await email.save().catch(() => undefined);
    }
  }

  await record(
    userId,
    'automation_run',
    'Automation run finished',
    `${result.autoSent} sent · ${result.heldForApproval} held · ${result.ignored} filed`,
  );
  publish(userId, 'automation:run', result);
  return result;
}

/** Returns true when the email reached a terminal state in this pass. */
async function processOne(
  email: EmailDoc,
  user: UserDoc,
  templates: { name: string; category: string; body: string }[],
  rules: Parameters<typeof evaluateRules>[1],
  result: RunResult,
): Promise<boolean> {
  // Checked before drafting, not after: a bounce should not cost a model
  // call, and it must never reach the send path.
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
  if (loop.block) {
    email.status = 'ignored';
    email.aiReason = loop.reason;
    await email.save();
    result.ignored += 1;
    return true;
  }

  // A draft is regenerated when there is none, and also when the stored one
  // came from the offline stub while a real model is now configured.
  //
  // Without the second condition, every email drafted during an AI outage kept
  // its canned "Thank you for your email regarding..." template forever: the
  // automation saw a non-empty aiReply and skipped it, so fixing the model
  // changed nothing for any email already in the queue.
  const staleStub = email.aiIsStub && !env.openai.mock;

  // Same class of bug, different cause: with nothing to read, any model — and
  // certainly the stub — produces a reply that could have been written for any
  // email at all. That is a parsing failure to surface, not a draft to send.
  const attachmentText = (email.attachments ?? [])
    .map((a) => a.extractedText ?? '')
    .filter(Boolean)
    .join('\n');

  if (!email.body?.trim() && !attachmentText.trim()) {
    email.status = 'pending';
    email.aiReason =
      'The message body could not be read, so no reply was drafted. Open the original in your mail client.';
    email.aiProblems = ['Empty body after parsing — nothing for the model to answer.'];
    await email.save();
    result.heldForApproval += 1;
    return true;
  }

  // Rule conditions on the sender, subject and body are evaluated before
  // drafting too, so a rule can attach drafting instructions.
  const preDraft = evaluateRules(toEvaluationInput(email), rules);

  if (!email.aiReply || !email.aiGeneratedAt || staleStub) {
    const draft = await draftReply({
      fromName: email.fromName,
      fromEmail: email.fromEmail,
      subject: email.subject,
      body: email.body,
      ownEmail: user.email,
      settings: user.settings,
      instructions: preDraft.instructions,
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
    result.drafted += 1;
    if (staleStub) result.redrafted += 1;
  }

  // Rules are evaluated after drafting so that conditions on category,
  // priority and confidence have real values to test. Conditions on the
  // sender, subject and body would work either way.
  const decision = evaluateRules(toEvaluationInput(email), rules);
  email.appliedRuleIds = decision.matchedRuleIds.map((id) => new Types.ObjectId(id));
  email.ruleTrace = decision.trace;

  if (decision.category) email.category = decision.category as typeof email.category;
  if (decision.priority) email.priority = decision.priority as typeof email.priority;

  if (decision.matchedRuleIds.length) {
    result.ruleMatches += 1;
    await Rule.updateMany(
      { _id: { $in: email.appliedRuleIds }, userId: user._id },
      { $inc: { runCount: 1 }, $set: { lastRunAt: new Date() } },
    );
  }

  if (decision.ignore) {
    email.status = 'ignored';
    email.aiReason = decision.trace.find((t) => t.includes('without a reply')) ?? 'Filed by a rule.';
    await email.save();
    result.ignored += 1;
    return true;
  }

  if (email.category === 'spam') {
    email.status = 'ignored';
    email.aiReason = 'Classified as bulk mail — filed without a reply.';
    await email.save();
    result.ignored += 1;
    return true;
  }

  if (!email.aiReply?.trim()) {
    email.status = 'ignored';
    email.aiReason =
      email.aiReason ?? 'The model saw nothing here that needs a reply — filed as read.';
    await email.save();
    result.ignored += 1;
    return true;
  }

  // The money and personal-data rails scan the attachment text too: an
  // invoice PDF full of figures must hold the reply even when the email
  // body itself is a one-line "please see attached".
  const gateResult = gate(user.settings, {
    confidence: email.aiConfidence ?? 0,
    category: email.category,
    body: attachmentText ? `${email.aiReply}\n${attachmentText}` : email.aiReply,
    injection: email.aiInjectionSuspected,
    stub: email.aiIsStub,
    problems: email.aiProblems,
  });

  // A rule can only ever narrow what happens. `require_approval` overrides a
  // gate that would have sent; `auto_send` does NOT override a gate that
  // refused, because the gate carries the safety rails — money, personal data,
  // prompt injection, business hours and the send cap.
  let send = gateResult.send;
  let reason = gateResult.reason;

  if (send && decision.sendMode === 'approval') {
    send = false;
    reason = 'A rule requires a person to approve this reply.';
  }
  if (!send && decision.sendMode === 'auto') {
    reason = `${gateResult.reason} A rule asked to auto-send, but the account safety rails take precedence.`;
  }

  if (!send) {
    email.status = 'pending';
    email.aiReason = reason;
    await email.save();
    result.heldForApproval += 1;
    return true;
  }

  await email.save();
  try {
    await approveAndSend(user._id.toString(), email._id.toString(), { actor: 'ai' });
    result.autoSent += 1;
  } catch (e) {
    // A refusal from the send-time checks is a held draft, not a crash.
    const reason = e instanceof Error ? e.message : 'Send refused';
    await Email.findByIdAndUpdate(email._id, {
      $set: { status: 'pending', aiReason: `Held at send time: ${reason}` },
    });
    result.heldForApproval += 1;
  }
  return true;
}

/* -------------------------------- sync --------------------------------- */

export interface SyncResult {
  fetched: number;
  created: number;
  skipped?: string;
}

/**
 * Downloads each attachment and pulls its text out. Runs at sync time so the
 * text is already on the record when the model drafts a reply.
 */
async function readAttachments(
  provider: MailProvider,
  messageId: string,
  attachments: FetchedAttachment[],
) {
  const out = [];
  let read = 0;

  for (const a of attachments) {
    if (!a.externalId) {
      out.push({ ...a, extractStatus: 'unsupported' as const, extractDetail: 'No attachment id' });
      continue;
    }
    if (a.size > env.attachments.maxBytes) {
      out.push({ ...a, extractStatus: 'too_large' as const });
      continue;
    }
    if (read >= env.attachments.maxPerMessage) {
      out.push({
        ...a,
        extractStatus: 'skipped' as const,
        extractDetail: `Only the first ${env.attachments.maxPerMessage} attachments are read`,
      });
      continue;
    }
    try {
      const buffer = await provider.downloadAttachment(messageId, a.externalId);
      const result = await extractText(buffer, a.mimeType, a.filename);
      read += 1;
      out.push({
        ...a,
        extractedText: result.text || undefined,
        extractStatus: result.status,
        extractDetail: result.detail,
      });
    } catch (e) {
      const detail = e instanceof Error ? e.message : 'Download failed';
      logger.warn(`Could not read ${a.filename}: ${detail}`);
      out.push({ ...a, extractStatus: 'failed' as const, extractDetail: detail });
    }
  }
  return out;
}

/**
 * Pulls new messages from the provider and stores the ones we have not seen.
 *
 * Idempotent by construction: the insert relies on the unique
 * (userId, externalId) index, so a duplicate delivery is a caught error rather
 * than a second copy of the email. lastSyncAt only moves forward after the
 * provider call succeeds, so a failed sync re-reads the same window instead of
 * skipping over it.
 */
export async function syncMailbox(userId: string, folder?: string): Promise<SyncResult> {
  if (!(await claimLock(userId, 'syncLockAt'))) {
    logger.info(`Sync already running for ${userId} — this run was skipped`);
    return { fetched: 0, created: 0, skipped: 'A sync is already in progress.' };
  }

  try {
    const user = await User.findById(userId);
    if (!user) throw new Error('User not found');

    const provider = await providerFor(userId);

    // The configured source folder is the default. Without this, the Settings
    // folder picker had no effect on Gmail or Graph: syncMailbox was called
    // with no folder and both providers fell back to the inbox.
    const target = folder ?? user.mailFolder ?? user.imap?.folder ?? undefined;

    const since =
      user.lastSyncAt ??
      new Date(Date.now() - env.sync.initialLookbackDays * 24 * 60 * 60 * 1000);

    // A small overlap covers clock skew between us and the mail server, which
    // otherwise drops any message that lands in the same second as a sync.
    const window = new Date(since.getTime() - 60_000);
    const startedAt = new Date();

    const messages = await provider.listRecentMessages({
      since: window,
      limit: env.sync.batchSize,
      folder: target || undefined,
    });

    let created = 0;
    for (const m of messages) {
      if (!m.externalId) continue;

      const existing = await Email.exists({ userId: user._id, externalId: m.externalId });
      if (existing) continue;

      const attachments = env.attachments.enabled
        ? await readAttachments(provider, m.externalId, m.attachments)
        : m.attachments;

      try {
        await Email.create({
          userId: user._id,
          externalId: m.externalId,
          threadId: m.threadId || m.externalId,
          fromName: m.fromName,
          fromEmail: m.fromEmail,
          toEmail: m.toEmail,
          subject: m.subject,
          snippet: m.snippet,
          body: m.body,
          receivedAt: m.receivedAt,
          status: m.unread ? 'unread' : 'pending',
          sendState: 'idle',
          attachments,
          thread: [
            {
              from: m.fromEmail,
              fromName: m.fromName,
              outbound: false,
              body: m.body,
              sentAt: m.receivedAt,
            },
          ],
        });
        created += 1;
      } catch (e) {
        // 11000 is the unique index doing its job: two syncs raced and the
        // other one won. Anything else is a real failure worth surfacing.
        if ((e as { code?: number })?.code === 11000) continue;
        throw e;
      }
    }

    if (created > 0) {
      await record(userId, 'email_received', `${created} new email(s) received`, undefined);
    }

    // Only now, after the provider call actually returned.
    user.lastSyncAt = startedAt;
    await user.save();

    await record(userId, 'sync', 'Mailbox synced', `${created} new`);
    publish(userId, 'sync:done', { fetched: messages.length, created });
    return { fetched: messages.length, created };
  } finally {
    await releaseLock(userId, 'syncLockAt');
  }
}
