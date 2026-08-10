'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, LogOut, Moon, RotateCw, Search, Settings as Cog, Sun, Zap } from 'lucide-react';
import { api } from '@/lib/api';
import { useApp } from '@/components/providers';
import { Avatar } from '@/components/ui/avatar';
import { useAutomation, useMe, useRefreshAll } from '@/lib/hooks';

export function TopNav({ query, onQuery }: { query: string; onQuery: (v: string) => void }) {
  const router = useRouter();
  const { theme, toggleTheme, toast } = useApp();
  const { data: me } = useMe();
  const { data: status } = useAutomation();
  const refresh = useRefreshAll();

  const [syncing, setSyncing] = useState(false);
  const [open, setOpen] = useState<'bell' | 'account' | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(null);
        return;
      }
      const el = e.target as HTMLElement;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '/') {
        e.preventDefault();
        searchRef.current?.focus();
      }
      // The old build also flipped the theme on a bare `d`, which fired while
      // someone was reading and made the whole app strobe. Theme is a button.
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  async function sync() {
    if (syncing) return;
    setSyncing(true);
    try {
      const res = await api.post<{ fetched: number; created: number; skipped?: string }>(
        '/automation/sync',
      );
      toast(
        res.skipped
          ? { title: 'Sync already running', detail: res.skipped, kind: 'info' }
          : {
              title: res.created
                ? `${res.created} new email${res.created > 1 ? 's' : ''}`
                : 'Mailbox up to date',
              detail: `Checked ${res.fetched} message${res.fetched === 1 ? '' : 's'}.`,
            },
      );
      await refresh();
    } catch (e) {
      toast({ title: 'Sync failed', detail: (e as Error).message, kind: 'error' });
    } finally {
      setSyncing(false);
    }
  }

  async function signOut() {
    // A client-side push would keep SWR's cached /auth/me, and the sign-in page
    // would bounce straight back to /inbox while the layout bounced back here —
    // a redirect loop. A full load drops every cache and closes the SSE stream.
    try {
      await api.post('/auth/logout');
    } finally {
      window.location.href = '/';
    }
  }

  return (
    <header
      className="sticky top-0 z-[60] flex items-center gap-4 h-[60px] px-6 max-sm:px-3
                 border-b border-line bg-surface/80 backdrop-blur-md backdrop-saturate-150"
    >
      <div className="flex items-center gap-2.5 shrink-0 min-w-[196px] max-lg:min-w-0">
        <span className="grid place-items-center w-7 h-7 rounded-lg bg-brand shadow-[0_2px_6px_rgba(37,99,235,.32)]">
          <Zap size={15} className="text-white" strokeWidth={2.2} />
        </span>
        <span className="text-sm font-semibold tracking-[-0.02em] max-sm:hidden">Email Automation</span>
      </div>

      <div className="relative flex-1 max-w-[520px] mx-auto">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none" />
        <input
          ref={searchRef}
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search email, sender or subject…"
          aria-label="Search emails"
          className="w-full h-9 pl-9 pr-16 rounded-md bg-surface-3 border border-transparent text-[13.5px]
                     transition focus:bg-surface focus:border-brand-border focus:outline-none"
        />
        <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 px-1.5 text-[10.5px] font-semibold
                        text-ink-3 bg-surface border border-line border-b-2 rounded pointer-events-none">
          /
        </kbd>
      </div>

      <div className="flex items-center gap-1.5 ml-auto shrink-0">
        <IconButton label="Sync inbox" onClick={sync} disabled={syncing}>
          <RotateCw size={17} className={syncing ? 'animate-spin' : ''} />
        </IconButton>

        <div className="relative">
          <IconButton
            label="Notifications"
            expanded={open === 'bell'}
            onClick={() => setOpen(open === 'bell' ? null : 'bell')}
          >
            <Bell size={17} />
            {!!status?.queued && (
              <span className="absolute top-1 right-1 grid place-items-center min-w-[15px] h-[15px] px-1
                               rounded-full bg-danger text-white text-[9.5px] font-bold border-2 border-surface">
                {status.queued > 9 ? '9+' : status.queued}
              </span>
            )}
          </IconButton>
          {open === 'bell' && (
            <Popover onClose={() => setOpen(null)}>
              <div className="px-4 py-3 border-b border-line card-title">Notifications</div>
              <PopRow
                title={`${status?.queued ?? 0} drafts waiting for approval`}
                detail="Open the pending queue to review them."
                tone="warn"
              />
              <PopRow
                title={`Success rate ${status?.successRate ?? 100}%`}
                detail="Delivery health across every reply sent."
                tone="ok"
              />
              <PopRow
                title={`Average reply time ${status?.averageReplySeconds ?? 0}s`}
                detail="Measured from arrival to send."
                tone="brand"
              />
            </Popover>
          )}
        </div>

        <IconButton label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} onClick={toggleTheme}>
          {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
        </IconButton>

        <div className="relative">
          <button
            onClick={() => setOpen(open === 'account' ? null : 'account')}
            aria-expanded={open === 'account'}
            aria-label="Account menu"
            className="flex items-center gap-2.5 py-0.5 pl-2.5 pr-0.5 rounded-full transition hover:bg-surface-3"
          >
            <span className="text-right max-sm:hidden">
              <span className="block text-[12.5px] font-semibold tracking-[-0.01em]">
                {me?.name ?? '—'}
              </span>
              <span className="block text-[11px] text-ink-3">{me?.email ?? ''}</span>
            </span>
            <Avatar name={me?.name ?? '?'} size={30} />
          </button>
          {open === 'account' && (
            <Popover onClose={() => setOpen(null)}>
              <div className="flex items-center gap-3 p-4 border-b border-line">
                <Avatar name={me?.name ?? '?'} size={40} />
                <div className="min-w-0">
                  <div className="text-[13.5px] font-semibold">{me?.name}</div>
                  <div className="text-[11.5px] text-ink-3 truncate">{me?.email}</div>
                  <div className="flex gap-1.5 mt-2">
                    <span className="chip bg-ok-soft text-ok">
                      <span className="w-1.5 h-1.5 rounded-full bg-current" />
                      Online
                    </span>
                    <span className="chip">{me?.providerLabel}</span>
                  </div>
                </div>
              </div>
              <button
                onClick={() => {
                  setOpen(null);
                  router.push('/settings');
                }}
                className="w-full text-left"
              >
                <PopRow title="Settings" detail="Tone, business hours, templates" tone="brand" icon={<Cog size={14} />} />
              </button>
              <button onClick={signOut} className="w-full text-left">
                <PopRow title="Sign out" detail="Ends this session on this device" tone="danger" icon={<LogOut size={14} />} />
              </button>
            </Popover>
          )}
        </div>
      </div>
    </header>
  );
}

