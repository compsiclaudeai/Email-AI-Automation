import OpenAI from 'openai';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import type { AutomationSettings } from '../../models/user.model';
import type { Category, Priority } from '../../models/email.model';
import { SYSTEM_PROMPT, buildUserPrompt } from './prompts';
import { isPlaceholderSubject, validateReplyBody } from './safety';

export interface DraftResult {
  category: Category;
  priority: Priority;
  confidence: number;
  reason: string;
  reply: string;
  model: string;
  /** True when the model or our own scanner saw a prompt-injection attempt. */
  injection: boolean;
  /** Everything deterministic validation objected to. Never auto-send if set. */
  problems: string[];
  /** True when no real model ran and the keyword stub produced this. */
  stub: boolean;
}

export interface DraftInput {
  fromName: string;
  fromEmail: string;
  subject: string;
  body: string;
  settings: AutomationSettings;
  /** The mailbox the reply would be sent from. Used to validate the output. */
  ownEmail?: string;
  /**
   * Extra drafting instructions from matched automation rules. Written by the
   * account owner, so they sit above email content in the trust hierarchy —
   * but still below the system prompt.
   */
  instructions?: string[];
  templates?: { name: string; category: string; body: string }[];
  attachments?: {
    filename: string;
    mimeType: string;
    extractedText?: string;
    extractStatus?: string;
    extractDetail?: string;
  }[];
}

let cachedClient: OpenAI | null | undefined;

/**
 * Built on first use rather than at import time.
 *
 * A module-level client meant the whole AI layer was configured the instant
 * anything imported it, which made the configuration impossible to exercise
 * and hid misconfiguration until the first real email arrived.
 */
function getClient(): OpenAI | null {
  if (cachedClient !== undefined) return cachedClient;
  cachedClient = env.openai.apiKey
    ? new OpenAI({
        apiKey: env.openai.apiKey,
        baseURL: env.openai.baseUrl,
        // The SDK's own retry is disabled: retrying is handled below so a
        // 400 "unsupported response_format" can be retried *differently*
        // rather than identically.
        maxRetries: 0,
        timeout: env.openai.timeoutMs,
      })
    : null;
  return cachedClient;
}

// A key with no matching base URL is the most common misconfiguration, and it
// is invisible at runtime because drafting just falls back to the stub.
if (env.openai.apiKey && !env.openai.baseUrl) {
  const prefix = env.openai.apiKey.slice(0, 3);
  if (prefix === 'sk-' && env.openai.apiKey.startsWith('sk-or-')) {
    logger.warn(
      'OPENAI_API_KEY looks like an OpenRouter key but OPENAI_BASE_URL is not set. ' +
        'Set OPENAI_BASE_URL=https://openrouter.ai/api/v1 or every draft falls back to the keyword stub.',
    );
  } else if (prefix === 'nva') {
    logger.warn(
      'OPENAI_API_KEY looks like an NVIDIA key but OPENAI_BASE_URL is not set. ' +
        'Set OPENAI_BASE_URL=https://integrate.api.nvidia.com/v1',
    );
  }
}

/**
 * The last time a model call failed, and why.
 *
 * The failure was only ever written to the server log. On a hosted backend
 * that means nobody sees it: the product carries on producing template drafts
 * and looks like it is working. This is surfaced through /automation/status so
 * the dashboard can name the actual error.
 */
export interface AiFailure {
  at: string;
  /** HTTP status, or 'network' when the endpoint could not be reached. */
  status: string;
  /** Provider message, truncated. Never contains email content. */
  message: string;
  hint?: string;
}

let lastFailure: AiFailure | null = null;
let lastSuccessAt: string | null = null;

export function aiHealth() {
  return {
    configured: !env.openai.mock && Boolean(env.openai.apiKey),
    model: env.openai.model,
    endpoint: env.openai.baseUrl ?? 'https://api.openai.com/v1',
    lastSuccessAt,
    lastFailure,
  };
}

