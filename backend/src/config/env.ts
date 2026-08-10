import dotenv from 'dotenv';
dotenv.config();

const isProd = process.env.NODE_ENV === 'production';

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing required env var: ${name}`);
  return v;
}

/**
 * Values that are fine in development but must never reach production with
 * their fallback still in place. Failing to boot is the correct behaviour:
 * a default JWT secret means anyone can mint a session for any account.
 */
const DEV_ONLY_DEFAULTS = {
  jwtSecret: 'dev_only_secret_change_me_dev_only_change',
  tokenKey: '0'.repeat(64),
};

function secret(name: string, devDefault: string): string {
  const value = process.env[name];
  if (!value || value === devDefault) {
    if (isProd) {
      throw new Error(
        `${name} is missing or still set to the development default. ` +
          `Generate one with: openssl rand -hex 32`,
      );
    }
    return devDefault;
  }
  return value;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function list(name: string, fallback: string[]): string[] {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const webUrl = req('WEB_URL', 'http://localhost:3000');

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProd,
  port: num('PORT', 4000),
  appUrl: req('APP_URL', 'http://localhost:4000'),
  webUrl,
  /** Every origin allowed to call the API with credentials. */
  corsOrigins: list('CORS_ORIGINS', [webUrl]),

  mongoUri: req('MONGODB_URI', 'mongodb://localhost:27017/email_automation'),

  jwtSecret: secret('JWT_SECRET', DEV_ONLY_DEFAULTS.jwtSecret),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  tokenKey: secret('TOKEN_ENCRYPTION_KEY', DEV_ONLY_DEFAULTS.tokenKey),

  google: {
    clientId: process.env.GOOGLE_CLIENT_ID ?? '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    callbackUrl: process.env.GOOGLE_CALLBACK_URL ?? 'http://localhost:4000/api/auth/google/callback',
    scopes: [
      'openid',
      'email',
      'profile',
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.modify',
    ],
  },

  microsoft: {
    clientId: process.env.MICROSOFT_CLIENT_ID ?? '',
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET ?? '',
    tenantId: process.env.MICROSOFT_TENANT_ID ?? 'common',
    callbackUrl:
      process.env.MICROSOFT_CALLBACK_URL ?? 'http://localhost:4000/api/auth/microsoft/callback',
    scopes: [
      'openid',
      'profile',
      'email',
      'offline_access',
      'User.Read',
      'Mail.Read',
      'Mail.Send',
      'Mail.ReadWrite',
    ],
  },

  imap: {
    host: process.env.IMAP_HOST ?? '',
    port: num('IMAP_PORT', 993),
    secure: process.env.IMAP_SECURE !== 'false',
    smtpHost: process.env.SMTP_HOST ?? process.env.IMAP_HOST ?? '',
    smtpPort: num('SMTP_PORT', 465),
    smtpSecure: process.env.SMTP_SECURE !== 'false',
    folder: process.env.IMAP_FOLDER ?? 'INBOX',
    sentFolder: process.env.IMAP_SENT_FOLDER,
    /**
     * Certificate checking. Shared hosts often serve a certificate for the
     * server hostname rather than the mail domain, so this can be turned off —
     * but it defaults ON, because turning it off silently accepts a
     * man-in-the-middle on a connection that carries a mailbox password.
     */
    rejectUnauthorized: process.env.IMAP_TLS_REJECT_UNAUTHORIZED !== 'false',
  },

  openai: {
    apiKey: process.env.OPENAI_API_KEY ?? '',
    /**
     * Any OpenAI-compatible endpoint works here — OpenRouter, NVIDIA NIM, a
     * local server. Leave unset for OpenAI itself. The key and the base URL
     * must belong to the same provider: an OpenRouter key sent to OpenAI's
     * endpoint is rejected, and drafting silently falls back to the stub.
     */
    baseUrl: process.env.OPENAI_BASE_URL || undefined,
    model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
    mock: process.env.AI_MOCK === 'true' || !process.env.OPENAI_API_KEY,
    timeoutMs: num('OPENAI_TIMEOUT_MS', 45_000),
    maxRetries: Math.max(0, num('OPENAI_MAX_RETRIES', 2)),
    maxTokens: num('OPENAI_MAX_TOKENS', 1200),
  },

  attachments: {
    /** Read PDFs and images and feed their text to the model. */
    enabled: process.env.ATTACHMENT_PARSING !== 'false',
    /** OCR for images. Downloads language data on first use. */
    ocr: process.env.ATTACHMENT_OCR !== 'false',
    ocrLang: process.env.ATTACHMENT_OCR_LANG ?? 'eng',
    /** Local folder holding <lang>.traineddata, for hosts with no CDN access. */
    ocrPath: process.env.ATTACHMENT_OCR_PATH || undefined,
    maxBytes: num('ATTACHMENT_MAX_MB', 10) * 1024 * 1024,
    /** Per-attachment cap on extracted text, to keep prompts affordable. */
    maxChars: num('ATTACHMENT_MAX_CHARS', 6000),
    /** Attachments read per message. Stops one mail from stalling a whole sync. */
    maxPerMessage: num('ATTACHMENT_MAX_PER_MESSAGE', 8),
  },

  sync: {
    cron: process.env.SYNC_CRON ?? '*/5 * * * *',
    enabled: process.env.SYNC_ENABLED !== 'false',
    /** Messages pulled per sync per mailbox. */
    batchSize: num('SYNC_BATCH_SIZE', 40),
    /** How far back a first-ever sync reaches, in days. */
    initialLookbackDays: num('SYNC_INITIAL_LOOKBACK_DAYS', 7),
  },

  limits: {
    /** Hard ceiling on automated sends per mailbox per rolling 24 hours. */
    dailySendCap: num('DAILY_SEND_CAP', 200),
    /** Emails drafted in one automation run. */
    automationBatch: num('AUTOMATION_BATCH', 50),
    /** How long a send may hold its lock before another worker may retry it. */
    sendLockMs: num('SEND_LOCK_MS', 120_000),
  },
};

/**
 * A production deploy that still points its OAuth callback at localhost looks
 * healthy — the API boots, /health is green — and then every sign-in bounces
 * the user to a machine that is not there. The provider is the one place this
 * cannot be caught later, because the redirect_uri is registered upstream.
 * Only checked when the provider is actually configured: a deployment using
 * IMAP alone has no callback URL to get wrong.
 */
function assertPublicCallback(provider: string, clientId: string, callbackUrl: string): void {
  if (!isProd || !clientId) return;
  let host: string;
  try {
    host = new URL(callbackUrl).hostname;
  } catch {
    throw new Error(`${provider} callback URL is not a valid URL: ${callbackUrl}`);
  }
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
    throw new Error(
      `${provider.toUpperCase()}_CALLBACK_URL still points at ${host} in production. ` +
        `Set it to https://<your-api-host>/api/auth/${provider}/callback and register that ` +
        `exact URL with the provider.`,
    );
  }
}

assertPublicCallback('google', env.google.clientId, env.google.callbackUrl);
assertPublicCallback('microsoft', env.microsoft.clientId, env.microsoft.callbackUrl);
