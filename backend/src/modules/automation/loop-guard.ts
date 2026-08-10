/**
 * Reply-loop protection.
 *
 * An automation that answers everything will happily answer its own bounce
 * messages, an out-of-office responder, or another bot — and each reply
 * provokes the next one. Everything here is a hard block: these checks run
 * before the model is called and again before anything is sent, so a
 * mis-scored draft can never route around them.
 */

export interface LoopCheckInput {
  fromEmail: string;
  subject: string;
  toEmail: string;
  /** The mailbox this automation is running for. */
  ownEmail: string;
  /** Raw headers we were able to read, lower-cased keys. Optional. */
  headers?: Record<string, string>;
  /** How many replies we have already sent into this thread. */
  repliesAlreadySent?: number;
  /** How many replies we have sent to this sender in the recent window. */
  repliesToSenderRecently?: number;
}

export interface LoopCheckResult {
  block: boolean;
  reason: string;
  /** Short machine-readable code, useful in logs and tests. */
  code?:
    | 'self'
    | 'no_reply'
    | 'bounce'
    | 'auto_reply'
    | 'list_mail'
    | 'thread_cap'
    | 'sender_cap';
}

const PASS: LoopCheckResult = { block: false, reason: 'No loop risk detected.' };

/** Local-parts that must never receive an automated reply. */
const NO_REPLY_LOCAL =
  /^(no[-._]?reply|do[-._]?not[-._]?reply|donotreply|noreply|bounce[sd]?|mailer[-._]?daemon|postmaster|abuse|listserv|majordomo|notifications?|alerts?|automated?|robot|bot)([-._+].*)?$/i;

/** Subjects that mark a message as machine-generated. */
const BOUNCE_SUBJECT =
  /(undeliverable|delivery status notification|delivery has failed|returned mail|mail delivery (failed|subsystem)|failure notice|message could not be delivered)/i;

const AUTO_SUBJECT =
  /(out of (the )?office|auto(matic)?[- ]?(reply|response|responder)|automatische antwort|réponse automatique|respuesta automática|vacation reply|away from my desk|abwesenheit)/i;

/** Cheap, high-signal check for a message we have already replied to twice. */
const THREAD_REPLY_CAP = 3;
const SENDER_REPLY_CAP = 6;

function localPart(address: string): string {
  return address.split('@')[0] ?? '';
}

function normalise(address: string | undefined): string {
  return (address ?? '').trim().toLowerCase();
}

/**
 * Strips the +tag from a Gmail-style address so `ops+tickets@x.com` is still
 * recognised as our own mailbox.
 */
function canonical(address: string): string {
  const [local = '', domain = ''] = normalise(address).split('@');
  return `${local.split('+')[0]}@${domain}`;
}

export function checkReplyLoop(input: LoopCheckInput): LoopCheckResult {
  const from = normalise(input.fromEmail);
  const own = normalise(input.ownEmail);
  const subject = input.subject ?? '';
  const headers = input.headers ?? {};

  // 1. Never reply to ourselves. This is the loop that actually runs away.
  if (from && own && canonical(from) === canonical(own)) {
    return {
      block: true,
      code: 'self',
      reason: 'The sender is this mailbox — replying would loop against itself.',
    };
  }

  // 2. RFC 3834 and the de-facto headers every autoresponder sets.
  const auto = (headers['auto-submitted'] ?? '').toLowerCase();
  if (auto && auto !== 'no') {
    return {
      block: true,
      code: 'auto_reply',
      reason: 'Message is marked Auto-Submitted — an automated reply would bounce back.',
    };
  }
  if (headers['x-autoreply'] || headers['x-autorespond'] || headers['x-auto-response-suppress']) {
    return {
      block: true,
      code: 'auto_reply',
      reason: 'Message carries an autoresponder header.',
    };
  }
  if (String(headers['precedence'] ?? '').match(/^(bulk|list|junk|auto_reply)$/i)) {
    return {
      block: true,
      code: 'list_mail',
      reason: 'Message is bulk or list traffic (Precedence header).',
    };
  }
  if (headers['list-unsubscribe'] || headers['list-id']) {
    return {
      block: true,
      code: 'list_mail',
      reason: 'Message came from a mailing list — no reply is expected.',
    };
  }
  // A null Return-Path is the standard marker of a bounce.
  if (normalise(headers['return-path']) === '<>') {
    return { block: true, code: 'bounce', reason: 'Null return path — this is a bounce message.' };
  }

  // 3. Addresses that never want a reply.
  if (from && NO_REPLY_LOCAL.test(localPart(from))) {
    return {
      block: true,
      code: 'no_reply',
      reason: `${from} is a no-reply or system address.`,
    };
  }

  // 4. Subject patterns, for servers that set no useful headers at all.
  if (BOUNCE_SUBJECT.test(subject)) {
    return { block: true, code: 'bounce', reason: 'Subject matches a delivery failure notice.' };
  }
  if (AUTO_SUBJECT.test(subject)) {
    return { block: true, code: 'auto_reply', reason: 'Subject matches an out-of-office reply.' };
  }

  // 5. Volume caps. Even with legitimate correspondents, an automation that has
  //    already answered three times in one thread is almost certainly ping-ponging.
  if ((input.repliesAlreadySent ?? 0) >= THREAD_REPLY_CAP) {
    return {
      block: true,
      code: 'thread_cap',
      reason: `Already sent ${input.repliesAlreadySent} automated replies in this thread — handing over to a human.`,
    };
  }
  if ((input.repliesToSenderRecently ?? 0) >= SENDER_REPLY_CAP) {
    return {
      block: true,
      code: 'sender_cap',
      reason: `Already sent ${input.repliesToSenderRecently} replies to this sender today — handing over to a human.`,
    };
  }

  return PASS;
}

export const LOOP_GUARD_LIMITS = { THREAD_REPLY_CAP, SENDER_REPLY_CAP };