/** Turns a provider error into something a person can act on. */
function explain(status: string, message: string): string | undefined {
  const m = message.toLowerCase();
  if (status === '401' || status === '403') {
    return 'The key is being rejected. Check that OPENAI_API_KEY belongs to the provider at OPENAI_BASE_URL.';
  }
  if (status === '404' || m.includes('no endpoints') || m.includes('not a valid model')) {
    return `The model "${env.openai.model}" does not exist at this endpoint, or has no available provider right now. Try a different OPENAI_MODEL.`;
  }
  if (status === '429' || m.includes('rate limit')) {
    return 'Rate limited. Free tiers throttle hard — a paid or less busy model will hold up better.';
  }
  if (status === '402' || m.includes('credit') || m.includes('quota')) {
    return 'The account is out of credit or quota at this provider.';
  }
  if (status === 'network') {
    return 'The endpoint could not be reached at all. Check OPENAI_BASE_URL and outbound network access from the server.';
  }
  if (m.includes('response_format') || m.includes('json')) {
    return 'This model does not support JSON mode. The app retries without it automatically.';
  }
  return undefined;
}

const CATEGORIES: Category[] = ['invoice', 'support', 'hr', 'sales', 'marketing', 'spam', 'other'];
const PRIORITIES: Priority[] = ['high', 'medium', 'low'];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Classifies an email and drafts a reply.
 *
 * Falls back to a deterministic keyword stub when AI_MOCK is on or no key is
 * configured, so the whole pipeline stays runnable without an account. The
 * stub is always marked `stub: true` and is never treated as confident enough
 * to auto-send.
 */
export async function draftReply(input: DraftInput): Promise<DraftResult> {
  const built = buildUserPrompt({ ...input, templates: input.templates ?? [] });

  const client = getClient();
  if (env.openai.mock || !client) {
    return finalise(mockDraft(input), input, built.flags);
  }

  const attempts = env.openai.maxRetries + 1;
  let lastError: unknown;
  let allowJsonMode = true;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const completion = await client.chat.completions.create(
        {
          model: env.openai.model,
          temperature: 0.3,
          max_tokens: env.openai.maxTokens,
          ...(allowJsonMode ? { response_format: { type: 'json_object' as const } } : {}),
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: built.prompt },
          ],
        },
        { timeout: env.openai.timeoutMs },
      );

      const raw = completion.choices[0]?.message?.content ?? '';
      const parsed = parse(raw);
      lastSuccessAt = new Date().toISOString();
      lastFailure = null;
      return finalise({ ...parsed, model: env.openai.model, stub: false }, input, built.flags);
    } catch (e) {
      lastError = e;

      // Plenty of OpenAI-compatible gateways (and most free OpenRouter models)
      // reject response_format outright. Retrying without it is the difference
      // between working automation and every reply silently coming from the stub.
      //
      // The retry no longer waits for the error message to confirm the cause.
      // Google's Gemini OpenAI-compatibility endpoint returns a 404 with an
      // empty or unparseable body for some accounts/models — the openai SDK
      // then reports it as "{status} status code (no body)", which contains
      // none of the text this check used to require. A blind retry without
      // response_format is one extra request, never wrong when the parameter
      // really was the problem, and harmless when it wasn't — a genuinely
      // different failure still surfaces clearly on the next attempt.
      if (allowJsonMode && isPossibleJsonModeIssue(e)) {
        logger.warn(
          `${statusOf(e) ?? '?'} with an unreadable body — retrying without response_format ` +
            'in case the model rejects JSON mode',
        );
        allowJsonMode = false;
        continue;
      }

      if (attempt < attempts && isRetryable(e)) {
        const backoff = Math.min(8000, 400 * 2 ** (attempt - 1)) + Math.random() * 250;
        logger.warn(`AI draft attempt ${attempt}/${attempts} failed — retrying in ${Math.round(backoff)}ms`);
        await sleep(backoff);
        continue;
      }
      break;
    }
  }

  // Loud on purpose: a silent fallback looks like working automation while
  // every reply is really a canned template. The email itself is never logged.
  const status = String(statusOf(lastError) ?? 'network');
  let message = (lastError instanceof Error ? lastError.message : String(lastError)).slice(0, 300);

  // The provider sent something, but the SDK could not read it as JSON — an
  // empty or compressed body it failed to decode. Said plainly, so a blank
  // "(no body)" on the dashboard doesn't read as Google returning literally
  // nothing, when the real reason is simply unreadable from here.
  if (/status code \(no body\)/i.test(message)) {
    message += ' — the provider sent an error but this app could not read its contents.';
  }

  lastFailure = { at: new Date().toISOString(), status, message, hint: explain(status, message) };

  logger.error(
    `AI draft FAILED at ${env.openai.baseUrl ?? 'https://api.openai.com/v1'} ` +
      `(model ${env.openai.model}, status ${status}) — falling back to the keyword stub`,
    message,
  );
  if (lastFailure.hint) logger.error(`  → ${lastFailure.hint}`);
  return finalise(mockDraft(input), input, built.flags);
}

