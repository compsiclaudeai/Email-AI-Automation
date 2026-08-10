'use client';

import { AlertTriangle, ArrowDown, ArrowUp, Bot, Clock, Mail, MailOpen } from 'lucide-react';
import { Sparkline } from '@/components/charts/primitives';
import { useKpis } from '@/lib/hooks';

const STYLE: Record<string, { Icon: typeof Mail; colour: string; bg: string; lowerIsBetter?: boolean }> = {
  total: { Icon: Mail, colour: '#2563EB', bg: 'var(--blue-50)' },
  unread: { Icon: MailOpen, colour: '#7C3AED', bg: 'var(--violet-soft)', lowerIsBetter: true },
  pending: { Icon: Clock, colour: 'var(--warn)', bg: 'var(--amber-soft)', lowerIsBetter: true },
  replied: { Icon: Bot, colour: 'var(--ok)', bg: 'var(--green-soft)' },
  failed: { Icon: AlertTriangle, colour: '#DC2626', bg: 'var(--red-soft)', lowerIsBetter: true },
};

export function KpiCards() {
  const { data, isLoading } = useKpis();

  if (isLoading || !data) {
    return (
      <div className="grid grid-cols-5 gap-4 max-xl:grid-cols-3 max-sm:grid-cols-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="card p-[18px]">
            <div className="skeleton h-3 w-16" />
            <div className="skeleton h-7 w-20 mt-4" />
            <div className="skeleton h-3 w-12 mt-4" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-5 gap-4 max-xl:grid-cols-3 max-sm:grid-cols-2">
      {data.map((k, i) => {
        const s = STYLE[k.key] ?? STYLE.total;
        const up = k.change > 0;
        const good = s.lowerIsBetter ? !up : up;
        return (
          <article
            key={k.key}
            className="card p-[18px] animate-fade transition hover:-translate-y-0.5 hover:shadow-e2 hover:border-line-strong"
            style={{ animationDelay: `${i * 45}ms`, animationFillMode: 'backwards' }}
          >
            <header className="flex items-center justify-between mb-3.5">
              <span className="text-[12.5px] font-medium text-ink-2">{k.label}</span>
              <span className="grid place-items-center w-[30px] h-[30px] rounded-[9px]" style={{ background: s.bg, color: s.colour }}>
                <s.Icon size={15} strokeWidth={2} />
              </span>
            </header>
            <p className="text-[27px] font-bold tracking-[-0.035em] leading-none tabular-nums">
              {k.value.toLocaleString()}
            </p>
            <footer className="flex items-end justify-between gap-2.5 mt-2.5">
              {k.change !== 0 ? (
                <span className={`inline-flex items-center gap-0.5 text-[11.5px] font-semibold ${good ? 'text-ok' : 'text-danger'}`}>
                  {up ? <ArrowUp size={12} strokeWidth={2.6} /> : <ArrowDown size={12} strokeWidth={2.6} />}
                  {Math.abs(k.change).toFixed(1)}%
                </span>
              ) : (
                <span className="text-[11.5px] font-medium text-ink-3">no change</span>
              )}
              <Sparkline values={k.trend} colour={s.colour} />
            </footer>
          </article>
        );
      })}
    </div>
  );
}
