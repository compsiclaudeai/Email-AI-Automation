'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { SWRConfig } from 'swr';
import { fetcher } from '@/lib/api';
import { ToastViewport, type Toast } from './ui/toast';

type Theme = 'light' | 'dark';

interface AppContext {
  theme: Theme;
  toggleTheme: () => void;
  toast: (t: Omit<Toast, 'id'>) => void;
}

const Ctx = createContext<AppContext | null>(null);
const THEME_KEY = 'ea-theme';

export function useApp(): AppContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp must be used inside <Providers>');
  return ctx;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>('light');
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Read the stored choice, or the OS preference, once on mount. Reading it
  // during render would not match the server-rendered HTML.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(THEME_KEY);
      if (stored === 'light' || stored === 'dark') {
        setTheme(stored);
        return;
      }
    } catch {
      /* storage can be blocked; the default is fine */
    }
    if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) setTheme('dark');
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    try {
      window.localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* not fatal */
    }
  }, [theme]);

  const toggleTheme = useCallback(() => setTheme((t) => (t === 'light' ? 'dark' : 'light')), []);

  const toast = useCallback((t: Omit<Toast, 'id'>) => {
    // crypto.randomUUID avoids the (small but real) chance of two toasts
    // colliding on the same Math.random key and React reusing a node.
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`;
    setToasts((list) => [...list.slice(-4), { ...t, id }]);
    setTimeout(() => setToasts((list) => list.filter((x) => x.id !== id)), 5000);
  }, []);

  const dismiss = useCallback(
    (id: string) => setToasts((list) => list.filter((t) => t.id !== id)),
    [],
  );

  const value = useMemo(() => ({ theme, toggleTheme, toast }), [theme, toggleTheme, toast]);

  return (
    <Ctx.Provider value={value}>
      <SWRConfig
        value={{
          fetcher,
          revalidateOnFocus: false,
          dedupingInterval: 4000,
          // A 401 means the session is gone; retrying it forever just burns
          // requests and keeps the loading spinner up.
          shouldRetryOnError: (err: { status?: number }) => err?.status !== 401,
          errorRetryCount: 3,
        }}
      >
        {children}
        <ToastViewport toasts={toasts} onDismiss={dismiss} />
      </SWRConfig>
    </Ctx.Provider>
  );
}