/* --------------------------- error classification ----------------------- */

function statusOf(e: unknown): number | undefined {
  const s = (e as { status?: number; response?: { status?: number } })?.status;
  return s ?? (e as { response?: { status?: number } })?.response?.status;
}

function isRetryable(e: unknown): boolean {
  const status = statusOf(e);
  if (status === undefined) return true; // network / timeout / abort
  if (status === 429) return true;
  return status >= 500;
}

/**
 * True for any status a rejected `response_format` typically produces.
 *
 * Deliberately does not require the error message to name the parameter.
 * Some gateways say so explicitly ("response_format not supported"); Google's
 * Gemini OpenAI-compatibility layer instead returns a bare 404 with a body
 * the client cannot parse, which previously meant this check never fired and
 * every Gemini account fell straight to the offline stub.
 */
function isPossibleJsonModeIssue(e: unknown): boolean {
  const status = statusOf(e);
  return status === 400 || status === 404 || status === 422;
}

/* ------------------------------- parsing -------------------------------- */

/** Pulls the first balanced JSON object out of a response that may have prose. */
function extractJson(raw: string): string {
  const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  if (cleaned.startsWith('{')) return cleaned;
  const start = cleaned.indexOf('{');
  if (start === -1) return '{}';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (escaped) { escaped = false; continue; }
    if (c === '\\') { escaped = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === '{') depth++;
    if (c === '}') {
      depth--;
      if (depth === 0) return cleaned.slice(start, i + 1);
    }
  }
  return '{}';
}

/** Coerces anything to a 0-100 integer. NaN must never survive this. */
function toConfidence(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(Math.max(0, Math.min(100, n)));
}

type ParsedDraft = Omit<DraftResult, 'model' | 'problems' | 'stub'>;

function parse(raw: string): ParsedDraft {
  let j: Record<string, unknown> = {};
  try {
    j = JSON.parse(extractJson(raw)) as Record<string, unknown>;
  } catch {
    // Not JSON at all. Rather than throw away the generation, treat the whole
    // thing as an unvetted draft with zero confidence so a human sees it.
    return {
      category: 'other',
      priority: 'medium',
      confidence: 0,
      injection: false,
      reason: 'The model did not return valid JSON, so this draft is unverified.',
      reply: raw.slice(0, 4000).trim(),
    };
  }

  return {
    category: CATEGORIES.includes(j.category as Category) ? (j.category as Category) : 'other',
    priority: PRIORITIES.includes(j.priority as Priority) ? (j.priority as Priority) : 'medium',
    confidence: toConfidence(j.confidence),
    injection: j.injection === true || j.injection === 'true',
    reason: String(j.reason ?? 'No reason returned by the model.').slice(0, 500),
    reply: typeof j.reply === 'string' ? j.reply : '',
  };
}

/* ------------------------- deterministic post-check --------------------- */

/**
 * Everything the model returned now goes through code that does not trust it.
 * Confidence can only ever go down here, never up.
 */
