/**
 * All requests go through the Next rewrite at /api/*, so the session cookie
 * set by the Express API stays first-party.
 */
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Requests that hang forever leave the UI stuck on a spinner with no way out. */
const TIMEOUT_MS = 30_000;

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      credentials: 'include',
      headers: init.body ? { 'Content-Type': 'application/json' } : undefined,
      signal: controller.signal,
      ...init,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      throw new ApiError(0, 'The server took too long to respond. Try again.');
    }
    throw new ApiError(0, 'Could not reach the server. Check your connection.');
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    let message = res.statusText || `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* response had no JSON body */
    }
    throw new ApiError(res.status, message);
  }

  if (res.status === 204) return undefined as T;

  // A 200 with an empty or non-JSON body used to throw a raw SyntaxError that
  // surfaced to the user as "Unexpected end of JSON input".
  const text = await res.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError(res.status, 'The server returned a response we could not read.');
  }
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

/** SWR fetcher. */
export const fetcher = <T>(path: string) => api.get<T>(path);

export interface ImapConnectInput {
  email: string;
  password: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  folder: string;
  displayName?: string;
}

export interface ImapDefaults {
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  folder: string;
}

export const connectImap = (input: ImapConnectInput) =>
  api.post<{ ok: true; email: string; folders: string[] }>('/auth/imap', input);

/**
 * OAuth is a top-level navigation, so it goes through the same-origin rewrite
 * as everything else. Pointing straight at the API origin meant the state
 * cookie was set on one origin and read on another.
 */
export const oauthUrl = (provider: 'google' | 'microsoft') => `/api/auth/${provider}`;
