import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.middleware';
import { asyncHandler, badRequest, notFound } from '../../utils/http';
import { Rule } from '../../models/rule.model';
import { Email } from '../../models/email.model';
import { record } from '../activity/activity.service';
import { evaluateRules, toEvaluationInput } from './rules.service';

export const rulesRouter = Router();
rulesRouter.use(requireAuth);

const oid = (id: string, label = 'rule') => {
  if (!Types.ObjectId.isValid(id)) throw badRequest(`That is not a valid ${label} id`);
  return new Types.ObjectId(id);
};

const conditionSchema = z.object({
  field: z.enum([
    'from',
    'to',
    'subject',
    'body',
    'category',
    'priority',
    'confidence',
    'hasAttachment',
    'attachmentText',
  ]),
  operator: z.enum([
    'contains',
    'not_contains',
    'equals',
    'not_equals',
    'starts_with',
    'ends_with',
    'matches_domain',
    'gte',
    'lte',
    'is_true',
    'is_false',
  ]),
  value: z.string().max(500).optional(),
});

const actionSchema = z.object({
  type: z.enum([
    'draft_reply',
    'auto_send',
    'require_approval',
    'set_category',
    'set_priority',
    'use_template',
    'add_instruction',
    'ignore',
    'stop_processing',
  ]),
  value: z.string().max(2000).optional(),
});

const ruleSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(500).optional(),
  enabled: z.boolean().optional(),
  priority: z.number().int().min(0).max(10_000).optional(),
  match: z.enum(['all', 'any']).optional(),
  conditions: z.array(conditionSchema).max(20).default([]),
  actions: z.array(actionSchema).min(1, 'A rule needs at least one action').max(10),
});

/**
 * A condition that needs a value but has none silently never matches, which
 * looks exactly like a rule that is not running. Rejected at write time instead.
 */
function assertUsable(conditions: z.infer<typeof conditionSchema>[]) {
  const needsValue = (op: string) => !['is_true', 'is_false'].includes(op);
  for (const c of conditions) {
    if (needsValue(c.operator) && !c.value?.trim()) {
      throw badRequest(`The "${c.field}" condition needs a value`);
    }
    if (['gte', 'lte'].includes(c.operator) && !Number.isFinite(Number(c.value))) {
      throw badRequest(`"${c.value}" is not a number, so the ${c.field} comparison can never match`);
    }
  }
}

rulesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const rules = await Rule.find({ userId: req.userId })
      .sort({ priority: 1, createdAt: 1 })
      .lean();
    res.json(rules);
  }),
);

rulesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = ruleSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Invalid rule', parsed.error.flatten());
    assertUsable(parsed.data.conditions);

    try {
      const doc = await Rule.create({ ...parsed.data, userId: req.userId });
      await record(req.userId!, 'settings_changed', 'Automation rule created', doc.name);
      res.status(201).json(doc);
    } catch (e) {
      if ((e as { code?: number })?.code === 11000) {
        throw badRequest('You already have a rule with that name');
      }
      throw e;
    }
  }),
);

/**
 * Dry run.
 *
 * Evaluates a rule set against a real email and reports what *would* happen.
 * Deliberately side-effect free: nothing is saved, no counter moves and no
 * model is called, so testing a rule can never send anything.
 */
rulesRouter.post(
  '/test',
  asyncHandler(async (req, res) => {
    const body = z
      .object({ emailId: z.string(), rule: ruleSchema.partial({ name: true }).optional() })
      .safeParse(req.body);
    if (!body.success) throw badRequest('Invalid test request', body.error.flatten());

    const email = await Email.findOne({
      _id: oid(body.data.emailId, 'email'),
      userId: req.userId,
    });
    if (!email) throw notFound('Email not found');

    const input = toEvaluationInput(email);

    // Either test one unsaved draft rule, or the whole saved set.
    const rules = body.data.rule
      ? [
          {
            _id: new Types.ObjectId(),
            name: body.data.rule.name ?? 'Draft rule',
            enabled: true,
            priority: body.data.rule.priority ?? 100,
            match: body.data.rule.match ?? ('all' as const),
            conditions: body.data.rule.conditions ?? [],
            actions: body.data.rule.actions ?? [],
            createdAt: new Date(),
          }
        ]
      : await Rule.find({ userId: req.userId, enabled: true })
          .sort({ priority: 1, createdAt: 1 })
          .lean();

    res.json({
      email: {
        id: email._id,
        from: email.fromEmail,
        subject: email.subject,
        category: email.category,
        priority: email.priority,
        confidence: email.aiConfidence ?? 0,
        hasAttachment: (email.attachments?.length ?? 0) > 0,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      decision: evaluateRules(input, rules as any),
    });
  }),
);

rulesRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const parsed = ruleSchema.partial().safeParse(req.body);
    if (!parsed.success) throw badRequest('Invalid rule', parsed.error.flatten());
    if (parsed.data.conditions) assertUsable(parsed.data.conditions);

    const doc = await Rule.findOneAndUpdate(
      { _id: oid(req.params.id), userId: req.userId },
      { $set: parsed.data },
      { new: true },
    );
    if (!doc) throw notFound('Rule not found');
    res.json(doc);
  }),
);

rulesRouter.post(
  '/:id/duplicate',
  asyncHandler(async (req, res) => {
    const source = await Rule.findOne({ _id: oid(req.params.id), userId: req.userId }).lean();
    if (!source) throw notFound('Rule not found');

    // Names are unique per account, so the copy needs one that is free.
    let name = `${source.name} (copy)`;
    for (let n = 2; await Rule.exists({ userId: req.userId, name }); n++) {
      name = `${source.name} (copy ${n})`;
      if (n > 50) throw badRequest('Too many copies of that rule');
    }

    const copy = await Rule.create({
      userId: req.userId,
      name,
      description: source.description,
      // A duplicate arrives switched off: copying a rule should never quietly
      // double whatever the original was already doing.
      enabled: false,
      priority: source.priority,
      match: source.match,
      conditions: source.conditions,
      actions: source.actions,
    });
    res.status(201).json(copy);
  }),
);

rulesRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const doc = await Rule.findOneAndDelete({ _id: oid(req.params.id), userId: req.userId });
    if (!doc) throw notFound('Rule not found');
    await record(req.userId!, 'settings_changed', 'Automation rule deleted', doc.name);
    res.json({ ok: true });
  }),
);

/** Recent emails a rule actually acted on. */
rulesRouter.get(
  '/:id/history',
  asyncHandler(async (req, res) => {
    const id = oid(req.params.id);
    const rule = await Rule.findOne({ _id: id, userId: req.userId }).lean();
    if (!rule) throw notFound('Rule not found');

    const emails = await Email.find({ userId: req.userId, appliedRuleIds: id })
      .sort({ receivedAt: -1 })
      .limit(25)
      .select('subject fromEmail status receivedAt sentBy ruleTrace')
      .lean();

    res.json({ runCount: rule.runCount, lastRunAt: rule.lastRunAt, emails });
  }),
);
