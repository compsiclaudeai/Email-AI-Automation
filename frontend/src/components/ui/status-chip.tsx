import { Bot, User } from 'lucide-react';
import { STATUS_LABEL } from '@/lib/format';
import type { EmailStatus } from '@/lib/types';

const TONE: Record<string, string> = {
  brand: 'bg-brand-soft text-brand',
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
  muted: 'bg-surface-3 text-ink-3',
};

/**
 * A sent reply is labelled by *who* sent it.
 *
 * Every reply used to read "Auto replied", including the ones a person read,
 * edited and approved by hand — which is exactly the misattribution this
 * product must not make in either direction.
 */
export function StatusChip({
  status,
  sentBy,
}: {
  status: EmailStatus;
  sentBy?: 'ai' | 'user';
}) {
  if (status === 'replied') {
    const ai = sentBy === 'ai';
    return (
      <span className={`chip ${TONE.ok}`} title={ai ? 'Sent by the automation with no human review' : 'A person approved this before it was sent'}>
        {ai ? <Bot size={11} strokeWidth={2.4} /> : <User size={11} strokeWidth={2.4} />}
        {ai ? 'Auto replied' : 'Approved & sent'}
      </span>
    );
  }

  const meta = STATUS_LABEL[status] ?? STATUS_LABEL.unread;
  return <span className={`chip ${TONE[meta.tone]}`}>{meta.label}</span>;
}
