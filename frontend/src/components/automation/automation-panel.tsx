'use client';

import { useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Check,
  Clock,
  FileText,
  ListChecks,
  Mail,
  Pause,
  Play,
  RefreshCw,
  RotateCw,
  Send,
  Sparkles,
  User,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useApp } from '@/components/providers';
import { useActivity, useAutomation, useRefreshAll, useSuggestions } from '@/lib/hooks';
import { clock } from '@/lib/format';

export function AutomationPanel({ onJumpToQueue }: { onJumpToQueue: (status: string) => void }) {
  const { toast } = useApp();
  const refresh = useRefreshAll();
  const { data: status } = useAutomation();
  const { data: suggestions } = useSuggestions();
  const { data: activity } = useActivity();
  const [busy, setBusy] = useState<string | null>(null);

  async function action(key: string, fn: () => Promise<unknown>, done: (r: never) => { title: string; detail?: string }) {
    setBusy(key);
    try {
      const res = (await fn()) as never;
      toast(done(res));
      await refresh();
    } catch (e) {
      toast({ title: 'Action failed', detail: (e as Error).message, kind: 'error' });
    } finally {
      setBusy(null);
    }
  }

  const stats = [
    { label: 'AI confidence', value: status?.aiConfidence ?? 0, unit: '%' },
    { label: 'Emails in queue', value: status?.queued ?? 0, unit: '' },
    { label: 'Auto replies today', value: status?.autoRepliedToday ?? 0, unit: '' },
    { label: 'Average reply time', value: status?.averageReplySeconds ?? 0, unit: 's' },
    { label: 'Success rate', value: status?.successRate ?? 100, unit: '%' },
    // Was hardcoded to 0, so a mailbox with failed sends still reported none.
    { label: 'Failed, awaiting retry', value: status?.failed ?? 0, unit: '' },
  ];

  const running = status?.running ?? false;

  return (
    <aside className="flex flex-col gap-4 sticky top-[84px] max-xl:static">
      {status && !status.aiConfigured && (
        <div role="status" className="card border-warn/40 bg-warn-soft p-4 flex gap-3">
          <AlertTriangle size={17} className="text-warn mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="text-[13px] font-semibold">No AI model is configured</p>
            <p className="text-[11.5px] text-ink-2 mt-1 leading-relaxed">
              Drafts are coming from the offline keyword template, not a language model. They are
              never sent automatically. Set OPENAI_API_KEY on the backend to switch it on.
            </p>
          </div>
        </div>
      )}

      {/* A model IS configured but calls are failing. The reason used to exist
          only in the server log, so the product looked like it was working
          while every draft was a template. */}
      {status?.aiConfigured && status.ai?.lastFailure && (
        <div role="alert" className="card border-danger/40 bg-danger-soft p-4 flex gap-3">
          <AlertTriangle size={17} className="text-danger mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-danger">
              The AI model is not answering — drafts are falling back to a template
            </p>
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-2">
              <span className="font-mono">{status.ai.lastFailure.status}</span> from{' '}
              <span className="font-mono break-all">{status.ai.endpoint}</span> using{' '}
              <span className="font-mono break-all">{status.ai.model}</span>
            </p>
            <p className="mt-1 break-words text-[11.5px] leading-relaxed text-ink-3">
              {status.ai.lastFailure.message}
            </p>
            {status.ai.lastFailure.hint && (
              <p className="mt-1.5 text-[11.5px] font-medium leading-relaxed text-ink-2">
                {status.ai.lastFailure.hint}
              </p>
            )}
            <p className="mt-1.5 text-[11px] text-ink-3">
              Last failure {new Date(status.ai.lastFailure.at).toLocaleString()}
              {status.ai.lastSuccessAt &&
                ` · last success ${new Date(status.ai.lastSuccessAt).toLocaleString()}`}
            </p>
          </div>
        </div>
      )}

      {status?.capReached && (
        <div role="alert" className="card border-danger/40 bg-danger-soft p-4 flex gap-3">
          <AlertTriangle size={17} className="text-danger mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-danger">Daily send limit reached</p>
            <p className="text-[11.5px] text-ink-2 mt-1 leading-relaxed">
              {status.sentLast24h} of {status.dailySendCap} replies sent in the last 24 hours.
              Nothing further will go out until the window rolls over.
            </p>
          </div>
        </div>
      )}

      <section className="card">
        <header className="flex items-center gap-3 px-6 py-4 border-b border-line">
          <span className="relative w-2.5 h-2.5 rounded-full shrink-0" style={{ background: running ? 'var(--ok)' : 'var(--warn)' }}>
            <span
              className="absolute -inset-1 rounded-full border-2 opacity-50 animate-ping2"
              style={{ borderColor: running ? 'var(--ok)' : 'var(--warn)' }}
            />
          </span>
          <div className="flex-1">
            <h2 className="card-title">Automation status</h2>
            <p className="card-sub">
              {running ? 'Running · watching your connected mailbox' : 'Paused · drafts continue, nothing sends'}
            </p>
          </div>
          <span className={`chip ${running ? 'bg-ok-soft text-ok' : 'bg-warn-soft text-warn'}`}>
            {running ? 'Running' : 'Paused'}
          </span>
        </header>

        <div className="grid grid-cols-2 gap-px bg-line">
          {stats.map((s) => (
            <div key={s.label} className="bg-surface px-6 py-4">
              <p className="text-[11.5px] font-medium text-ink-3">{s.label}</p>
              <p className="text-[19px] font-bold tracking-[-0.03em] mt-0.5 tabular-nums">
                {s.value}
                {s.unit && <span className="text-xs font-medium text-ink-3">{s.unit}</span>}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <header className="card-head">
          <h2 className="card-title">Quick actions</h2>
        </header>
        <div className="grid grid-cols-2 gap-2 p-4">
          <button
            className="btn btn-sm btn-primary col-span-2 justify-start h-[38px]"
            disabled={busy !== null}
            onClick={() =>
              action(
                'run',
                () => api.post('/automation/run'),
                (r: { autoSent: number; heldForApproval: number; skipped?: string }) => ({
                  title: r.skipped ? 'Already running' : 'Automation run complete',
                  detail: r.skipped ?? `${r.autoSent} sent · ${r.heldForApproval} held for approval`,
                }),
              )
            }
          >
            <Play size={14} /> Run automation
          </button>

          <button
            className="btn btn-sm justify-start h-[38px]"
            disabled={busy !== null}
            onClick={() =>
              action(
                'pause',
                () => api.post(running ? '/automation/pause' : '/automation/resume'),
                () => ({ title: running ? 'Automation paused' : 'Automation resumed' }),
              )
            }
          >
            {running ? <Pause size={14} /> : <Play size={14} />} {running ? 'Pause' : 'Resume'}
          </button>

          <button
            className="btn btn-sm justify-start h-[38px]"
            disabled={busy !== null}
            onClick={() =>
              action(
                'retry',
                () => api.post('/emails/retry-failed'),
                (r: { sent: number; attempted: number; errors?: string[] }) => ({
                  title: r.attempted ? `${r.sent} of ${r.attempted} delivered` : 'Nothing to retry',
                  detail: r.errors?.length ? r.errors[0] : undefined,
                  kind: r.attempted && !r.sent ? ('error' as const) : undefined,
                }),
              )
            }
          >
            <RefreshCw size={14} /> Retry failed
          </button>

          <button
            className="btn btn-sm justify-start h-[38px]"
            disabled={busy !== null}
            onClick={() =>
              action(
                'sync',
                () => api.post('/automation/sync'),
                (r: { created: number; skipped?: string }) => ({
                  title: r.skipped
                    ? 'Sync already running'
                    : r.created
                      ? `${r.created} new emails`
                      : 'Mailbox up to date',
                  detail: r.skipped,
                }),
              )
            }
          >
            <RotateCw size={14} className={busy === 'sync' ? 'animate-spin' : ''} /> Sync inbox
          </button>

          <button className="btn btn-sm justify-start h-[38px]" onClick={() => onJumpToQueue('pending')}>
            <ListChecks size={14} /> Review pending
          </button>

          {/* Recovery for an AI outage: drafts written by the offline stub are
              not touched by a normal run, so they need rewriting explicitly. */}
          <button
            className="btn btn-sm justify-start h-[38px] col-span-2"
            disabled={busy !== null || !status?.aiConfigured}
            title={
              status?.aiConfigured
                ? 'Replace every draft that was written by the offline template'
                : 'Configure an AI model first'
            }
            onClick={() =>
              action(
                'stubs',
                () => api.post('/emails/regenerate-stubs'),
                (r: { found: number; rewritten: number; failed: number }) => ({
                  title: r.found
                    ? `${r.rewritten} of ${r.found} drafts rewritten`
                    : 'No template drafts left',
                  detail: r.failed ? `${r.failed} could not be rewritten` : undefined,
                  kind: r.failed && !r.rewritten ? ('error' as const) : undefined,
                }),
              )
            }
          >
            <Sparkles size={14} className={busy === 'stubs' ? 'animate-pulse' : ''} />
            Rewrite template drafts
          </button>
        </div>
      </section>

      <section className="card">
        <header className="card-head">
          <div>
            <h2 className="card-title">AI suggestions</h2>
            <p className="card-sub">Patterns found in your current queue</p>
          </div>
        </header>
        {(suggestions ?? []).map((s) => (
          <button
            key={s.key}
            onClick={() => onJumpToQueue('pending')}
            className="group flex gap-3 w-full text-left px-6 py-3.5 border-b border-line last:border-b-0
                       transition hover:bg-surface-2"
          >
            <SuggestionIcon k={s.key} />
            <div className="min-w-0">
              <p className="text-[13px] font-medium tracking-[-0.005em]">
                {s.title}
                {s.count > 0 && <span className="ml-1.5 text-ink-3">({s.count})</span>}
              </p>
              <p className="text-xs text-ink-3 mt-0.5 leading-relaxed">{s.detail}</p>
            </div>
            <ArrowRight size={15} className="ml-auto self-center text-ink-3 opacity-0 transition group-hover:opacity-100 group-hover:translate-x-0.5" />
          </button>
        ))}
      </section>

      <section className="card">
        <header className="card-head">
          <h2 className="card-title">Recent activity</h2>
          <span className="chip">
            <span className="w-1.5 h-1.5 rounded-full bg-ok" /> Live
          </span>
        </header>
        <div className="px-6 py-4">
          {(activity ?? []).length === 0 && (
            <p className="text-[12.5px] text-ink-3 py-2">
              Nothing yet. Run the automation and events land here as they happen.
            </p>
          )}
          {(activity ?? []).map((a, i, arr) => (
            <div key={a._id} className="relative flex gap-3 pb-4 last:pb-0">
              {i < arr.length - 1 && <span className="absolute left-3 top-[26px] bottom-0.5 w-px bg-line" />}
              <span className="relative z-[1] grid place-items-center w-[25px] h-[25px] rounded-lg border border-line bg-surface shrink-0">
                <ActivityIcon type={a.type} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] font-medium tracking-[-0.005em]">{a.title}</p>
                {a.detail && <p className="text-[11.5px] text-ink-3 mt-px truncate">{a.detail}</p>}
              </div>
              <span className="text-[11px] text-ink-3 shrink-0 pt-px font-mono">{clock(a.createdAt)}</span>
            </div>
          ))}
        </div>
      </section>
    </aside>
  );
}

function SuggestionIcon({ k }: { k: string }) {
  const map: Record<string, { Icon: typeof Mail; colour: string; bg: string }> = {
    invoice: { Icon: FileText, colour: '#2563EB', bg: 'var(--blue-50)' },
    complaint: { Icon: AlertTriangle, colour: '#DC2626', bg: 'var(--red-soft)' },
    hr: { Icon: User, colour: '#7C3AED', bg: 'var(--violet-soft)' },
    followup: { Icon: Clock, colour: 'var(--warn)', bg: 'var(--amber-soft)' },
    lowconf: { Icon: Bot, colour: 'var(--text-2)', bg: 'var(--surface-3)' },
  };
  const { Icon, colour, bg } = map[k] ?? map.lowconf;
  return (
    <span className="grid place-items-center w-7 h-7 rounded-[9px] shrink-0" style={{ background: bg, color: colour }}>
      <Icon size={15} strokeWidth={2} />
    </span>
  );
}

function ActivityIcon({ type }: { type: string }) {
  const map: Record<string, { Icon: typeof Mail; colour: string }> = {
    email_received: { Icon: Mail, colour: 'var(--text-2)' },
    ai_generated: { Icon: Sparkles, colour: '#7C3AED' },
    reply_approved: { Icon: Check, colour: 'var(--ok)' },
    reply_rejected: { Icon: AlertTriangle, colour: 'var(--warn)' },
    email_sent: { Icon: Send, colour: '#2563EB' },
    delivery_success: { Icon: Check, colour: 'var(--ok)' },
    delivery_failed: { Icon: AlertTriangle, colour: '#DC2626' },
    sync: { Icon: RotateCw, colour: '#2563EB' },
    automation_run: { Icon: Play, colour: '#2563EB' },
    settings_changed: { Icon: Check, colour: 'var(--text-2)' },
  };
  const { Icon, colour } = map[type] ?? map.sync;
  return <Icon size={13} strokeWidth={2.1} style={{ color: colour }} />;
}
