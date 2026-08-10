import crypto from 'crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../../config/env';
import { decrypt, encrypt } from '../../utils/crypto';
import { ImapProvider } from '../../providers/imap.provider';
import { GraphProvider } from '../../providers/graph.provider';
import { asyncHandler, badRequest } from '../../utils/http';
import { requireAuth } from '../../middleware/auth.middleware';
import { User } from '../../models/user.model';
import { logger } from '../../utils/logger';
import {
  googleAuthUrl,
  googleExchangeCode,
  googleProfile,
  microsoftAuthUrl,
  microsoftExchangeCode,
  microsoftProfile,
} from './oauth';
import { disconnect, getAccessToken, signJwt, upsertUser } from './auth.service';

export const authRouter = Router();

const COOKIE = 'ea_session';
const STATE_COOKIE = 'ea_oauth_state';
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Tight budget for anything that can be used to guess a password. Successful
 * requests are not counted, so a person who signs in correctly is never locked
 * out by their own earlier typos.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many sign-in attempts. Wait a few minutes and try again.' },
});

/**
 * One place that decides the cookie attributes, used for both setting and
 * clearing. They have to match exactly or the browser keeps the old cookie and
 * sign-out silently does nothing.
 */
function cookieOpts(maxAgeMs?: number) {
  return {
    httpOnly: true,
    secure: env.isProd,
    sameSite: env.isProd ? ('none' as const) : ('lax' as const),
    ...(maxAgeMs === undefined ? {} : { maxAge: maxAgeMs }),
    path: '/',
  };
}

function clearSession(res: import('express').Response) {
  res.clearCookie(COOKIE, cookieOpts());
}

/** Starts the consent flow. State is a random nonce echoed back by the provider. */
function startFlow(kind: 'google' | 'microsoft') {
  return asyncHandler(async (_req, res) => {
    const configured =
      kind === 'google' ? env.google.clientId : env.microsoft.clientId;
    if (!configured) {
      return res.redirect(
        `${env.webUrl}/?error=${encodeURIComponent(
          `${kind === 'google' ? 'Google' : 'Microsoft'} sign-in is not configured on this server`,
        )}`,
      );
    }

    const state = crypto.randomBytes(16).toString('hex');
    // SameSite must be lax at minimum here: the callback is a top-level
    // navigation back from the provider, and a strict cookie would not be sent.
    res.cookie(STATE_COOKIE, state, cookieOpts(10 * 60 * 1000));
    res.redirect(kind === 'google' ? googleAuthUrl(state) : microsoftAuthUrl(state));
  });
}

function handleCallback(kind: 'google' | 'microsoft') {
  return asyncHandler(async (req, res) => {
    const { code, state, error } = req.query as Record<string, string | undefined>;
    if (error) return res.redirect(`${env.webUrl}/?error=${encodeURIComponent(error)}`);
    if (!code) throw badRequest('Authorization code missing');

    const expected = req.cookies?.[STATE_COOKIE];
    // Constant-time compare, and both sides must actually exist. A plain !==
    // against an undefined cookie would pass whenever the attacker also sends
    // no state.
    if (
      !state ||
      !expected ||
      state.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(state), Buffer.from(expected))
    ) {
      throw badRequest('OAuth state mismatch — start the sign-in again');
    }
    res.clearCookie(STATE_COOKIE, cookieOpts());

    const tokens =
      kind === 'google' ? await googleExchangeCode(code) : await microsoftExchangeCode(code);
    const profile =
      kind === 'google'
        ? await googleProfile(tokens.accessToken)
        : await microsoftProfile(tokens.accessToken);

    if (!profile.email) throw badRequest('That account has no email address attached');

    const user = await upsertUser(kind, profile, tokens);
    logger.info(`${kind} sign-in succeeded`);

    res.cookie(COOKIE, signJwt(user), cookieOpts(SESSION_MS));
    res.redirect(`${env.webUrl}/inbox`);
  });
}

/* ------------------------------- IMAP --------------------------------- */

const imapSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(1024),
  imapHost: z.string().min(3).max(253),
  imapPort: z.coerce.number().int().min(1).max(65535).default(993),
  imapSecure: z.boolean().default(true),
  smtpHost: z.string().min(3).max(253).optional(),
  smtpPort: z.coerce.number().int().min(1).max(65535).default(465),
  smtpSecure: z.boolean().default(true),
  folder: z.string().max(255).default('INBOX'),
  sentFolder: z.string().max(255).optional(),
  displayName: z.string().max(120).optional(),
});

/** Suggested defaults for the connect form, so the UI is not blank. */
authRouter.get('/imap/defaults', (_req, res) => {
  res.json({
    imapHost: env.imap.host,
    imapPort: env.imap.port,
    imapSecure: env.imap.secure,
    smtpHost: env.imap.smtpHost,
    smtpPort: env.imap.smtpPort,
    smtpSecure: env.imap.smtpSecure,
    folder: env.imap.folder,
  });
});

/**
 * Password sign-in for mailboxes with no OAuth (cPanel, SiteGround, Zoho...).
 * The credentials are proved against the server before anything is stored.
 */
