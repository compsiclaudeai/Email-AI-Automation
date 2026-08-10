'use client';

import { AlertTriangle, Check, Sparkles, X } from 'lucide-react';

export interface Toast {
  id: string;
  title: string;
  detail?: string;
  kind?: 'ok' | 'info' | 'warn' | 'error';
}

const STYLE = {
  ok: { Icon: Check, colour: 'var(--ok)', bg: 'var(--green-soft)' },
  info: { Icon: Sparkles, colour: '#2563EB', bg: 'var(--blue-50)' },
  warn: { Icon: AlertTriangle, colour: 'var(--warn)', bg: 'var(--amber-soft)' },
  error: { Icon: X, colour: '#DC2626', bg: 'var(--red-soft)' },
} as const;

export function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}) {
  return (
    <div className="fixed bottom-5 right-5 z-[150] flex flex-col items-end gap-2.5 max-sm:left-3 max-sm:right-3">
      {toasts.map((t) => {
        const { Icon, colour, bg } = STYLE[t.kind ?? 'ok'];
        return (
          <div
            key={t.id}
            role="status"
            className="flex items-center gap-3 min-w-[270px] max-w-[380px] max-sm:w-full
                       px-3.5 py-3 bg-surface border border-line rounded-xl shadow-e3 animate-toastIn"
          >
            <span
              className="grid place-items-center w-7 h-7 rounded-lg shrink-0"
              style={{ background: bg, color: colour }}
            >
              <Icon size={15} strokeWidth={2.2} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold tracking-[-0.008em]">{t.title}</div>
              {t.detail && <div className="text-xs text-ink-3 mt-0.5">{t.detail}</div>}
            </div>
            <button
              onClick={() => onDismiss(t.id)}
              aria-label="Dismiss notification"
              className="text-ink-3 hover:text-ink transition"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
