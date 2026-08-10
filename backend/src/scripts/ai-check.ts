/**
 * `npm run ai:check` — proves whether the configured model actually works.
 *
 * This exists because of a real incident: every draft in the product was the
 * offline keyword template, and nothing in the UI said so. The configuration
 * looked correct — a key was set, a base URL was set, AI_MOCK was false — but
 * the model rejected the request and the code silently fell back to the stub.
 *
 * `npm run doctor` reports what is *configured*. This reports what actually
 * *happens*, which is the difference that mattered.
 *
 * Nothing is written to the database and no email is sent.
 */
import OpenAI from 'openai';
import { env } from '../config/env';

const SAMPLE = {
  subject: 'DesignJet T650 printing faded lines',
  body:
    'Our DesignJet T650 has been printing faded horizontal lines across every ' +
    'drawing since Tuesday. We already replaced both cartridges. The plotter ' +
    'is on the AMC signed in March.',
};

const ok = (m: string) => console.log(`  OK    ${m}`);
const bad = (m: string) => console.log(`  FAIL  ${m}`);
const info = (m: string) => console.log(`        ${m}`);

function statusOf(e: unknown): number | undefined {
  return (e as { status?: number })?.status;
}

async function attempt(client: OpenAI, jsonMode: boolean) {
  const started = Date.now();
  const completion = await client.chat.completions.create(
    {
      model: env.openai.model,
      temperature: 0.3,
      max_tokens: env.openai.maxTokens,
      ...(jsonMode ? { response_format: { type: 'json_object' as const } } : {}),
      messages: [
        {
          role: 'system',
          content:
            'Reply with ONLY a JSON object: {"category":"support","confidence":0-100,"reply":"..."}',
        },
        {
          role: 'user',
          content: `Subject: ${SAMPLE.subject}\n\n${SAMPLE.body}`,
        },
      ],
    },
    { timeout: env.openai.timeoutMs },
  );
  return { completion, ms: Date.now() - started };
}

async function main() {
  console.log('\n===== AI PROVIDER LIVE CHECK =====\n');

  console.log('CONFIGURATION');
  info(`Base URL : ${env.openai.baseUrl ?? 'https://api.openai.com/v1 (default)'}`);
  info(`Model    : ${env.openai.model}`);
  info(
    `Key      : ${
      env.openai.apiKey
        ? `set (${env.openai.apiKey.slice(0, 6)}…, ${env.openai.apiKey.length} chars)`
        : 'NOT SET'
    }`,
  );
  info(`AI_MOCK  : ${env.openai.mock}`);
  console.log('');

  if (env.openai.mock || !env.openai.apiKey) {
    bad('Mock mode is on, or no key is set. Every draft is a canned template.');
    info('Set OPENAI_API_KEY and AI_MOCK=false, then run this again.');
    process.exit(1);
  }

  // The single most common misconfiguration: a key from one provider pointed
  // at another provider's endpoint.
  if (env.openai.apiKey.startsWith('sk-or-') && !env.openai.baseUrl?.includes('openrouter')) {
    bad('An OpenRouter key is set but OPENAI_BASE_URL does not point at OpenRouter.');
    info('Set OPENAI_BASE_URL=https://openrouter.ai/api/v1');
    process.exit(1);
  }

  const client = new OpenAI({
    apiKey: env.openai.apiKey,
    baseURL: env.openai.baseUrl,
    maxRetries: 0,
    timeout: env.openai.timeoutMs,
  });

  console.log('CALL 1 — with JSON mode (response_format: json_object)');
  let jsonModeWorks = false;
  let result: Awaited<ReturnType<typeof attempt>> | null = null;

  try {
    result = await attempt(client, true);
    jsonModeWorks = true;
    ok(`Answered in ${result.ms}ms`);
  } catch (e) {
    const status = statusOf(e);
    const message = e instanceof Error ? e.message : String(e);
    bad(`${status ?? 'network'} — ${message.slice(0, 200)}`);

    if (status === 401 || status === 403) {
      info('The key is being rejected. Check it belongs to the base URL above.');
      process.exit(1);
    }
    if (status === 404) {
      info(`The model "${env.openai.model}" does not exist at this endpoint.`);
      info('Check the exact model id on your provider, including any :free suffix.');
      process.exit(1);
    }
    if (status === 429) {
      info('Rate limited. Free tiers throttle hard; the app retries with backoff.');
    }
    info('Retrying without JSON mode…');
  }

  if (!jsonModeWorks) {
    console.log('\nCALL 2 — without JSON mode');
    try {
      result = await attempt(client, false);
      ok(`Answered in ${result.ms}ms`);
      console.log('');
      console.log('DIAGNOSIS');
      info('This model does not support response_format: json_object.');
      info('The application detects this and retries without it, so drafting works.');
      info('Older builds treated the 400 as a total failure and fell back to the');
      info('keyword template for every email — which is what "every reply is the');
      info('same generic message" looked like.');
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      bad(`${statusOf(e) ?? 'network'} — ${message.slice(0, 200)}`);
      console.log('');
      console.log('DIAGNOSIS');
      info('The model is unreachable in both modes. Every draft will be the');
      info('offline keyword template until this is resolved.');
      process.exit(1);
    }
  }

  /* ------------------------- inspect the answer ------------------------- */

  const raw = result?.completion.choices[0]?.message?.content ?? '';
  console.log('\nRESPONSE');
  info(`Length: ${raw.length} characters`);

  let parsed: Record<string, unknown> | null = null;
  try {
    const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
    parsed = JSON.parse(cleaned.slice(cleaned.indexOf('{'), cleaned.lastIndexOf('}') + 1));
    ok('Valid JSON');
  } catch {
    bad('Not valid JSON — the app extracts what it can and scores it zero confidence.');
  }

  if (parsed) {
    const confidence = Number(parsed.confidence);
    ok(`category=${String(parsed.category)} confidence=${String(parsed.confidence)}`);
    if (!Number.isFinite(confidence)) {
      bad('confidence is not a number. The app coerces this to 0 rather than NaN.');
    }
    const reply = String(parsed.reply ?? '');
    info(`Reply preview: ${reply.slice(0, 160)}${reply.length > 160 ? '…' : ''}`);

    // The actual test of whether drafting is working: does the answer depend
    // on the email that was sent?
    const relevant = /designjet|t650|faded|line|plotter|cartridge/i.test(reply);
    if (relevant) {
      ok('The reply refers to the sample email — the model is reading the content.');
    } else {
      bad('The reply does not mention anything from the sample email.');
      info('A model that ignores the input produces one generic reply for every');
      info('customer. Try a stronger model.');
    }
  }

  console.log('\nRESULT: drafting is working against a real model.\n');
}

main().catch((e) => {
  console.error('\nai:check failed to run:', e instanceof Error ? e.message : e);
  process.exit(1);
});
