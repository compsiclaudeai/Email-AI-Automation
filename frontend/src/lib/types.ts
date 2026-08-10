export type EmailStatus = 'unread' | 'pending' | 'replied' | 'failed' | 'ignored';
export type Priority = 'high' | 'medium' | 'low';
export type Category = 'invoice' | 'support' | 'hr' | 'sales' | 'marketing' | 'spam' | 'other';
export type Tone = 'Professional' | 'Friendly' | 'Formal' | 'Casual';
export type ApprovalMode = 'automatic' | 'manual';

export interface Attachment {
  filename: string;
  mimeType: string;
  size: number;
  /**
   * Whether the text could be pulled out for the model. Surfaced so the UI can
   * say an attachment was not read rather than letting the reply imply it was.
   */
  extractStatus?: 'ok' | 'empty' | 'too_large' | 'unsupported' | 'failed' | 'skipped';
  extractDetail?: string;
}

export interface ThreadMessage {
  from: string;
  fromName: string;
  outbound: boolean;
  body: string;
  sentAt: string;
}

export interface Email {
  _id: string;
  fromName: string;
  fromEmail: string;
  subject: string;
  snippet: string;
  body: string;
  receivedAt: string;
  status: EmailStatus;
  priority: Priority;
  category: Category;
  attachments: Attachment[];
  thread: ThreadMessage[];
  aiReply?: string;
  aiConfidence?: number;
  aiReason?: string;
  aiModel?: string;
  aiInjectionSuspected?: boolean;
  aiProblems?: string[];
  aiIsStub?: boolean;
  sendState?: 'idle' | 'sending' | 'sent';
  /** Who caused the send. The UI must never imply AI work was done by hand. */
  sentBy?: 'ai' | 'user';
  sentAt?: string;
  failureReason?: string;
}

export interface EmailPage {
  items: Email[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export interface Counts {
  all: number;
  unread: number;
  pending: number;
  replied: number;
  failed: number;
  ignored: number;
}

export interface Kpi {
  key: string;
  label: string;
  value: number;
  change: number;
  trend: number[];
}

export interface AutomationStatus {
  running: boolean;
  paused: boolean;
  aiConfidence: number;
  queued: number;
  repliedToday: number;
  autoRepliedToday: number;
  failed: number;
  averageReplySeconds: number;
  successRate: number;
  lastSyncAt: string | null;
  mailFolder: string;
  /** False when no model is configured and every draft is a canned template. */
  aiConfigured: boolean;
  ai?: {
    configured: boolean;
    model: string;
    endpoint: string;
    lastSuccessAt: string | null;
    lastFailure: { at: string; status: string; message: string; hint?: string } | null;
  };
  dailySendCap: number;
  sentLast24h: number;
  capReached: boolean;
}

export interface Suggestion {
  key: string;
  count: number;
  title: string;
  detail: string;
}

export interface ActivityItem {
  _id: string;
  type: string;
  title: string;
  detail?: string;
  createdAt: string;
}

export interface Settings {
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
  neverAutoSendMoney: boolean;
  neverAutoSendPersonalData: boolean;
  pauseAfterBounces: number;
  paused: boolean;
  dailySendCap: number;
}

export interface Template {
  _id: string;
  name: string;
  category: Category;
  body: string;
  usageCount: number;
  active: boolean;
}

export interface Me {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
  provider: 'google' | 'microsoft' | 'imap';
  providerLabel: string;
  mailFolder?: string;
  connected: boolean;
  lastSyncAt: string | null;
  settings: Settings;
}

export interface SeriesPoint {
  date: string;
  value: number;
}

export interface Analytics {
  range: { days: number; from: string; to: string };
  received: SeriesPoint[];
  autoReplied: SeriesPoint[];
  pending: SeriesPoint[];
  responseTimeSeconds: SeriesPoint[];
  categories: { category: Category; count: number }[];
  totals: {
    received: number;
    autoReplied: number;
    previousPeriodReceived: number;
    changePercent: number;
  };
  delivery: { delivered: number; failed: number; successRate: number };
}

/* ----------------------------- automation rules ------------------------- */

export interface RuleCondition {
  field:
    | 'from'
    | 'to'
    | 'subject'
    | 'body'
    | 'category'
    | 'priority'
    | 'confidence'
    | 'hasAttachment'
    | 'attachmentText';
  operator:
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
  value?: string;
}

export interface RuleAction {
  type:
    | 'draft_reply'
    | 'auto_send'
    | 'require_approval'
    | 'set_category'
    | 'set_priority'
    | 'use_template'
    | 'add_instruction'
    | 'ignore'
    | 'stop_processing';
  value?: string;
}

export interface Rule {
  _id: string;
  name: string;
  description?: string;
  enabled: boolean;
  priority: number;
  match: 'all' | 'any';
  conditions: RuleCondition[];
  actions: RuleAction[];
  runCount: number;
  lastRunAt?: string;
}

export interface RuleDecision {
  draft: boolean;
  sendMode: 'auto' | 'approval' | 'none';
  ignore: boolean;
  category?: string;
  priority?: string;
  instructions: string[];
  matchedRuleIds: string[];
  trace: string[];
}
