'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { TopNav } from '@/components/layout/top-nav';
import { Rail } from '@/components/layout/rail';
import { useMe } from '@/lib/hooks';
import { SearchContext } from '@/lib/search-context';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { data: me, error, isLoading } = useMe();
  const [query, setQuery] = useState('');

  useEffect(() => {
    // Only a real "not signed in" answer sends the person back to the sign-in
    // page. Any thrown error used to do it, so a momentary network failure
    // logged people out mid-task.
    const status = (error as { status?: number } | undefined)?.status;
    if (status === 401 || status === 403) router.replace('/');
  }, [error, router]);

  if (isLoading) {
    return (
      <div className="grid min-h-screen place-items-center">
        <div className="flex flex-col items-center gap-3">
          <span className="w-8 h-8 rounded-full border-2 border-line border-t-brand animate-spin" />
          <p className="text-[13px] text-ink-3">Opening your mailbox…</p>
        </div>
      </div>
    );
  }

  if (error && !me) {
    return (
      <div className="grid min-h-screen place-items-center p-6">
        <div className="card max-w-[420px] w-full p-6 text-center">
          <h1 className="text-[16px] font-semibold tracking-[-0.02em]">Cannot reach the server</h1>
          <p className="text-[13px] text-ink-2 mt-2 leading-relaxed">
            The API did not respond. Check that the backend is running, then try again.
          </p>
          <button className="btn btn-primary mt-4" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  }

  if (!me) return null;

  return (
    <SearchContext.Provider value={{ query, setQuery }}>
      <div className="flex flex-col min-h-screen">
        <TopNav query={query} onQuery={setQuery} />
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:top-2 focus:left-2
                     focus:px-3 focus:py-2 focus:rounded-md focus:bg-brand focus:text-white"
        >
          Skip to content
        </a>
        <div className="flex flex-1 min-h-0">
          <Suspense fallback={<div className="w-[212px] max-lg:w-16 border-r border-line" />}>
            <Rail />
          </Suspense>
          <main
            id="main-content"
            className="flex-1 min-w-0 flex flex-col gap-6 p-6 max-sm:p-4"
          >
            {children}
          </main>
        </div>
      </div>
    </SearchContext.Provider>
  );
}