function finalise(
  draft: ParsedDraft & { model: string; stub: boolean },
  input: DraftInput,
  scannerFlags: string[],
): DraftResult {
  const problems: string[] = [];
  let { confidence, reply, reason } = draft;
  const injection = draft.injection || scannerFlags.length > 0;

  if (reply.trim()) {
    const check = validateReplyBody(reply, {
      recipient: input.fromEmail,
      ownEmail: input.ownEmail ?? '',
    });
    reply = check.body;
    problems.push(...check.problems);
  }

  if (injection) {
    problems.push(
      scannerFlags.length
        ? `The email contains prompt-injection patterns (${scannerFlags.join(', ')}).`
        : 'The model reported a prompt-injection attempt in this email.',
    );
    confidence = Math.min(confidence, 10);
    reason = 'Held for review: this email tried to give the AI instructions.';
  }

  // A stub draft is a canned template, not a considered reply. It must never
  // clear a high confidence threshold on its own.
  if (draft.stub) confidence = Math.min(confidence, 60);

  // Anything deterministic validation objected to caps confidence too, so the
  // gate downstream holds it for a human without needing to know the details.
  if (problems.length) confidence = Math.min(confidence, 40);

  return { ...draft, confidence, reply, reason, injection, problems };
}

/**
 * A usable first name.
 *
 * Mail servers often supply no display name, and the local part gets used
 * instead — which produced greetings like "Hello Hassan.Siraj," and
 * "Hello sales.support,". Separators are split on and the result is cased.
 */
export function greetingName(fromName: string, fromEmail = ''): string {
  const raw = (fromName || '').trim() || (fromEmail.split('@')[0] ?? '');
  const first = raw
    .replace(/["<>]/g, '')
    .split(/[\s._\-+]+/)
    .filter(Boolean)[0];
  if (!first || /^\d+$/.test(first) || first.length < 2) return 'there';
  return first.charAt(0).toUpperCase() + first.slice(1);
}

/* ----------------------------- offline stub ----------------------------- */

const RULES: { match: RegExp; category: Category; priority: Priority; confidence: number }[] = [
  { match: /invoice|payment|receipt|paid|remittance/i, category: 'invoice', priority: 'medium', confidence: 93 },
  { match: /quote|quotation|pricing|purchase|order|tender/i, category: 'sales', priority: 'high', confidence: 78 },
  { match: /cv|resume|vacancy|reference check|employment|salary/i, category: 'hr', priority: 'medium', confidence: 58 },
  { match: /unsubscribe|newsletter|limited time|% off|promo/i, category: 'marketing', priority: 'low', confidence: 96 },
  { match: /warranty|repair|fault|not working|error|jam|replace|service/i, category: 'support', priority: 'high', confidence: 82 },
];

function mockDraft(input: DraftInput): ParsedDraft & { model: string; stub: boolean } {
  const haystack = `${input.subject} ${input.body}`;
  const hit = RULES.find((r) => r.match.test(haystack));
  const model = 'keyword-stub (no real model ran)';

  if (/unsubscribe|limited time|% off/i.test(haystack)) {
    return {
      category: 'spam',
      priority: 'low',
      confidence: 97,
      injection: false,
      reason: 'Bulk marketing pattern — filed without a reply.',
      reply: '',
      model,
      stub: true,
    };
  }

  const category = hit?.category ?? 'other';
  const firstName = greetingName(input.fromName, input.fromEmail);
  const subject = (input.subject || '').replace(/["\r\n]/g, ' ').slice(0, 160);

  // Quoting our own "(no subject)" placeholder back at the customer is worse
  // than saying nothing about the subject at all.
  const about = isPlaceholderSubject(input.subject)
    ? 'Thank you for your email.'
    : `Thank you for your email regarding "${subject}".`;

  const reply = `Hello ${firstName},

${about}

We have logged your request and a member of our team is reviewing it now. You will receive a full response shortly, and we will confirm any dates or costs before proceeding.

If anything is urgent in the meantime, reply to this thread and it will be prioritised.`;

  return {
    category,
    priority: hit?.priority ?? 'medium',
    confidence: hit?.confidence ?? 65,
    injection: false,
    reason: hit
      ? `Offline stub: matched the ${category} keyword pattern. No AI model answered, so this is a template.`
      : 'Offline stub: no keyword pattern matched, so this template is generic and needs a human.',
    reply,
    model,
    stub: true,
  };
}