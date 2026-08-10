import { env } from '../../config/env';

/**
 * Minimal OAuth 2.0 authorization-code helpers.
 *
 * Passport is deliberately avoided here: both providers use the same standard
 * flow, and doing it directly keeps the token payload (including the refresh
 * token and granted scopes) visible instead of hidden behind a strategy.
 */

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  scope?: string;
}

export interface ProviderProfile {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
}

/* ------------------------------- Google -------------------------------- */

export function googleAuthUrl(state: string): string {
  const p = new URLSearchParams({
    client_id: env.google.clientId,
    redirect_uri: env.google.callbackUrl,
    response_type: 'code',
    scope: env.google.scopes.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`;
}

export async function googleExchangeCode(code: string): Promise<TokenSet> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.google.clientId,
      client_secret: env.google.clientSecret,
      redirect_uri: env.google.callbackUrl,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${await res.text()}`);
  const j = (await res.json()) as Record<string, string | number>;
  return {
    accessToken: String(j.access_token),
    refreshToken: j.refresh_token ? String(j.refresh_token) : undefined,
    expiresIn: Number(j.expires_in ?? 3600),
    scope: j.scope ? String(j.scope) : undefined,
  };
}

export async function googleRefresh(refreshToken: string): Promise<TokenSet> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: env.google.clientId,
      client_secret: env.google.clientSecret,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`Google token refresh failed: ${await res.text()}`);
  const j = (await res.json()) as Record<string, string | number>;
  return { accessToken: String(j.access_token), expiresIn: Number(j.expires_in ?? 3600) };
}

export async function googleProfile(accessToken: string): Promise<ProviderProfile> {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Google profile lookup failed: ${await res.text()}`);
  const j = (await res.json()) as Record<string, string>;
  return { id: j.sub, name: j.name ?? j.email, email: j.email, avatarUrl: j.picture };
}

/* ------------------------------ Microsoft ------------------------------ */

const msBase = () => `https://login.microsoftonline.com/${env.microsoft.tenantId}/oauth2/v2.0`;

export function microsoftAuthUrl(state: string): string {
  const p = new URLSearchParams({
    client_id: env.microsoft.clientId,
    redirect_uri: env.microsoft.callbackUrl,
    response_type: 'code',
    response_mode: 'query',
    scope: env.microsoft.scopes.join(' '),
    state,
  });
  return `${msBase()}/authorize?${p.toString()}`;
}

export async function microsoftExchangeCode(code: string): Promise<TokenSet> {
  const res = await fetch(`${msBase()}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.microsoft.clientId,
      client_secret: env.microsoft.clientSecret,
      redirect_uri: env.microsoft.callbackUrl,
      grant_type: 'authorization_code',
      scope: env.microsoft.scopes.join(' '),
    }),
  });
  if (!res.ok) throw new Error(`Microsoft token exchange failed: ${await res.text()}`);
  const j = (await res.json()) as Record<string, string | number>;
  return {
    accessToken: String(j.access_token),
    refreshToken: j.refresh_token ? String(j.refresh_token) : undefined,
    expiresIn: Number(j.expires_in ?? 3600),
    scope: j.scope ? String(j.scope) : undefined,
  };
}

export async function microsoftRefresh(refreshToken: string): Promise<TokenSet> {
  const res = await fetch(`${msBase()}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: env.microsoft.clientId,
      client_secret: env.microsoft.clientSecret,
      grant_type: 'refresh_token',
      scope: env.microsoft.scopes.join(' '),
    }),
  });
  if (!res.ok) throw new Error(`Microsoft token refresh failed: ${await res.text()}`);
  const j = (await res.json()) as Record<string, string | number>;
  return {
    accessToken: String(j.access_token),
    refreshToken: j.refresh_token ? String(j.refresh_token) : undefined,
    expiresIn: Number(j.expires_in ?? 3600),
  };
}

export async function microsoftProfile(accessToken: string): Promise<ProviderProfile> {
  const res = await fetch('https://graph.microsoft.com/v1.0/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Graph profile lookup failed: ${await res.text()}`);
  const j = (await res.json()) as Record<string, string>;
  return {
    id: j.id,
    name: j.displayName ?? j.userPrincipalName,
    email: (j.mail ?? j.userPrincipalName ?? '').toLowerCase(),
  };
}
