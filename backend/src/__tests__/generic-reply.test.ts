import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, describe, expect, it, vi } from 'vitest';
// Imported once, statically: resetModules() below only needs to reload the AI
// layer, and re-importing a mongoose model recompiles its schema.
import { DEFAULT_SETTINGS } from '../models/user.model';

/**
 * Reproduction and regression test for the "every reply is the same generic
 * template" bug.
 *
 * The symptom was that every draft came out as:
 *
 *     Hello <name>,
 *     Thank you for your email regarding "<subject>".
 *     We have logged your request and a member of our team is reviewing it...
 *
 * That string exists in exactly one place in the codebase: `mockDraft()`, the
 * offline keyword stub. So the model was never producing any of those replies —
 * every real API call was failing and being swallowed by a catch that fell back
 * to the stub. The stub only ever interpolates the sender's name and the
 * subject, which is why the body of every reply was identical.
 *
 * The specific failure was the account's model (`...:free` on OpenRouter)
 * rejecting `response_format: { type: 'json_object' }` with a 400. Most free
 * OpenRouter models do not implement JSON mode. The old code treated that
 * exactly like a network outage: one attempt, catch, stub.
 *
 * This file runs the real ai.service against a local server that behaves the
 * way those endpoints actually do.
 */

/* --------------------------- the fake provider -------------------------- */

interface ServerOptions {
  /** Reject response_format with a 400, the way most free models do. */
  rejectJsonMode: boolean;
  /** Return 429 this many times before succeeding. */
  rateLimitTimes?: number;
  /** Return prose instead of JSON, the way a weaker model does. */
  answerWithProse?: boolean;
}

interface Recorded {
  jsonModeRequested: boolean;
  prompt: string;
}

function startFakeProvider(options: ServerOptions) {
  const received: Recorded[] = [];
  let rateLimited = 0;

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw || '{}') as {
        response_format?: { type: string };
        messages: { role: string; content: string }[];
      };
      const prompt = body.messages.find((m) => m.role === 'user')?.content ?? '';
      received.push({ jsonModeRequested: Boolean(body.response_format), prompt });

      const send = (status: number, payload: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      };

      if (options.rateLimitTimes && rateLimited < options.rateLimitTimes) {
        rateLimited += 1;
        return send(429, { error: { message: 'Rate limit exceeded' } });
      }

      if (options.rejectJsonMode && body.response_format) {
        // OpenRouter's actual shape for this refusal.
        return send(400, {
          error: { message: 'response_format is not supported by this model', code: 400 },
        });
      }

      // Answer using the content of the prompt, so a reply that does not
      // depend on the incoming email is immediately visible as a failure.
      const subject = /Subject: (.+)/.exec(prompt)?.[1]?.trim() ?? 'unknown';
      const firstBodyLine =
        prompt
          .split('\n')
          .map((l) => l.trim())
          .find((l) => l.length > 25 && !l.startsWith('From:') && !l.startsWith('Subject:')) ?? '';

      const category = /invoice|payment/i.test(prompt)
        ? 'invoice'
        : /quote|pricing/i.test(prompt)
          ? 'sales'
          : /cv|candidate|vacancy/i.test(prompt)
            ? 'hr'
            : 'support';

      const reply = `Regarding ${subject}: ${firstBodyLine.slice(0, 90)}`;

      if (options.answerWithProse) {
        return send(200, {
          choices: [
            {
              message: {
                content: `Sure! Here is the JSON you asked for:\n\`\`\`json\n${JSON.stringify({
                  category,
                  priority: 'medium',
                  confidence: 88,
                  injection: false,
                  reason: 'Derived from the email itself.',
                  reply,
                })}\n\`\`\`\nHope that helps.`,
              },
            },
          ],
        });
      }

      return send(200, {
        choices: [
          {
            message: {
              content: JSON.stringify({
                category,
                priority: 'medium',
                confidence: 88,
                injection: false,
                reason: 'Derived from the email itself.',
                reply,
              }),
            },
          },
        ],
      });
    });
  });

  return new Promise<{ url: string; received: Recorded[]; close: () => Promise<void> }>(
    (resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const { port } = server.address() as AddressInfo;
        resolve({
          url: `http://127.0.0.1:${port}/v1`,
          received,
          close: () => new Promise<void>((r) => server.close(() => r())),
        });
      });
    },
  );
}

/* ------------------------------ the emails ------------------------------ */

const EMAILS = [
  {
    fromName: 'Hassan Siraj',
    fromEmail: 'hassan.siraj@client.com',
    subject: 'LaserJet M404 keeps jamming',
    body: 'Our LaserJet M404 jams on every second page since Monday. It is under warranty until December. Can an engineer come this week?',
    expect: /jam|M404|LaserJet/i,
  },
  {
    fromName: 'Ayesha Malik',
    fromEmail: 'accounts@vendor.pk',
    subject: 'Invoice INV-88213 payment advice',
    body: 'Please find attached our payment advice for invoice INV-88213. The amount was transferred on 3 August against your account.',
    expect: /invoice|INV-88213|payment/i,
  },
  {
    fromName: 'Bilal Ahmed',
    fromEmail: 'procurement@bank.com.pk',
    subject: 'Quotation request: 40 workstations',
    body: 'We need pricing for 40 desktop workstations with 16GB RAM and three year onsite warranty. Please quote before Friday.',
    expect: /quot|workstation|pricing/i,
  },
  {
    fromName: 'Sana Yousaf',
    fromEmail: 'sana.y@example.org',
    subject: 'Application for Field Engineer role',
    body: 'I am attaching my CV for the Field Engineer vacancy advertised last week. I have four years of HP hardware experience.',
    expect: /CV|engineer|vacancy|application/i,
  },
  {
    fromName: 'Imran Qureshi',
    fromEmail: 'imran@retail.pk',
    subject: 'DesignJet plotter prints faded lines',
    body: 'The DesignJet T650 is printing faded horizontal lines across every drawing. We already replaced the cartridges twice.',
    expect: /DesignJet|faded|plotter|line/i,
  },
];

