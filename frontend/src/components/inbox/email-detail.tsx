'use client';

import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  Check,
  CheckCircle2,
  RotateCw,
  Send,
  Shield,
  ShieldAlert,
  SquarePen,
  User as UserIcon,
  X,
} from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { AttachmentGrid } from '@/components/inbox/attachments';
import { StatusChip } from '@/components/ui/status-chip';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { api } from '@/lib/api';
import { useApp } from '@/components/providers';
import { CATEGORY_COLOURS, clock, confidenceColour } from '@/lib/format';
import type { Email } from '@/lib/types';

interface Props {
  email: Email | undefined;
  loading: boolean;
  onChanged: () => void;
}

export function EmailDetail({ email, loading, onChanged }: Props) {
  const { toast } = useApp();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmSend, setConfirmSend] = useState(false);

  // Keyed on the id alone. Keying on aiReply as well meant an in-progress edit
  // was wiped the moment a background revalidation returned.
  useEffect(() => {
    setEditing(false);
    setConfirmSend(false);
    setDraft(email?.aiReply ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email?._id]);

  if (loading) return <DetailSkeleton />;
  if (!email) return <EmptyDetail />;

  const sent = email.status === 'replied';
  const failed = email.status === 'failed';
  const isSpam = email.category === 'spam';
  const confidence = email.aiConfidence ?? 0;
  const flagged = Boolean(email.aiInjectionSuspected);
  const problems = email.aiProblems ?? [];
  const bodyToSend = (editing ? draft : draft || email.aiReply || '').trim();

  async function run(action: string, fn: () => Promise<unknown>, success: string) {
    setBusy(action);
    try {
      await fn();
      toast({ title: success });
      onChanged();
    } catch (e) {
      toast({ title: 'That did not work', detail: (e as Error).message, kind: 'error' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col min-w-0 h-full overflow-y-auto">
      <header className="sticky top-0 z-[5] px-6 pt-[18px] pb-4 border-b border-line bg-surface">
        <h2 className="text-[17px] font-semibold tracking-[-0.025em] leading-tight break-words">
          {email.subject}
        </h2>
        <div className="flex items-center gap-2 mt-2.5 flex-wrap">
          <StatusChip status={email.status} sentBy={email.sentBy} />
          <span className="chip" style={{ color: CATEGORY_COLOURS[email.category] }}>
            <span className="w-1.5 h-1.5 rounded-full bg-current" />
            {email.category}
          </span>
          <time
            className="text-xs text-ink-3"
            dateTime={email.receivedAt}
          >
            {new Date(email.receivedAt).toLocaleString([], {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}
          </time>
        </div>
      </header>

      {flagged && (
        <div
          role="alert"
          className="mx-6 mt-4 flex gap-3 rounded-xl border border-danger/40 bg-danger-soft p-3.5"
        >
          <ShieldAlert size={17} className="text-danger mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-danger">
              This email tried to give the AI instructions
            </p>
            <p className="text-[12px] text-ink-2 mt-1 leading-relaxed">
              It will never be answered automatically. Read the original message before you send
              anything — the draft below was written after the attempt was neutralised, but treat
              the request itself as untrusted.
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-4 p-6">
        {email.thread.map((m, i) => (
          <article key={`${m.sentAt}-${i}`} className="flex gap-3">
            <Avatar name={m.fromName || m.from} size={32} />
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-[13px] font-semibold">{m.fromName || m.from}</span>
                <span className="text-xs text-ink-3 break-all">{m.from}</span>
                {m.outbound && (
                  <span className="chip bg-brand-soft text-brand">
                    <Send size={10} strokeWidth={2.6} /> Sent by this workspace
                  </span>
                )}
                <span className="ml-auto text-[11.5px] text-ink-3">{clock(m.sentAt)}</span>
              </div>
              <p
                className={`text-[13.5px] leading-relaxed mt-1.5 whitespace-pre-line break-words ${
                  m.outbound
                    ? 'text-ink-2 p-3.5 bg-surface-2 border border-line rounded-xl'
                    : 'text-ink-2'
                }`}
              >
                {m.body}
              </p>
              {/* Attachments belong to the message they arrived on. This record
                  is one received message, so they render against its first
                  inbound entry and never under a reply we sent. */}
              {!m.outbound && i === 0 && email.attachments.length > 0 && (
                <AttachmentGrid emailId={email._id} attachments={email.attachments} />
              )}
            </div>
          </article>
        ))}
      </div>

      {isSpam ? (
        <div className="mx-6 mb-6 border border-line rounded-2xl bg-surface-2 p-4 flex gap-3">
          <Shield size={18} className="text-ink-3 mt-0.5 shrink-0" />
          <div>
            <p className="text-[13px] font-semibold">No reply sent</p>
            <p className="text-[11.5px] text-ink-3 mt-1">{email.aiReason}</p>
          </div>
        </div>
      ) : (
        <section
          className="mx-6 mb-6 border border-brand-border rounded-2xl overflow-hidden"
          style={{ background: 'linear-gradient(180deg, var(--blue-50), var(--surface) 58%)' }}
        >
          <header className="flex items-center gap-3 px-4 py-3.5 border-b border-brand-border">
            <span className="grid place-items-center w-7 h-7 rounded-[9px] bg-brand text-white shrink-0">
              <SquarePen size={15} strokeWidth={2} />
            </span>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold tracking-[-0.01em]">
                {sent
                  ? email.sentBy === 'ai'
                    ? 'Sent automatically by the automation'
                    : 'Sent after you approved it'
                  : failed
                    ? 'Reply could not be delivered'
                    : 'AI drafted this reply — not sent'}
              </p>
              <p className="text-[11.5px] text-ink-3 mt-px">
                {email.failureReason ?? email.aiReason}
              </p>
            </div>
            <ConfidenceRing value={confidence} />
          </header>

          {(email.aiIsStub || problems.length > 0) && !sent && (
            <div className="px-4 pt-3 flex flex-col gap-2">
              {email.aiIsStub && (
                <p className="flex gap-2 text-[11.5px] text-ink-2 leading-relaxed">
                  <Bot size={13} className="mt-px shrink-0 text-warn" />
                  This is the offline template, not a written reply — the AI model was unreachable
                  when it was drafted, so it says the same thing for every email. It will never be
                  sent automatically. Use <strong>Rewrite template drafts</strong> once the model is
                  working, or press Regenerate on this one.
                </p>
              )}
              {problems.map((p) => (
                <p key={p} className="flex gap-2 text-[11.5px] text-ink-2 leading-relaxed">
                  <AlertTriangle size={13} className="mt-px shrink-0 text-warn" />
                  {p}
                </p>
              ))}
            </div>
          )}

          <div className="p-4 max-h-[40vh] overflow-y-auto">
            {editing ? (
              <>
                <label htmlFor="draft-editor" className="sr-only">
                  Edit the reply before sending
                </label>
                <textarea
                  id="draft-editor"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  className="w-full min-h-[190px] p-3.5 rounded-[10px] border border-brand-border bg-surface
                             text-[13.5px] leading-relaxed resize-y focus:outline-none focus:border-brand"
                />
              </>
            ) : (
              <p className="text-[13.5px] leading-relaxed text-ink-2 whitespace-pre-line break-words">
                {email.aiReply || 'No draft yet — run the automation to generate one.'}
              </p>
            )}
          </div>

          <footer className="sticky bottom-0 bg-surface border-t border-line flex items-center gap-2 px-4 py-3 flex-wrap">
            {editing ? (
              <>
                <button
                  className="btn btn-sm btn-primary"
                  disabled={busy !== null || !draft.trim()}
                  onClick={() =>
                    run(
                      'save',
                      async () => {
                        await api.patch(`/emails/${email._id}/draft`, { body: draft });
                        setEditing(false);
                      },
                      'Draft saved',
                    )
                  }
                >
                  <Check size={14} /> Save draft
                </button>
                <button
                  className="btn btn-sm"
                  onClick={() => {
                    setEditing(false);
                    setDraft(email.aiReply ?? '');
                  }}
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button className="btn btn-sm" onClick={() => setEditing(true)} disabled={sent}>
                  <SquarePen size={14} /> Edit reply
                </button>
                <button
                  className="btn btn-sm"
                  disabled={busy !== null || sent}
                  onClick={() =>
                    run(
                      'regen',
                      () => api.post(`/emails/${email._id}/regenerate`),
                      'Reply regenerated',
                    )
                  }
                >
                  <RotateCw size={14} className={busy === 'regen' ? 'animate-spin' : ''} />
                  Regenerate
                </button>
                <span className="flex-1" />
                {sent ? (
                  <span className="chip bg-ok-soft text-ok">
                    {email.sentBy === 'ai' ? <Bot size={12} /> : <UserIcon size={12} />}
                    Delivered {email.sentAt ? clock(email.sentAt) : ''}
                  </span>
                ) : (
                  <>
                    <button
                      className="btn btn-sm btn-danger"
                      disabled={busy !== null}
                      onClick={() =>
                        run('reject', () => api.post(`/emails/${email._id}/reject`), 'Draft rejected')
                      }
                    >
                      <X size={14} /> Reject
                    </button>
                    <button
                      className="btn btn-sm btn-primary"
                      disabled={busy !== null || !bodyToSend}
                      onClick={() => setConfirmSend(true)}
                    >
                      {failed ? <RotateCw size={14} /> : <CheckCircle2 size={14} />}
                      {failed ? 'Retry send' : 'Approve & send'}
                    </button>
                  </>
                )}
              </>
            )}
          </footer>
        </section>
      )}

      <ConfirmDialog
        open={confirmSend}
        title={failed ? 'Send this reply again?' : 'Send this reply now?'}
        tone={flagged ? 'danger' : 'primary'}
        busy={busy === 'send'}
        confirmLabel={failed ? 'Retry send' : 'Send reply'}
        body={
          <>
            <p>
              This goes to <strong className="text-ink">{email.fromEmail}</strong> and cannot be
              undone.
            </p>
            {flagged && (
              <p className="mt-2 text-danger">
                This email tried to manipulate the AI. Read the draft yourself before sending.
              </p>
            )}
            {email.aiIsStub && (
              <p className="mt-2 text-warn">
                This draft came from the offline template, not a language model.
              </p>
            )}
          </>
        }
        onCancel={() => setConfirmSend(false)}
        onConfirm={() =>
          run(
            'send',
            async () => {
              await api.post(`/emails/${email._id}/approve`, { body: bodyToSend });
              setConfirmSend(false);
              setEditing(false);
            },
            failed ? 'Retry sent' : 'Reply sent',
          )
        }
      />
    </div>
  );
}

function ConfidenceRing({ value }: { value: number }) {
  const safe = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
  const c = 2 * Math.PI * 18;
  const colour = confidenceColour(safe);
  return (
    <div
      className="relative w-11 h-11 ml-auto shrink-0"
      role="img"
      aria-label={`AI confidence ${safe} percent`}
    >
      <svg width="44" height="44" style={{ transform: 'rotate(-90deg)' }} aria-hidden>
        <circle cx="22" cy="22" r="18" stroke="var(--line-strong)" strokeWidth="4" fill="none" />
        <circle
          cx="22"
          cy="22"
          r="18"
          stroke={colour}
          strokeWidth="4"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - safe / 100)}
        />
      </svg>
      <span
        className="absolute inset-0 grid place-items-center text-[11.5px] font-bold tracking-[-0.02em]"
        style={{ color: colour }}
        aria-hidden
      >
        {safe}
      </span>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="p-6" role="status" aria-label="Loading email">
      <div className="skeleton h-4 w-3/5" />
      <div className="skeleton h-5 w-44 mt-3 rounded-md" />
      <div className="skeleton h-24 w-full mt-6 rounded-xl" />
      <div className="skeleton h-40 w-full mt-4 rounded-2xl" />
    </div>
  );
}

function EmptyDetail() {
  return (
    <div className="flex flex-col items-center justify-center gap-3.5 min-h-[400px] px-6 py-12 text-center">
      <svg viewBox="0 0 120 120" className="w-[104px] h-[104px]" fill="none" aria-hidden>
        <rect x="24" y="26" width="72" height="68" rx="10" fill="var(--surface-3)" />
        <rect x="38" y="44" width="44" height="5" rx="2.5" fill="var(--line-strong)" />
        <rect x="38" y="58" width="34" height="5" rx="2.5" fill="var(--line-strong)" />
        <rect x="38" y="72" width="40" height="5" rx="2.5" fill="var(--line-strong)" />
        <circle cx="88" cy="88" r="18" fill="var(--blue-50)" />
        <path d="M88 80v16M80 88h16" stroke="#2563EB" strokeWidth="3" strokeLinecap="round" />
      </svg>
      <p className="text-[15px] font-semibold tracking-[-0.015em]">Pick an email to see the draft</p>
      <p className="text-[13px] text-ink-3 max-w-[300px] leading-relaxed">
        Select anything on the left and the AI reply, confidence score and approval controls appear
        here.
      </p>
    </div>
  );
}
