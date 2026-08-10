'use client';

import { useEffect, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';

interface Props {
  open: boolean;
  title: string;
  /** Rendered under the title. Keep it to what the person is about to cause. */
  body: React.ReactNode;
  confirmLabel: string;
  tone?: 'primary' | 'danger';
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * A real modal dialog: labelled, focus-trapped, Escape-dismissible and
 * restoring focus on close.
 *
 * Sending an email cannot be undone, so it is the one action in this product
 * that always goes through here — including the keyboard shortcut, which
 * previously sent immediately on a single keypress.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  tone = 'primary',
  busy = false,
  onConfirm,
  onCancel,
}: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    restoreTo.current = document.activeElement as HTMLElement | null;
    confirmButton.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
        return;
      }
      if (e.key !== 'Tab') return;

      // Focus trap. Without it, Tab walks out of the dialog and into the page
      // behind it, which a screen-reader user cannot see is still there.
      const focusable = panel.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      restoreTo.current?.focus?.();
    };
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200] grid place-items-center p-4">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
        onClick={busy ? undefined : onCancel}
        aria-hidden
      />
      <div
        ref={panel}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-body"
        className="relative w-full max-w-[440px] rounded-2xl border border-line bg-surface
                   shadow-e3 animate-fade p-5"
      >
        <div className="flex gap-3.5">
          <span
            className={`grid place-items-center w-9 h-9 rounded-xl shrink-0 ${
              tone === 'danger' ? 'bg-danger-soft text-danger' : 'bg-brand-soft text-brand'
            }`}
          >
            <AlertTriangle size={18} strokeWidth={2} />
          </span>
          <div className="min-w-0">
            <h2 id="confirm-title" className="text-[15px] font-semibold tracking-[-0.02em]">
              {title}
            </h2>
            <div id="confirm-body" className="text-[13px] text-ink-2 mt-1.5 leading-relaxed">
              {body}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            ref={confirmButton}
            className={`btn ${tone === 'danger' ? 'btn-danger' : 'btn-primary'}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
