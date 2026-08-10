import jwt from 'jsonwebtoken';
import { env } from '../../config/env';
import { decrypt, encrypt } from '../../utils/crypto';
import { User, type Provider, type UserDoc } from '../../models/user.model';
import { googleRefresh, microsoftRefresh, type ProviderProfile, type TokenSet } from './oauth';
import { logger } from '../../utils/logger';

export interface JwtPayload {
  sub: string;
  email: string;
  provider: Provider;
}

export function signJwt(user: UserDoc): string {
  const payload: JwtPayload = {
    sub: user._id.toString(),
    email: user.email,
    provider: user.provider,
  };
  return jwt.sign(payload, env.jwtSecret, { expiresIn: env.jwtExpiresIn } as jwt.SignOptions);
}

export function verifyJwt(token: string): JwtPayload {
  return jwt.verify(token, env.jwtSecret) as JwtPayload;
}

/** Creates the user on first sign-in, refreshes stored tokens on every later one. */
export async function upsertUser(
  provider: Provider,
  profile: ProviderProfile,
  tokens: TokenSet,
): Promise<UserDoc> {
  const update: Record<string, unknown> = {
    name: profile.name,
    email: profile.email,
    avatarUrl: profile.avatarUrl,
    provider,
    providerAccountId: profile.id,
    accessToken: encrypt(tokens.accessToken),
    accessTokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000),
    scopes: tokens.scope?.split(' ') ?? [],
  };

  // Google only returns a refresh token on the first consent, so never blank it.
  if (tokens.refreshToken) update.refreshToken = encrypt(tokens.refreshToken);

  const user = await User.findOneAndUpdate(
    { provider, providerAccountId: profile.id },
    { $set: update, $setOnInsert: { lastSyncAt: null } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );

  return user as UserDoc;
}

/**
 * A refresh in flight, per user.
 *
 * Without this, a sync and a manual action starting at the same moment both
 * refresh, and with Google's rotating refresh tokens the second exchange
 * invalidates the first — the account silently disconnects itself.
 */
const refreshing = new Map<string, Promise<string>>();

/** True when the provider is telling us this refresh token is dead for good. */
function isPermanentAuthFailure(message: string): boolean {
  return /invalid_grant|invalid_client|unauthorized_client|token (has been )?(revoked|expired)|AADSTS(50173|70000|700082|50076)/i.test(
    message,
  );
}

/**
 * Returns a usable access token, refreshing it first when it is within
 * two minutes of expiry.
 */
export async function getAccessToken(userId: string): Promise<string> {
  const user = await User.findById(userId).select('+accessToken +refreshToken');
  if (!user) throw new Error('User not found');

  const expiresSoon =
    !user.accessTokenExpiresAt || user.accessTokenExpiresAt.getTime() - Date.now() < 120_000;

  if (!expiresSoon && user.accessToken) return decrypt(user.accessToken);
  if (!user.refreshToken) throw new Error('No refresh token stored — the account must reconnect');

  const inFlight = refreshing.get(userId);
  if (inFlight) return inFlight;

  const job = (async () => {
    const refreshToken = decrypt(user.refreshToken as string);
    try {
      const tokens =
        user.provider === 'google'
          ? await googleRefresh(refreshToken)
          : await microsoftRefresh(refreshToken);

      user.accessToken = encrypt(tokens.accessToken);
      user.accessTokenExpiresAt = new Date(Date.now() + tokens.expiresIn * 1000);
      // Microsoft rotates the refresh token on every exchange; storing the new
      // one is what keeps the connection alive past the first 90 days.
      if (tokens.refreshToken) user.refreshToken = encrypt(tokens.refreshToken);
      await user.save();

      logger.debug(`Refreshed ${user.provider} access token`);
      return tokens.accessToken;
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Token refresh failed';
      if (isPermanentAuthFailure(message)) {
        // The token will never work again. Clearing it makes the UI say
        // "reconnect" instead of retrying a dead credential every five minutes.
        await User.findByIdAndUpdate(userId, {
          $unset: { refreshToken: 1, accessToken: 1, accessTokenExpiresAt: 1 },
          $set: { 'settings.paused': true },
        });
        logger.warn(`${user.provider} refresh token rejected — account marked disconnected`);
        throw new Error('The mailbox connection has expired. Sign in again to reconnect.');
      }
      throw e;
    } finally {
      refreshing.delete(userId);
    }
  })();

  refreshing.set(userId, job);
  return job;
}

/** Clears stored provider tokens. The account row is kept for history. */
export async function disconnect(userId: string): Promise<void> {
  await User.findByIdAndUpdate(userId, {
    $unset: {
      refreshToken: 1,
      accessToken: 1,
      accessTokenExpiresAt: 1,
      imapPassword: 1,
      automationLockAt: 1,
      syncLockAt: 1,
    },
    $set: { 'settings.paused': true },
  });
  refreshing.delete(userId);
  // Cached attachment bytes belong to a mailbox we can no longer reach, and
  // holding them after a disconnect is exactly the data we were asked to drop.
  const { clearAttachmentCache } = await import('../emails/attachments.service');
  clearAttachmentCache(userId);
  logger.info('Account disconnected — stored credentials and cached files cleared');
}