function IconButton({
  label,
  onClick,
  children,
  disabled,
  expanded,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  expanded?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-expanded={expanded}
      className="relative grid place-items-center w-[34px] h-[34px] rounded-[9px] text-ink-2
                 transition hover:bg-surface-3 hover:text-ink disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function Popover({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <>
      <div className="fixed inset-0 z-[65]" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-label="Menu"
        className="absolute right-0 top-[calc(100%+8px)] z-[70] w-[340px] max-sm:w-[calc(100vw-24px)]
                      bg-surface border border-line rounded-2xl shadow-e3 overflow-hidden animate-fade"
      >
        {children}
      </div>
    </>
  );
}

const TONE_BG: Record<string, string> = {
  brand: 'bg-brand-soft text-brand',
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
};

function PopRow({
  title,
  detail,
  tone,
  icon,
}: {
  title: string;
  detail: string;
  tone: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex gap-3 px-4 py-3 border-b border-line last:border-b-0 transition hover:bg-surface-2">
      <span className={`grid place-items-center w-7 h-7 rounded-lg shrink-0 ${TONE_BG[tone]}`}>
        {icon ?? <Bell size={14} />}
      </span>
      <div className="min-w-0">
        <div className="text-[12.5px] font-medium">{title}</div>
        <div className="text-[11.5px] text-ink-3 mt-0.5 leading-relaxed">{detail}</div>
      </div>
    </div>
  );
}
