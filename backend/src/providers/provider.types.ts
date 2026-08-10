export interface FetchedAttachment {
  filename: string;
  mimeType: string;
  size: number;
  externalId?: string;
}

export interface FetchedMessage {
  externalId: string;
  threadId: string;
  fromName: string;
  fromEmail: string;
  toEmail: string;
  subject: string;
  snippet: string;
  body: string;
  receivedAt: Date;
  unread: boolean;
  attachments: FetchedAttachment[];
  /**
   * Lower-cased subset of the raw headers the loop guard needs
   * (Auto-Submitted, Precedence, List-Id, Return-Path...). Optional because
   * not every provider exposes them.
   */
  headers?: Record<string, string>;
}

export interface SendReplyInput {
  to: string;
  subject: string;
  body: string;
  threadId: string;
  /** Provider message id being replied to. */
  inReplyTo: string;
}

/**
 * One interface, three implementations. Everything above the provider layer
 * (sync job, automation service, API) is written against this only.
 */
export interface MailProvider {
  readonly name: 'gmail' | 'graph' | 'imap';
  listRecentMessages(opts: { since?: Date; limit?: number; folder?: string }): Promise<FetchedMessage[]>;
  sendReply(input: SendReplyInput): Promise<{ externalId: string }>;
  markAsRead(externalId: string): Promise<void>;
  /**
   * Fetches one attachment's bytes. Kept separate from listRecentMessages so
   * message sync never pays the cost of downloading files it may not need.
   */
  downloadAttachment(messageExternalId: string, attachmentId: string): Promise<Buffer>;
}
