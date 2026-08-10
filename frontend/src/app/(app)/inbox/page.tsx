'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight, Keyboard, ListChecks, Play } from 'lucide-react';
import { KpiCards } from '@/components/kpi-cards';
import { EmailList } from '@/components/inbox/email-list';
import { EmailDetail } from '@/components/inbox/email-detail';
import { AutomationPanel } from '@/components/automation/automation-panel';
import { api } from '@/lib/api';
import { useApp } from '@/components/providers';
import { useCounts, useEmail, useEmails, useLiveUpdates, useRefreshAll } from '@/lib/hooks';
import { useSearch } from '@/lib/search-context';

const VALID_TABS = ['all', 'unread', 'pending', 'replied', 'failed', 'ignored'];
const PAGE_SIZE = 30;

export default function InboxPage() {
  return (
    <Suspense fallback={<div className="skeleton h-40 w-full rounded-2xl" />}>
      <Inbox />
    </Suspense>
  );
}

function Inbox() {
  const router = useRouter();
  const params = useSearchParams();
  const { toast } = useApp();
  const { query } = useSearch();
  const refresh = useRefreshAll();

  const urlTab = params.get('status');
  const [tab, setTab] = useState(urlTab && VALID_TABS.includes(urlTab) ? urlTab : 'all');
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);

  const search = filter || query;
  const { data: pageData, isLoading } = useEmails({ status: tab, q: search, page, limit: PAGE_SIZE });
  const { data: counts } = useCounts();
  const { data: selected, isLoading: detailLoading } = useEmail(selectedId);

  useLiveUpdates((name) => {
    if (name === 'sync:done') {
      toast({ title: 'Inbox updated', detail: 'New mail arrived.', kind: 'info' });
    }
  });

  const emails = useMemo(() => pageData?.items ?? [], [pageData]);
  const totalPages = pageData?.pages ?? 1;

  // Changing the queue or the search resets paging; staying on page 4 of a
  // filter that now has one page showed a permanently empty list.
  useEffect(() => setPage(1), [tab, search]);

  // Keep a sensible selection as the list changes underneath.
  useEffect(() => {
    if (!emails.length) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !emails.some((e) => e._id === selectedId)) setSelectedId(emails[0]._id);
  }, [emails, selectedId]);

  useEffect(() => {
    const s = params.get('status');
    if (s && VALID_TABS.includes(s)) setTab(s);
  }, [params]);

  const select = useCallback(
    async (id: string) => {
      setSelectedId(id);
      try {
        await api.post(`/emails/${id}/open`);
        await refresh();
      } catch {
        /* opening is best-effort */
      }
    },
    [refresh],
  );

  /**
   * j / k move through the list, r regenerates, ? shows the list.
   *
   * There is deliberately no send shortcut. `a` used to approve and send the
   * selected reply on a single keypress, with no confirmation, swallowing any
   * error and showing "Reply sent" regardless — one stray keystroke while
   * scrolling was enough to email a customer.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement;
      if (
        el.tagName === 'INPUT' ||
        el.tagName === 'TEXTAREA' ||
        el.tagName === 'SELECT' ||
        el.isContentEditable
      ) {
        return;
      }

      const i = emails.findIndex((x) => x._id === selectedId);
      const k = e.key.toLowerCase();

      if (k === 'j' && i < emails.length - 1) {
        e.preventDefault();
        void select(emails[i + 1]._id);
      }
      if (k === 'k' && i > 0) {
        e.preventDefault();
        void select(emails[i - 1]._id);
      }
      if (e.key === '?') {
        e.preventDefault();
        setShowShortcuts((v) => !v);
      }
      if (k === 'r' && selectedId) {
        e.preventDefault();
        void api
          .post(`/emails/${selectedId}/regenerate`)
          .then(() => {
            toast({ title: 'Reply regenerated', kind: 'info' });
            return refresh();
          })
          .catch((err: Error) =>
            toast({ title: 'Could not regenerate', detail: err.message, kind: 'error' }),
          );
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [emails, selectedId, select, refresh, toast]);

  async function runAutomation() {
    setRunning(true);
    try {
      const r = await api.post<{
        autoSent: number;
        heldForApproval: number;
        ignored: number;
        skipped?: string;
      }>('/automation/run');
      toast(
        r.skipped
          ? { title: 'Already running', detail: r.skipped, kind: 'info' }
          : {
              title: 'Automation run complete',
              detail: `${r.autoSent} sent · ${r.heldForApproval} held · ${r.ignored} filed`,
            },
      );
      await refresh();
    } catch (e) {
      toast({ title: 'Run failed', detail: (e as Error).message, kind: 'error' });
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold tracking-[-0.025em]">Inbox operations</h1>
          <p className="text-[13px] text-ink-3 mt-0.5" aria-live="polite">
            {counts
              ? `${counts.unread} unread · ${counts.pending} waiting on you · ${counts.failed} failed to send`
              : 'Loading mailbox…'}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            className="btn btn-sm"
            onClick={() => {
              setTab('pending');
              router.push('/inbox?status=pending');
            }}
          >
            <ListChecks size={14} /> Review pending
          </button>
          <button className="btn btn-sm btn-primary" onClick={runAutomation} disabled={running}>
            <Play size={14} /> {running ? 'Running…' : 'Run automation'}
          </button>
        </div>
      </header>

      <KpiCards />

      <div className="grid grid-cols-[minmax(0,7fr)_minmax(320px,3fr)] gap-4 items-start max-xl:grid-cols-1">
        <div className="card grid grid-cols-[minmax(300px,0.85fr)_minmax(0,1.15fr)] max-lg:grid-cols-1 min-h-[640px] overflow-hidden">
          <div className="flex flex-col min-w-0 border-r border-line max-lg:border-r-0 max-lg:border-b">
            <EmailList
              emails={emails}
              counts={counts}
              loading={isLoading}
              selectedId={selectedId}
              tab={tab}
              filter={filter}
              onTab={setTab}
              onFilter={setFilter}
              onSelect={select}
            />
            {totalPages > 1 && (
              <nav
                aria-label="Email pages"
                className="flex items-center justify-between gap-2 px-3.5 py-2.5 border-t border-line"
              >
                <button
                  className="btn btn-sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  aria-label="Previous page"
                >
                  <ChevronLeft size={14} /> Previous
                </button>
                <span className="text-[12px] text-ink-3 tabular-nums" aria-live="polite">
                  Page {page} of {totalPages}
                </span>
                <button
                  className="btn btn-sm"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  aria-label="Next page"
                >
                  Next <ChevronRight size={14} />
                </button>
              </nav>
            )}
          </div>
          <EmailDetail
            email={selected}
            loading={detailLoading && !!selectedId}
            onChanged={refresh}
          />
        </div>

        <AutomationPanel
          onJumpToQueue={(status) => {
            setTab(status);
            router.push(`/inbox?status=${status}`);
          }}
        />
      </div>

      <button
        onClick={() => setShowShortcuts((v) => !v)}
        className="fixed bottom-5 left-5 z-[80] btn btn-sm max-sm:hidden"
        aria-expanded={showShortcuts}
      >
        <Keyboard size={14} /> Shortcuts
      </button>
      {showShortcuts && (
        <div className="fixed bottom-16 left-5 z-[80] card p-4 w-[260px] animate-fade">
          <p className="card-title mb-2">Keyboard</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[12.5px]">
            <dt className="font-mono text-ink-3">j / k</dt>
            <dd>Next / previous email</dd>
            <dt className="font-mono text-ink-3">r</dt>
            <dd>Regenerate the draft</dd>
            <dt className="font-mono text-ink-3">/</dt>
            <dd>Focus search</dd>
            <dt className="font-mono text-ink-3">?</dt>
            <dd>Toggle this panel</dd>
          </dl>
          <p className="text-[11.5px] text-ink-3 mt-3 leading-relaxed">
            Sending has no shortcut on purpose — it always goes through the confirmation dialog.
          </p>
        </div>
      )}
    </>
  );
}
