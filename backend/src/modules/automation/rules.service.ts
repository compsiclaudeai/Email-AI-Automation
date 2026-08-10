import type { EmailDoc } from '../../models/email.model';
import type { RuleAction, RuleCondition, RuleDoc } from '../../models/rule.model';

/**
 * Rule evaluation.
 *
 * Entirely deterministic and side-effect free: it reads an email and a list of
 * rules and returns a decision plus a trace of how it got there. Nothing here
 * sends, writes or calls a model, which is what makes a rule safe to "test"
 * against a real email from the builder UI.
 *
 * Conflict resolution:
 *
 *   - rules run in `priority` order (lower first), then creation order
 *   - a later rule overrides an earlier one on the same axis (category, send
 *     mode) — last writer wins, and the trace records who won
 *   - `ignore` and `stop_processing` halt evaluation immediately
 *   - restrictions beat permissions: once any rule has said `require_approval`,
 *     no later rule can turn it back into `auto_send`
 */

export type SendMode = 'auto' | 'approval' | 'none';

export interface RuleDecision {
  /** Whether a reply should be drafted at all. */
  draft: boolean;
  /** What the rules want to happen once a draft exists. */
  sendMode: SendMode;
  /** File without replying. */
  ignore: boolean;
  category?: string;
  priority?: string;
  templateId?: string;
  /** Extra drafting instructions the account owner attached to a rule. */
  instructions: string[];
  /** Ids of every rule that matched, in the order they were applied. */
  matchedRuleIds: string[];
  /** Human-readable account of the decision, shown in the UI and the logs. */
  trace: string[];
}

export interface EvaluationInput {
  fromEmail: string;
  toEmail: string;
  subject: string;
  body: string;
  category: string;
  priority: string;
  confidence: number;
  hasAttachment: boolean;
  attachmentText: string;
}

/** Builds the evaluation input from a stored email. */
export function toEvaluationInput(email: EmailDoc): EvaluationInput {
  return {
    fromEmail: email.fromEmail ?? '',
    toEmail: email.toEmail ?? '',
    subject: email.subject ?? '',
    body: email.body ?? '',
    category: email.category ?? 'other',
    priority: email.priority ?? 'medium',
    confidence: Number.isFinite(email.aiConfidence) ? (email.aiConfidence as number) : 0,
    hasAttachment: (email.attachments?.length ?? 0) > 0,
    attachmentText: (email.attachments ?? [])
      .map((a) => a.extractedText ?? '')
      .filter(Boolean)
      .join('\n'),
  };
}

function fieldValue(input: EvaluationInput, field: RuleCondition['field']): string | number | boolean {
  switch (field) {
    case 'from':
      return input.fromEmail;
    case 'to':
      return input.toEmail;
    case 'subject':
      return input.subject;
    case 'body':
      return input.body;
    case 'category':
      return input.category;
    case 'priority':
      return input.priority;
    case 'confidence':
      return input.confidence;
    case 'hasAttachment':
      return input.hasAttachment;
    case 'attachmentText':
      return input.attachmentText;
    default:
      return '';
  }
}

/** Evaluates one condition. Never throws: a malformed rule is simply no match. */
export function matchesCondition(input: EvaluationInput, condition: RuleCondition): boolean {
  const actual = fieldValue(input, condition.field);
  const expected = (condition.value ?? '').trim();

  switch (condition.operator) {
    case 'is_true':
      return actual === true;
    case 'is_false':
      return actual === false;

    case 'gte':
    case 'lte': {
      const a = Number(actual);
      const b = Number(expected);
      // A non-numeric comparison must fail closed rather than compare NaN,
      // which is false for gte and lte alike and would silently never match.
      if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
      return condition.operator === 'gte' ? a >= b : a <= b;
    }

    case 'matches_domain': {
      const address = String(actual).toLowerCase();
      const domain = expected.toLowerCase().replace(/^@/, '');
      if (!domain) return false;
      const at = address.lastIndexOf('@');
      if (at === -1) return false;
      const actualDomain = address.slice(at + 1);
      // A subdomain of the configured domain counts; a domain that merely ends
      // with the same letters ("notexample.com" vs "example.com") does not.
      return actualDomain === domain || actualDomain.endsWith(`.${domain}`);
    }

    default: {
      const haystack = String(actual).toLowerCase();
      const needle = expected.toLowerCase();
      if (!needle) return false;
      switch (condition.operator) {
        case 'contains':
          return haystack.includes(needle);
        case 'not_contains':
          return !haystack.includes(needle);
        case 'equals':
          return haystack.trim() === needle;
        case 'not_equals':
          return haystack.trim() !== needle;
        case 'starts_with':
          return haystack.trimStart().startsWith(needle);
        case 'ends_with':
          return haystack.trimEnd().endsWith(needle);
        default:
          return false;
      }
    }
  }
}

