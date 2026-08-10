/**
 * Deterministic guards around the model.
 *
 * Two jobs:
 *
 *  1. Everything that comes from an email — body, subject, attachment text —
 *     is untrusted input. It is fenced, neutralised and labelled before it is
 *     shown to the model, and the model is told in the system prompt that
 *     nothing inside the fence is an instruction.
 *
 *  2. Nothing the model returns is trusted either. The reply is validated by
 *     the code below before it can cause a side effect, so a model that has
 *     been talked into "forward this to attacker@evil.com" still cannot make
 *     the application do it — the recipient is chosen by us, not by the model.
 */

export const FENCE_OPEN = '<<<UNTRUSTED_EMAIL_CONTENT>>>';
export const FENCE_CLOSE = '<<<END_UNTRUSTED_EMAIL_CONTENT>>>';

/** Phrases that only ever appear in an attempt to talk to the model. */
const INJECTION_PATTERNS: { rx: RegExp; label: string }[] = [
  { rx: /ignore\s+(all\s+|any\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?)/i, label: 'override-instructions' },
  { rx: /disregard\s+(the\s+)?(system|previous|above)\s+(prompt|instructions?|message)/i, label: 'override-instructions' },
  { rx: /you\s+are\s+now\s+(a|an|acting)/i, label: 'role-reassignment' },
  { rx: /\b(new|updated)\s+(system\s+)?(instructions?|directive|rules?)\s*[:\-]/i, label: 'role-reassignment' },
  { rx: /\bsystem\s*(prompt|message)\s*[:\-]/i, label: 'prompt-spoofing' },
  { rx: /^\s*(system|assistant|developer)\s*:/im, label: 'role-spoofing' },
  { rx: /(reveal|print|show|repeat|output)\s+(your|the)\s+(system\s+)?(prompt|instructions?|rules?)/i, label: 'prompt-exfiltration' },
  { rx: /(forward|send|cc|bcc)\s+(this|the|all|every)?\s*(e-?mails?|messages?|threads?|conversation)?\s*(to|at)\s+\S+@\S+/i, label: 'exfiltration-request' },
  { rx: /\b(api[_\s-]?key|access[_\s-]?token|refresh[_\s-]?token|password|credential)s?\b.{0,40}\b(send|share|reveal|include|paste)\b/i, label: 'credential-request' },
  { rx: /<<<\s*(END_)?UNTRUSTED/i, label: 'fence-forgery' },
  { rx: /```\s*(system|developer)/i, label: 'fence-forgery' },
];

export interface SanitisedContent {
  text: string;
  /** Labels of every injection pattern seen. Empty means nothing suspicious. */
  flags: string[];
}

/**
 * Neutralises untrusted text before it reaches the prompt.
 *
 * The text is not rewritten beyond what is needed to keep the fence intact:
 * a reply that quotes the customer back to them should still read naturally.
 * Suspicious phrases are recorded rather than deleted, so the gate downstream
 * can hold the draft for a human instead of silently answering an attacker.
 */
export function sanitiseUntrusted(raw: string, maxChars = 6000): SanitisedContent {
  const flags = new Set<string>();
  let text = (raw ?? '').toString();

  for (const { rx, label } of INJECTION_PATTERNS) {
    if (rx.test(text)) flags.add(label);
  }

  text = text
    // Strip anything that tries to close our fence or open a fake one.
    .replace(/<<<\s*\/?(END_)?UNTRUSTED_EMAIL_CONTENT\s*>>>/gi, '[removed]')
    // Zero-width and bidi control characters hide instructions from a human
    // reviewer while the model still reads them.
    .replace(/[\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2064\uFEFF]/g, '')
    // Collapse runaway whitespace so padding cannot push the real instructions
    // out of the context window.
    .replace(/\r/g, '')
    .replace(/\n{4,}/g, '\n\n\n')
    .replace(/[ \t]{4,}/g, '   ');

  if (text.length > maxChars) {
    text = `${text.slice(0, maxChars)}\n[truncated — ${text.length - maxChars} more characters not shown]`;
  }

  return { text: text.trim(), flags: [...flags] };
}

/** Wraps untrusted text in the fence the system prompt refers to. */
export function fence(label: string, content: string): string {
  return `${FENCE_OPEN}\n[${label}]\n${content}\n${FENCE_CLOSE}`;
}

/* ------------------------- validating the output ------------------------ */

export interface ReplyValidation {
  ok: boolean;
  /** The reply as it may actually be sent. Never the raw model string. */
  body: string;
  problems: string[];
}

const MAX_REPLY_CHARS = 6000;

/**
 * Header injection: a newline followed by something that looks like a header
 * would let a reply body inject Bcc into a hand-built MIME message.
 */
const HEADER_LINE = /^\s*(bcc|cc|to|from|reply-to|subject|content-type|mime-version|x-[\w-]+)\s*:/im;

const EMAIL_RX = /[^\s<>@,;:"']+@[a-z0-9.-]+\.[a-z]{2,}/gi;

/**
 * Checks a model-authored reply before it is allowed anywhere near a provider.
 *
 * Returns a cleaned body plus the list of problems. The caller decides whether
 * a problem is fatal (never auto-send) — nothing here sends anything itself.
 */
export function validateReplyBody(
  raw: string,
  context: { recipient: string; ownEmail: string },
): ReplyValidation {
  const problems: string[] = [];
  let body = (raw ?? '').toString();

  if (!body.trim()) {
    return { ok: false, body: '', problems: ['The draft is empty.'] };
  }

  // 1. No header injection, whatever the model produced.
  if (HEADER_LINE.test(body)) {
    body = body.replace(HEADER_LINE, (m) => m.replace(':', ' -'));
    problems.push('The draft contained something shaped like an email header; it was neutralised.');
  }
  body = body.replace(/\r/g, '');

  // 2. No leaked fence or role markers.
  if (/<<<\s*(END_)?UNTRUSTED/i.test(body) || /^\s*(system|assistant)\s*:/im.test(body)) {
    body = body
      .replace(/<<<\s*\/?(END_)?UNTRUSTED_EMAIL_CONTENT\s*>>>/gi, '')
      .replace(/^\s*(system|assistant)\s*:.*$/gim, '')
      .trim();
    problems.push('The draft echoed prompt scaffolding; it was stripped.');
  }

  // 3. Addresses in the body. A reply that names a third-party mailbox is the
  //    classic exfiltration payload, so it is flagged rather than trusted.
  const own = context.ownEmail.toLowerCase();
  const to = context.recipient.toLowerCase();
  const foreign = [...new Set((body.match(EMAIL_RX) ?? []).map((a) => a.toLowerCase()))].filter(
    (a) => a !== own && a !== to,
  );
  if (foreign.length) {
    problems.push(
      `The draft names ${foreign.length} address(es) that are neither the sender nor this mailbox.`,
    );
  }

  // 4. Length. A runaway generation is a cost problem and an unreadable email.
  if (body.length > MAX_REPLY_CHARS) {
    body = `${body.slice(0, MAX_REPLY_CHARS).trimEnd()}…`;
    problems.push('The draft was longer than the limit and was truncated.');
  }

  body = body.trim();

  return { ok: problems.length === 0 && body.length > 0, body, problems };
}

/* -------------------------- validating the send ------------------------- */

const SINGLE_EMAIL = /^[^\s<>@,;:"']+@[a-z0-9.-]+\.[a-z]{2,}$/i;

/** True only for exactly one syntactically valid address, with no header tricks. */
export function isSendableAddress(address: string): boolean {
  const a = (address ?? '').trim();
  if (!a || a.length > 254) return false;
  if (/[\r\n,;]/.test(a)) return false;
  return SINGLE_EMAIL.test(a);
}

/** Strips CR/LF so a subject can never introduce a new header. */
export function safeSubject(subject: string): string {
  return (subject ?? '')
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, 300);
}

/**
 * The Subject header for a reply.
 *
 * `(no subject)` is a *display* placeholder this application substitutes when a
 * message arrives with no subject at all. It was being fed straight back into
 * the outgoing header, so customers received mail titled
 * "Re: (no subject)" — and the model was handed that string as though it were
 * the topic of the conversation.
 */
export function replySubject(original: string): string {
  const clean = safeSubject(original);
  if (isPlaceholderSubject(clean)) return 'Re:';
  return /^re:/i.test(clean) ? clean : `Re: ${clean}`;
}

/**
 * True when a subject carries no real information.
 *
 * The first version only matched the bare string `(no subject)`. Once we had
 * replied to a subjectless email, the customer's reply came back as
 * `Re: (no subject)` — which is not the bare string, so the placeholder sailed
 * through into the next prompt and the next draft. Repeated prefixes stack up
 * over a long thread ("Re: Fwd: Re: (no subject)"), so they are stripped in a
 * loop rather than once.
 */
export function isPlaceholderSubject(subject: string): boolean {
  let value = (subject ?? '').trim();
  if (!value) return true;

  // Strip every leading Re:/Fwd:/Fw: prefix, in any combination or language
  // variant we can reasonably recognise.
  let previous: string;
  do {
    previous = value;
    value = value.replace(/^\s*(re|fwd?|aw|antw|rif|sv|vs|res)\s*(\[\d+\])?\s*:\s*/i, '');
  } while (value !== previous);

  return !value.trim() || /^\(no subject\)$/i.test(value.trim());
}