authRouter.post(
  '/imap',
  asyncHandler(async (req, res) => {
    const parsed = imapSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Invalid mailbox details', parsed.error.flatten());
    const d = parsed.data;

    const creds = {
      host: d.imapHost.trim(),
      port: d.imapPort,
      secure: d.imapSecure,
      smtpHost: (d.smtpHost || d.imapHost).trim(),
      smtpPort: d.smtpPort,
      smtpSecure: d.smtpSecure,
      user: d.email.trim(),
      password: d.password,
      folder: d.folder || 'INBOX',
      sentFolder: d.sentFolder,
    };

    let folders: string[] = [];
    try {
      ({ folders } = await new ImapProvider(creds).verify());
    } catch (e) {
      const detail = e instanceof Error ? e.message : 'Connection failed';
      // The address is not logged: a failed login attempt is exactly the log
      // line an attacker would like to seed with someone else's mailbox name.
      logger.warn(`IMAP connect failed: ${detail}`);
      throw badRequest(`Could not sign in to the mailbox: ${detail}`);
    }

    const user = await User.findOneAndUpdate(
      { provider: 'imap', providerAccountId: creds.user.toLowerCase() },
      {
        $set: {
          name: d.displayName || creds.user.split('@')[0],
          email: creds.user.toLowerCase(),
          provider: 'imap',
          providerAccountId: creds.user.toLowerCase(),
          imapPassword: encrypt(creds.password),
          imap: {
            host: creds.host,
            port: creds.port,
            secure: creds.secure,
            smtpHost: creds.smtpHost,
            smtpPort: creds.smtpPort,
            smtpSecure: creds.smtpSecure,
            folder: creds.folder,
            sentFolder: creds.sentFolder,
          },
          scopes: ['imap.read', 'smtp.send'],
          'settings.paused': false,
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );

    logger.info(`IMAP sign-in succeeded (${folders.length} folders)`);
    res.cookie(COOKIE, signJwt(user), cookieOpts(SESSION_MS));
    // The password is never echoed back, and neither is the stored config.
    res.json({ ok: true, email: user.email, folders });
  }),
);

/** Folder list for the settings picker, for whichever provider is connected. */
const foldersHandler = asyncHandler(async (req, res) => {
    const user = await User.findById(req.userId).select('+imapPassword');
    if (!user) throw badRequest('Not signed in');

    if (user.provider === 'imap') {
      if (!user.imap || !user.imapPassword) {
        throw badRequest('This mailbox is not connected — sign in again');
      }
      const { folders } = await new ImapProvider({
        host: user.imap.host,
        port: user.imap.port,
        secure: user.imap.secure,
        smtpHost: user.imap.smtpHost,
        smtpPort: user.imap.smtpPort,
        smtpSecure: user.imap.smtpSecure,
        user: user.email,
        password: decrypt(user.imapPassword),
      }).verify();
      return res.json({ folders, current: user.imap.folder });
    }

    if (user.provider === 'microsoft') {
      const token = await getAccessToken(req.userId!);
      const folders = await new GraphProvider(token).listFolders();
      return res.json({ folders, current: user.mailFolder ?? 'Inbox' });
    }

  // Gmail organises by label; the sync query already scopes to the inbox.
  return res.json({ folders: [], current: user.mailFolder ?? 'INBOX' });
});

authRouter.get('/folders', requireAuth, foldersHandler);
// Kept as an alias so an older frontend build keeps working.
authRouter.get('/imap/folders', requireAuth, foldersHandler);

authRouter.get('/google', startFlow('google'));
authRouter.get('/google/callback', handleCallback('google'));
authRouter.get('/microsoft', startFlow('microsoft'));
authRouter.get('/microsoft/callback', handleCallback('microsoft'));

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.userId);
    if (!user) {
      clearSession(res);
      return res.status(401).json({ error: 'Session no longer valid' });
    }

    // Whether the mailbox is still actually connected, rather than a hardcoded
    // true — a disconnected account used to keep reporting itself as connected.
    const credentials = await User.findById(req.userId)
      .select('+refreshToken +imapPassword')
      .lean();
    const connected = Boolean(credentials?.refreshToken || credentials?.imapPassword);

    res.json({
      id: user._id,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatarUrl,
      provider: user.provider,
      providerLabel:
        user.provider === 'google'
          ? 'Google'
          : user.provider === 'microsoft'
            ? 'Microsoft Outlook'
            : `IMAP · ${user.imap?.host ?? 'mail server'}`,
      mailFolder: user.mailFolder ?? user.imap?.folder,
      connected,
      lastSyncAt: user.lastSyncAt,
      settings: user.settings,
    });
  }),
);

authRouter.post(
  '/disconnect',
  requireAuth,
  asyncHandler(async (req, res) => {
    await disconnect(req.userId!);
    clearSession(res);
    res.json({ ok: true });
  }),
);

authRouter.post('/logout', (_req, res) => {
  clearSession(res);
  res.json({ ok: true });
});