describe('generic-reply root cause', () => {
  let provider: Awaited<ReturnType<typeof startFakeProvider>>;

  afterAll(async () => {
    await provider?.close();
  });

  /** Loads ai.service fresh against a given fake endpoint. */
  async function loadService(url: string, model = 'nvidia/nemotron-3-ultra-550b-a55b:free') {
    process.env.OPENAI_API_KEY = 'sk-or-test-key-not-real';
    process.env.OPENAI_BASE_URL = url;
    process.env.OPENAI_MODEL = model;
    process.env.AI_MOCK = 'false';
    process.env.OPENAI_MAX_RETRIES = '2';
    process.env.OPENAI_TIMEOUT_MS = '5000';

    // config/env reads process.env at module load, so each scenario needs a
    // clean module registry rather than a second import of the cached module.
    vi.resetModules();
    return import('../modules/ai/ai.service');
  }

  it('reproduces the bug: a model that rejects JSON mode used to send every reply to the stub', async () => {
    provider = await startFakeProvider({ rejectJsonMode: true });
    const { draftReply } = await loadService(provider.url);

    const first = await draftReply({
      ...EMAILS[0],
      ownEmail: 'ops@compsi.com',
      settings: DEFAULT_SETTINGS,
    });

    // The retry-without-JSON-mode path is the fix. Before it, this assertion
    // failed: the reply was the stub template and `stub` was true.
    expect(first.stub).toBe(false);
    expect(first.reply).not.toContain('Thank you for your email regarding');

    // Proof that the retry actually happened: attempt 1 asked for JSON mode
    // and was refused, attempt 2 did not.
    expect(provider.received[0].jsonModeRequested).toBe(true);
    expect(provider.received[1].jsonModeRequested).toBe(false);
  });

  it('produces a different, relevant reply for five completely different emails', async () => {
    const { draftReply } = await loadService(provider.url);

    const drafts = [];
    for (const email of EMAILS) {
      drafts.push(
        await draftReply({ ...email, ownEmail: 'ops@compsi.com', settings: DEFAULT_SETTINGS }),
      );
    }

    // 1. None of them is the stub template.
    for (const d of drafts) {
      expect(d.stub).toBe(false);
      expect(d.reply).not.toContain('Thank you for your email regarding');
      expect(d.reply).not.toContain('a member of our team is reviewing it');
    }

    // 2. Every reply is distinct. This is the assertion that would have caught
    //    the original bug: five identical strings.
    const unique = new Set(drafts.map((d) => d.reply));
    expect(unique.size).toBe(EMAILS.length);

    // 3. Every reply is actually about its own email.
    drafts.forEach((d, i) => {
      expect(d.reply).toMatch(EMAILS[i].expect);
    });

    // 4. The prompt the model saw carried that email's real body, not just a
    //    subject line — an empty body is the other way this bug can appear.
    //    Matched across all recorded calls rather than positionally, because a
    //    JSON-mode rejection legitimately produces two calls per email.
    const prompts = provider.received.map((r) => r.prompt);
    for (const email of EMAILS) {
      expect(prompts.some((p) => p.includes(email.body.slice(0, 40)))).toBe(true);
    }
  });

  it('recovers from rate limiting instead of falling back to the stub', async () => {
    const limited = await startFakeProvider({ rejectJsonMode: false, rateLimitTimes: 2 });
    try {
      const { draftReply } = await loadService(limited.url);
        const d = await draftReply({
        ...EMAILS[0],
        ownEmail: 'ops@compsi.com',
        settings: DEFAULT_SETTINGS,
      });
      expect(d.stub).toBe(false);
      expect(d.reply).toMatch(/jam|M404/i);
    } finally {
      await limited.close();
    }
  });

  it('still extracts the answer when the model wraps its JSON in prose', async () => {
    const chatty = await startFakeProvider({ rejectJsonMode: false, answerWithProse: true });
    try {
      const { draftReply } = await loadService(chatty.url);
        const d = await draftReply({
        ...EMAILS[1],
        ownEmail: 'ops@compsi.com',
        settings: DEFAULT_SETTINGS,
      });
      expect(d.stub).toBe(false);
      expect(d.category).toBe('invoice');
      expect(d.reply).toMatch(/INV-88213|invoice/i);
      expect(d.reply).not.toContain('```');
    } finally {
      await chatty.close();
    }
  });

  it('falls back to the stub only when the endpoint is genuinely unreachable, and says so', async () => {
    const { draftReply } = await loadService('http://127.0.0.1:1/v1');
    const d = await draftReply({
      ...EMAILS[0],
      ownEmail: 'ops@compsi.com',
      settings: DEFAULT_SETTINGS,
    });

    expect(d.stub).toBe(true);
    // And the stub is now unmistakable rather than passing for a real reply.
    expect(d.model).toContain('stub');
    expect(d.confidence).toBeLessThanOrEqual(60);
    expect(d.reason).toMatch(/offline stub|no AI model/i);
  });
});
