import { Schema, model, models, type Model, type Document, type Types } from 'mongoose';

export type Provider = 'google' | 'microsoft' | 'imap';
export type Tone = 'Professional' | 'Friendly' | 'Formal' | 'Casual';
export type ApprovalMode = 'automatic' | 'manual';

export interface AutomationSettings {
  autoReply: boolean;
  approvalMode: ApprovalMode;
  confidenceThreshold: number;
  tone: Tone;
  businessHoursEnabled: boolean;
  businessHoursFrom: string;
  businessHoursTo: string;
  timezone: string;
  signature: string;
  enabledCategories: string[];
  /** Hard stops the automation is never allowed to cross. */
  neverAutoSendMoney: boolean;
  neverAutoSendPersonalData: boolean;
  pauseAfterBounces: number;
  paused: boolean;
  /** Hard ceiling on automated sends in a rolling 24 hours. */
  dailySendCap: number;
}

/** Connection details for a plain IMAP/SMTP mailbox (cPanel, SiteGround, Zoho…). */
export interface ImapConfig {
  host: string;
  port: number;
  secure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  /** Mailbox to read. An Outlook rule can route client mail into its own folder. */
  folder: string;
  /** Where sent replies are filed. Empty string skips the append. */
  sentFolder?: string;
}

export interface UserDoc extends Document {
  _id: Types.ObjectId;
  name: string;
  email: string;
  avatarUrl?: string;
  provider: Provider;
  providerAccountId: string;
  /** AES-256-GCM encrypted. Never returned by the API. */
  refreshToken?: string;
  accessToken?: string;
  accessTokenExpiresAt?: Date;
  scopes: string[];
  /** IMAP only. AES-256-GCM encrypted, never returned by the API. */
  imapPassword?: string;
  imap?: ImapConfig;
  lastSyncAt?: Date;
  syncCursor?: string;
  /**
   * Provider-agnostic source folder. An Outlook or IMAP rule can route client
   * mail into its own folder; this is the one the sync reads. Empty means the
   * inbox. For IMAP it mirrors imap.folder.
   */
  mailFolder?: string;
  /**
   * Cooperative locks. The cron loop and a user clicking "Run automation" can
   * fire at the same moment; without these, both would draft and both would
   * send. Timestamps rather than booleans so a crashed worker's lock expires.
   */
  automationLockAt?: Date;
  syncLockAt?: Date;
  settings: AutomationSettings;
  createdAt: Date;
  updatedAt: Date;
}

export const DEFAULT_SETTINGS: AutomationSettings = {
  autoReply: true,
  approvalMode: 'manual',
  confidenceThreshold: 90,
  tone: 'Professional',
  businessHoursEnabled: true,
  businessHoursFrom: '09:00',
  businessHoursTo: '18:00',
  timezone: 'Asia/Karachi',
  signature: '',
  enabledCategories: ['invoice', 'support', 'hr', 'sales', 'marketing'],
  neverAutoSendMoney: true,
  neverAutoSendPersonalData: true,
  pauseAfterBounces: 3,
  paused: false,
  dailySendCap: 100,
};

const settingsSchema = new Schema<AutomationSettings>(
  {
    autoReply: { type: Boolean, default: true },
    approvalMode: { type: String, enum: ['automatic', 'manual'], default: 'manual' },
    confidenceThreshold: { type: Number, default: 90, min: 0, max: 100 },
    tone: {
      type: String,
      enum: ['Professional', 'Friendly', 'Formal', 'Casual'],
      default: 'Professional',
    },
    businessHoursEnabled: { type: Boolean, default: true },
    businessHoursFrom: { type: String, default: '09:00' },
    businessHoursTo: { type: String, default: '18:00' },
    timezone: { type: String, default: 'Asia/Karachi' },
    signature: { type: String, default: '' },
    enabledCategories: { type: [String], default: DEFAULT_SETTINGS.enabledCategories },
    neverAutoSendMoney: { type: Boolean, default: true },
    neverAutoSendPersonalData: { type: Boolean, default: true },
    pauseAfterBounces: { type: Number, default: 3 },
    paused: { type: Boolean, default: false },
    dailySendCap: { type: Number, default: 100, min: 0, max: 5000 },
  },
  { _id: false },
);

const imapSchema = new Schema<ImapConfig>(
  {
    host: { type: String, required: true },
    port: { type: Number, default: 993 },
    secure: { type: Boolean, default: true },
    smtpHost: { type: String, required: true },
    smtpPort: { type: Number, default: 465 },
    smtpSecure: { type: Boolean, default: true },
    folder: { type: String, default: 'INBOX' },
    sentFolder: { type: String, default: undefined },
  },
  { _id: false },
);

const userSchema = new Schema<UserDoc>(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    avatarUrl: String,
    provider: { type: String, enum: ['google', 'microsoft', 'imap'], required: true },
    providerAccountId: { type: String, required: true },
    refreshToken: { type: String, select: false },
    accessToken: { type: String, select: false },
    accessTokenExpiresAt: Date,
    scopes: { type: [String], default: [] },
    imapPassword: { type: String, select: false },
    imap: { type: imapSchema, default: undefined },
    lastSyncAt: Date,
    syncCursor: String,
    mailFolder: String,
    automationLockAt: Date,
    syncLockAt: Date,
    settings: { type: settingsSchema, default: () => DEFAULT_SETTINGS },
  },
  { timestamps: true },
);

userSchema.index({ provider: 1, providerAccountId: 1 }, { unique: true });
userSchema.index({ email: 1, provider: 1 });

// `models` is checked first so a re-import (tsx watch, a test reloading the
// module registry) reuses the compiled model instead of throwing
// OverwriteModelError.
export const User =
  (models.User as Model<UserDoc>) ?? model<UserDoc>('User', userSchema);
