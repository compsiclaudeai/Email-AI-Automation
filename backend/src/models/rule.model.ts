import { Schema, model, models, type Model, type Document, type Types } from 'mongoose';

/**
 * A user-authored automation rule: WHEN something happens, IF these conditions
 * hold, THEN take these actions.
 *
 * Before this, automation was a single set of account-wide settings — one
 * confidence threshold and one category list for every email in the mailbox.
 * There was no way to say "invoices from this domain can auto-send, but
 * anything mentioning a refund always waits for me".
 *
 * Rules layer *on top of* the account safety rails; they never replace them.
 * A rule can restrict what happens to an email but it cannot authorise a send
 * that `gate()` would otherwise refuse — see rules.service.
 */

export type RuleTrigger = 'email_received';

export type ConditionField =
  | 'from'
  | 'to'
  | 'subject'
  | 'body'
  | 'category'
  | 'priority'
  | 'confidence'
  | 'hasAttachment'
  | 'attachmentText';

export type ConditionOperator =
  | 'contains'
  | 'not_contains'
  | 'equals'
  | 'not_equals'
  | 'starts_with'
  | 'ends_with'
  | 'matches_domain'
  | 'gte'
  | 'lte'
  | 'is_true'
  | 'is_false';

export type RuleActionType =
  | 'draft_reply'
  | 'auto_send'
  | 'require_approval'
  | 'set_category'
  | 'set_priority'
  | 'use_template'
  | 'add_instruction'
  | 'ignore'
  | 'stop_processing';

export interface RuleCondition {
  field: ConditionField;
  operator: ConditionOperator;
  /** Unused for is_true / is_false. */
  value?: string;
}

export interface RuleAction {
  type: RuleActionType;
  /** Category name, priority level, template id, or instruction text. */
  value?: string;
}

export interface RuleDoc extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  name: string;
  description?: string;
  enabled: boolean;
  /** Lower runs first. Ties break on creation order. */
  priority: number;
  trigger: RuleTrigger;
  /** How the conditions combine. An empty condition list matches everything. */
  match: 'all' | 'any';
  conditions: RuleCondition[];
  actions: RuleAction[];
  /** Counters, so the builder can show whether a rule is doing anything. */
  runCount: number;
  lastRunAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const conditionSchema = new Schema<RuleCondition>(
  {
    field: {
      type: String,
      required: true,
      enum: [
        'from',
        'to',
        'subject',
        'body',
        'category',
        'priority',
        'confidence',
        'hasAttachment',
        'attachmentText',
      ],
    },
    operator: {
      type: String,
      required: true,
      enum: [
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
      ],
    },
    value: { type: String, maxlength: 500 },
  },
  { _id: false },
);

const actionSchema = new Schema<RuleAction>(
  {
    type: {
      type: String,
      required: true,
      enum: [
        'draft_reply',
        'auto_send',
        'require_approval',
        'set_category',
        'set_priority',
        'use_template',
        'add_instruction',
        'ignore',
        'stop_processing',
      ],
    },
    value: { type: String, maxlength: 2000 },
  },
  { _id: false },
);

const ruleSchema = new Schema<RuleDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, maxlength: 120 },
    description: { type: String, maxlength: 500 },
    enabled: { type: Boolean, default: true },
    priority: { type: Number, default: 100, min: 0, max: 10_000 },
    trigger: { type: String, enum: ['email_received'], default: 'email_received' },
    match: { type: String, enum: ['all', 'any'], default: 'all' },
    conditions: { type: [conditionSchema], default: [] },
    actions: { type: [actionSchema], default: [] },
    runCount: { type: Number, default: 0 },
    lastRunAt: Date,
  },
  { timestamps: true },
);

// The evaluation order the engine reads in.
ruleSchema.index({ userId: 1, enabled: 1, priority: 1, createdAt: 1 });
ruleSchema.index({ userId: 1, name: 1 }, { unique: true });

export const Rule =
  (models.Rule as Model<RuleDoc>) ?? model<RuleDoc>('Rule', ruleSchema);
