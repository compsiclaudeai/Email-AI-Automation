'use client';

import useSWR, { useSWRConfig } from 'swr';
import { useEffect, useRef } from 'react';
import { fetcher } from './api';
import type {
  ActivityItem,
  Analytics,
  AutomationStatus,
  Counts,
  Email,
  EmailPage,
  Kpi,
  Me,
  Settings,
  Suggestion,
  Template,
} from './types';

export const useMe = () => useSWR<Me>('/auth/me', fetcher, { shouldRetryOnError: false });

export const useEmails = (params: {
  status: string;
  q: string;
  page?: number;
  limit?: number;
}) => {
  const qs = new URLSearchParams({
    status: params.status,
    limit: String(params.limit ?? 30),
    page: String(params.page ?? 1),
  });
  if (params.q) qs.set('q', params.q);
  return useSWR<EmailPage>(`/emails?${qs.toString()}`, fetcher, { keepPreviousData: true });
};

export const useEmail = (id: string | null) => useSWR<Email>(id ? `/emails/${id}` : null, fetcher);

export const useCounts = () => useSWR<Counts>('/emails/counts', fetcher);
export const useKpis = () => useSWR<Kpi[]>('/analytics/kpis', fetcher);
export const useAnalytics = (days: number) =>
  useSWR<Analytics>(`/analytics/overview?days=${days}`, fetcher);
export const useAutomation = () =>
  useSWR<AutomationStatus>('/automation/status', fetcher, { refreshInterval: 30_000 });
export const useSuggestions = () => useSWR<Suggestion[]>('/automation/suggestions', fetcher);
export const useActivity = () => useSWR<ActivityItem[]>('/activity?limit=8', fetcher);
export const useSettings = () => useSWR<Settings>('/settings', fetcher);
export const useTemplates = () => useSWR<Template[]>('/settings/templates', fetcher);

/** Revalidates every inbox-facing key after an action changes server state. */
export function useRefreshAll() {
  const { mutate } = useSWRConfig();
  return () =>
    mutate(
      (key) =>
        typeof key === 'string' &&
        (key.startsWith('/emails') ||
          key.startsWith('/analytics') ||
          key.startsWith('/automation') ||
          key.startsWith('/activity')),
      undefined,
      { revalidate: true },
    );
}

/**
 * Subscribes to the server-sent event stream so the inbox updates when mail
 * arrives or the background job sends a reply.
 *
 * Two things were broken here:
 *
 *  - the stream was opened against NEXT_PUBLIC_API_URL directly, which is a
 *    cross-site request in development. A SameSite=Lax session cookie is not
 *    sent on one of those, so the stream authenticated as nobody and every
 *    live update silently never arrived. It now goes through the same
 *    same-origin /api rewrite as every other call.
 *
 *  - `onerror` closed the stream permanently, so one dropped connection (a
 *    laptop lid, a proxy timeout) killed live updates for the rest of the
 *    session. It now reconnects with capped exponential backoff.
 */
export function useLiveUpdates(onEvent?: (name: string) => void) {
  const refresh = useRefreshAll();
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let closed = false;

    const connect = () => {
      if (closed) return;
      source = new EventSource('/api/events/stream');

      const handle = (name: string) => () => {
        handler.current?.(name);
        void refresh();
      };

      source.addEventListener('ready', () => {
        attempt = 0; // a successful open resets the backoff
      });
      source.addEventListener('email:updated', handle('email:updated'));
      source.addEventListener('sync:done', handle('sync:done'));
      source.addEventListener('automation:run', handle('automation:run'));
      source.addEventListener('activity', handle('activity'));

      source.onerror = () => {
        source?.close();
        source = null;
        if (closed) return;
        attempt += 1;
        // 1s, 2s, 4s… capped at 30s, so a backend restart is picked up quickly
        // but a backend that is down is not hammered.
        const wait = Math.min(30_000, 1000 * 2 ** (attempt - 1));
        retry = setTimeout(connect, wait);
      };
    };

    connect();

    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      source?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
