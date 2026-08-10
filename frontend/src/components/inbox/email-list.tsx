'use client';

import { Paperclip } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { StatusChip } from '@/components/ui/status-chip';
import { confidenceColour, timeAgo } from '@/lib/format';
import type { Counts, Email, EmailStatus } from '@/lib/types';

const TABS: { key: EmailStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'pending', label: 'Pending' },
  { key: 'replied', label: 'Replied' },
  { key: 'failed', label: 'Failed' },
];

const PRIORITY_STYLE = { high: 'text-danger', medium: 'text-warn', low: 'text-ink-3' } as const;
const PRIORITY_LABEL = { high: 'High', medium: 'Medium', low: 'Low' } as const;

interface Props {
  emails: Email[];
  counts?: Counts;
  loading: boolean;
  selectedId: string | null;
  tab: string;
  filter: string;
  onTab: (t: string) => void;
  onFilter: (v: string) => void;
  onSelect: (id: string) => void;
}

export function EmailList({
  emails,
  counts,
  loading,
  selectedId,
  tab,
  filter,
  onTab,
  onFilter,
  onSelect,
}: Props) {
  return (
    <>
      <div className="flex flex-col gap-3 px-3.5 pt-3.5">
        <input
          value={filter}
          onChange={(e) => onFilter(e.target.value)}
          placeholder="Filter this list…"
          aria-label="Filter emails"
          className="w-full h-[34px] px-3 rounded-sm bg-surface-3 border border-transparent text-[13px]
                     transition focus:bg-surface focus:border-brand-border focus:outline-none"
        />
        <div role="tablist" className="flex gap-0.5 pb-2.5 border-b border-line overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => onTab(t.key)}
              className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-[7px] text-[12.5px] whitespace-nowrap transition
                          ${tab === t.key ? 'bg-ink text-surface font-semibold' : 'text-ink-2 font-medium hover:bg-surface-3 hover:text-ink'}`}
            >
              {t.label}
              <span className="text-[11px] font-semibold opacity-65">{counts?.[t.key] ?? 0}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto max-h-[620px] max-lg:max-h-[340px]">
        {loading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex gap-3 px-3.5 py-3.5 border-b border-line">
              <div className="skeleton w-[34px] h-[34px] rounded-full shrink-0" />
              <div className="flex-1">
                <div className="skeleton h-3 w-2/5" />
                <div className="skeleton h-3 w-3/4 mt-2" />
                <div className="skeleton h-2.5 w-full mt-2" />
              </div>
            </div>
          ))
        ) : emails.length === 0 ? (
          <EmptyList filtered={!!filter} />
        ) : (
          emails.map((e) => {
            const unread = e.status === 'unread';
            const active = selectedId === e._id;
            return (
              <button
                key={e._id}
                onClick={() => onSelect(e._id)}
                aria-current={active ? 'true' : undefined}
                className={`relative flex gap-3 w-full text-left px-3.5 py-3.5 border-b border-line transition
                            ${active ? 'bg-brand-soft' : 'hover:bg-surface-2'}`}
              >
                <span className={`absolute left-0 inset-y-0 w-[2.5px] ${active ? 'bg-brand' : 'bg-transparent'}`} />
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 mt-3.5 ${unread ? 'bg-brand' : 'bg-transparent'}`} />
                <Avatar name={e.fromName || e.fromEmail} size={34} />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-[13px] truncate ${unread ? 'font-semibold text-ink' : 'font-medium'}`}>
                      {e.fromName || e.fromEmail}
                    </span>
                    {e.attachments.length > 0 && <Paperclip size={12} className="text-ink-3 shrink-0" />}
                    <time
                      dateTime={e.receivedAt}
                      className="ml-auto text-[11.5px] text-ink-3 shrink-0"
                    >
                      {timeAgo(e.receivedAt)}
                    </time>
                  </div>
                  <p className={`text-[13px] mt-0.5 truncate ${unread ? 'font-semibold' : 'font-medium'}`}>{e.subject}</p>
                  <p className="text-[12.5px] text-ink-3 mt-0.5 truncate">{e.snippet}</p>

                  <div className="flex items-center gap-1.5 mt-2.5 flex-wrap">
                    <StatusChip status={e.status} sentBy={e.sentBy} />
                    <span className={`text-[11px] font-semibold ${PRIORITY_STYLE[e.priority]}`}>
                      {PRIORITY_LABEL[e.priority]}
                    </span>
                    {typeof e.aiConfidence === 'number' && Number.isFinite(e.aiConfidence) && (
                      <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] font-semibold text-ink-2">
                        <span className="w-[26px] h-[3px] rounded-full bg-line-strong overflow-hidden">
                          <span
                            className="block h-full rounded-full"
                            style={{ width: `${e.aiConfidence}%`, background: confidenceColour(e.aiConfidence) }}
                          />
                        </span>
                        {e.aiConfidence}%
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </>
  );
}

function EmptyList({ filtered }: { filtered: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3.5 min-h-[400px] px-6 py-12 text-center">
      <svg viewBox="0 0 120 120" className="w-[104px] h-[104px]" fill="none" aria-hidden>
        <rect x="18" y="34" width="84" height="58" rx="10" fill="var(--surface-3)" />
        <path d="M18 44l38 26a8 8 0 0 0 8 0l38-26" stroke="var(--line-strong)" strokeWidth="2.5" />
        <circle cx="88" cy="36" r="15" fill="var(--green-soft)" />
        <path d="M82 36l4.5 4.5L95 32" stroke="var(--ok)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <p className="text-[15px] font-semibold tracking-[-0.015em]">Nothing in this queue</p>
      <p className="text-[13px] text-ink-3 max-w-[300px] leading-relaxed">
        {filtered
          ? 'No email matches that search. Try a sender name or part of the subject.'
          : 'Every email in this filter has been handled. New mail lands here automatically.'}
      </p>
    </div>
  );
}