/** True when a rule's conditions hold. No conditions means "every email". */
export function ruleMatches(input: EvaluationInput, rule: Pick<RuleDoc, 'conditions' | 'match'>): boolean {
  const conditions = rule.conditions ?? [];
  if (conditions.length === 0) return true;
  return rule.match === 'any'
    ? conditions.some((c) => matchesCondition(input, c))
    : conditions.every((c) => matchesCondition(input, c));
}

type EvaluableRule = Pick<
  RuleDoc,
  'name' | 'enabled' | 'priority' | 'conditions' | 'actions' | 'match'
> & { _id: { toString(): string }; createdAt?: Date };

/**
 * Runs every enabled rule and returns the combined decision.
 *
 * With no rules at all the decision is "draft it, and let the account settings
 * decide whether it sends" — identical to the behaviour before rules existed,
 * so adding this engine changes nothing for an account that has not written
 * any.
 */
export function evaluateRules(input: EvaluationInput, rules: EvaluableRule[]): RuleDecision {
  const decision: RuleDecision = {
    draft: true,
    sendMode: 'none',
    ignore: false,
    instructions: [],
    matchedRuleIds: [],
    trace: [],
  };

  const ordered = [...rules]
    .filter((r) => r.enabled)
    .sort(
      (a, b) =>
        (a.priority ?? 100) - (b.priority ?? 100) ||
        (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0),
    );

  if (ordered.length === 0) {
    decision.trace.push('No enabled rules — account settings decide on their own.');
    return decision;
  }

  let approvalLocked = false;

  for (const rule of ordered) {
    if (!ruleMatches(input, rule)) continue;

    decision.matchedRuleIds.push(rule._id.toString());
    decision.trace.push(`Matched "${rule.name}" (priority ${rule.priority ?? 100}).`);

    let stop = false;

    for (const action of rule.actions ?? []) {
      applyAction(decision, action, rule.name, approvalLocked);
      if (action.type === 'require_approval') approvalLocked = true;
      if (action.type === 'ignore' || action.type === 'stop_processing') stop = true;
    }

    if (stop) {
      decision.trace.push(`"${rule.name}" stopped further rule processing.`);
      break;
    }
  }

  if (decision.matchedRuleIds.length === 0) {
    decision.trace.push('No rule matched — account settings decide on their own.');
  }

  return decision;
}

function applyAction(
  decision: RuleDecision,
  action: RuleAction,
  ruleName: string,
  approvalLocked: boolean,
): void {
  const value = (action.value ?? '').trim();

  switch (action.type) {
    case 'draft_reply':
      decision.draft = true;
      decision.ignore = false;
      break;

    case 'auto_send':
      if (approvalLocked) {
        // A restriction already applied by an earlier rule is not undone by a
        // later permission. Silently upgrading to auto-send here would be the
        // one way a rule could widen what the automation may do.
        decision.trace.push(
          `"${ruleName}" asked to auto-send, but an earlier rule required approval — approval wins.`,
        );
        break;
      }
      decision.draft = true;
      decision.sendMode = 'auto';
      decision.trace.push(`"${ruleName}" allows this to send automatically.`);
      break;

    case 'require_approval':
      decision.draft = true;
      decision.sendMode = 'approval';
      decision.trace.push(`"${ruleName}" requires a person to approve this.`);
      break;

    case 'set_category':
      if (value) {
        decision.category = value;
        decision.trace.push(`"${ruleName}" set the category to ${value}.`);
      }
      break;

    case 'set_priority':
      if (value) {
        decision.priority = value;
        decision.trace.push(`"${ruleName}" set the priority to ${value}.`);
      }
      break;

    case 'use_template':
      if (value) {
        decision.templateId = value;
        decision.trace.push(`"${ruleName}" selected a template.`);
      }
      break;

    case 'add_instruction':
      if (value) {
        decision.instructions.push(value);
        decision.trace.push(`"${ruleName}" added a drafting instruction.`);
      }
      break;

    case 'ignore':
      decision.ignore = true;
      decision.draft = false;
      decision.sendMode = 'none';
      decision.trace.push(`"${ruleName}" filed this without a reply.`);
      break;

    case 'stop_processing':
      break;
  }
}
