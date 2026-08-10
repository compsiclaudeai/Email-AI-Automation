import { Schema, model, models, type Model, type Document, type Types } from 'mongoose';

export type EmailStatus = 'unread' | 'pending' | 'replied' | 'failed' | 'ignored';
export type Priority = 'high' | 'medium' | 'low';
export type Category = 'invoice' | 'support' | 'hr' | 'sales' | 'marketing' | 'spam' | 'other';
export type SendState = 'idle' | 'sending' | 'sent';

export interface Attachment {
  filename: string;
  mimeType: string;
  size: number;
  externalId?: string;
  /** Text pulled out of the file, fed to the model alongside the email body. */
  extractedText?: string;
  extractStatus?: 'ok' | 'empty' | 'too_large' | 'unsupported' | 'failed' | 'skipped';
  extractDetail?: string;
}

export interface ThreadMessage {
  from: string;
  fromName: string;
  outbound: boolean;
  body: string;
  sentAt: Date;
}

export interface EmailDoc extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  /** Message id as returned by Gmail or Graph. */
  externalId: string;
  threadId: string;
  fromName: string;
  fromEmail: string;
  toEmail: string;
  subject: string;
  snippet: string;
  body: string;
  receivedAt: Date;
  status: EmailStatus;
  priority: Priority;
  category: Category;
  attachments: Attachment[];
  thread: ThreadMessage[];

  aiReply?: string;
  aiConfidence?: number;
  aiReason?: string;
  aiModel?: string;
  aiGeneratedAt?: Date;
  /** True when this email tried to give the AI instructions. */
  aiInjectionSuspected: boolean;
  /** Everything deterministic validation objected to in the draft. */
  aiProblems: string[];
  /** True when the draft came from the offline keyword stub, not a model. */
  aiIsStub: boolean;
  /** Rules that matched this email, in the order they were applied. */
  appliedRuleIds: Types.ObjectId[];
  /** Readable account of how the rules reached their decision. */
  ruleTrace: string[];

  /**
   * Send state machine, separate from `status`, and the thing that makes
   * sending idempotent: only a transition from idle -> sending is allowed to
   * call the provider, and it is claimed atomically.
   */
  sendState: SendState;
  sendLockAt?: Date;
  /** Provider id of the message we actually sent. Proof the send happened. */
  sentMessageId?: string;
  /** Who caused the send: the automation, or a person clicking approve. */
  sentBy?: 'ai' | 'user';

  approvedBy?: Types.ObjectId;
  sentAt?: Date;
  failureReason?: string;
  retryCount: number;
  responseTimeMs?: number;

  createdAt: Date;
  updatedAt: Date;
}

const attachmentSchema = new Schema<Attachment>(
  {
    extractedText: String,
    extractStatus: String,
    extractDetail: String,
    filename: String,
    mimeType: String,
    size: Number,
    externalId: String,
  },
  { _id: false },
);

const threadSchema = new Schema<ThreadMessage>(
  {
    from: String,
    fromName: String,
    outbound: { type: Boolean, default: false },
    body: String,
    sentAt: Date,
  },
  { _id: false },
);

const emailSchema = new Schema<EmailDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    externalId: { type: String, required: true },
    threadId: { type: String, required: true },
    fromName: { type: String, default: '' },
    fromEmail: { type: String, required: true, lowercase: true },
    toEmail: { type: String, default: '' },
    subject: { type: String, default: '(no subject)' },
    snippet: { type: String, default: '' },
    body: { type: String, default: '' },
    receivedAt: { type: Date, required: true },
    status: {
      type: String,
      enum: ['unread', 'pending', 'replied', 'failed', 'ignored'],
      default: 'unread',
      index: true,
    },
    priority: { type: String, enum: ['high', 'medium', 'low'], default: 'medium' },
    category: {
      type: String,
      enum: ['invoice', 'support', 'hr', 'sales', 'marketing', 'spam', 'other'],
      default: 'other',
      index: true,
    },
    attachments: { type: [attachmentSchema], default: [] },
    thread: { type: [threadSchema], default: [] },

    aiReply: String,
    aiConfidence: { type: Number, min: 0, max: 100 },
    aiReason: String,
    aiModel: String,
    aiGeneratedAt: Date,
    aiInjectionSuspected: { type: Boolean, default: false },
    aiProblems: { type: [String], default: [] },
    aiIsStub: { type: Boolean, default: false },
    appliedRuleIds: { type: [Schema.Types.ObjectId], default: [] },
    ruleTrace: { type: [String], default: [] },

    sendState: {
      type: String,
      enum: ['idle', 'sending', 'sent'],
      default: 'idle',
      index: true,
    },
    sendLockAt: Date,
    sentMessageId: String,
    sentBy: { type: String, enum: ['ai', 'user'] },

    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    sentAt: Date,
    failureReason: String,
    retryCount: { type: Number, default: 0 },
    responseTimeMs: Number,
  },
  { timestamps: true },
);

emailSchema.index({ userId: 1, externalId: 1 }, { unique: true });
emailSchema.index({ userId: 1, receivedAt: -1 });
// The automation queue and the loop-guard counters both read these.
emailSchema.index({ userId: 1, status: 1, receivedAt: -1 });
emailSchema.index({ userId: 1, threadId: 1 });
emailSchema.index({ userId: 1, fromEmail: 1, sentAt: -1 });
emailSchema.index({ userId: 1, sendState: 1, sendLockAt: 1 });
emailSchema.index({ subject: 'text', snippet: 'text', fromName: 'text', fromEmail: 'text' });

// `models` is checked first so a re-import (tsx watch, a test reloading the
// module registry) reuses the compiled model instead of throwing
// OverwriteModelError.
export const Email =
  (models.Email as Model<EmailDoc>) ?? model<EmailDoc>('Email', emailSchema);
