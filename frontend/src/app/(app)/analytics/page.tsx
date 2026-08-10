'use client';

import { useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { AreaChart, BarChart, Donut, Gauge, LineChart } from '@/components/charts/primitives';
import { useAnalytics } from '@/lib/hooks';
import { CATEGORY_COLOURS } from '@/lib/format';

const RANGES = [
  { days: 14, label: '14 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: 'Quarter' },
];

export default function AnalyticsPage() {
  const [days, setDays] = useState(14);
  const { data, isLoading } = useAnalytics(days);

  const labels = (data?.received ?? []).map((p) =>
    new Date(p.date).toLocaleDateString([], { day: 'numeric', month: 'short' }),
  );
  const received = (data?.received ?? []).map((p) => p.value);
  const autoReplied = (data?.autoReplied ?? []).map((p) => p.value);
  const pending = (data?.pending ?? []).map((p) => p.value);
  const responseTime = (data?.responseTimeSeconds ?? []).map((p) => p.value);
  const categoryTotal = (data?.categories ?? []).reduce((s, c) => s + c.count, 0) || 1;
  const change = data?.totals.changePercent ?? 0;

  return (
    <>
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold tracking-[-0.025em]">Analytics</h1>
          <p className="text-[13px] text-ink-3 mt-0.5">
            Last {days} days · compared with the previous {days}
          </p>
        </div>
        <div className="inline-flex p-0.5 bg-surface-3 rounded-[9px] gap-0.5">
          {RANGES.map((r) => (
            <button
              key={r.days}
              onClick={() => setDays(r.days)}
              className={`px-2.5 py-1 rounded-md text-[12.5px] transition
                          ${days === r.days ? 'bg-surface font-semibold shadow-e1' : 'text-ink-2 font-medium'}`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </header>

      {isLoading || !data ? (
        <div className="grid grid-cols-6 gap-4 max-lg:grid-cols-1">
          <div className="skeleton col-span-4 h-80 rounded-2xl max-lg:col-span-1" />
          <div className="skeleton col-span-2 h-80 rounded-2xl max-lg:col-span-1" />
          <div className="skeleton col-span-3 h-64 rounded-2xl max-lg:col-span-1" />
          <div className="skeleton col-span-3 h-64 rounded-2xl max-lg:col-span-1" />
        </div>
      ) : (
        <div className="grid grid-cols-6 gap-4 max-lg:grid-cols-1">
          <section className="card col-span-4 max-lg:col-span-1">
            <header className="card-head">
              <div>
                <h2 className="card-title">Emails received</h2>
                <p className="card-sub">Solid line is received, dashed is auto-replied</p>
              </div>
              <div className="flex gap-4 max-sm:hidden">
                <Legend colour="#2563EB" label="Received" value={data.totals.received} />
                <Legend colour="#7C3AED" label="Auto replied" value={data.totals.autoReplied} />
              </div>
            </header>
            <div className="p-6 pt-[18px]">
              <AreaChart labels={labels} primary={received} secondary={autoReplied} />
            </div>
          </section>

          <section className="card col-span-2 max-lg:col-span-1">
            <header className="card-head">
              <div>
                <h2 className="card-title">Automation success rate</h2>
                <p className="card-sub">Sent without a bounce</p>
              </div>
            </header>
            <div className="flex flex-col items-center gap-4 p-6">
              <div className="relative">
                <Gauge percent={data.delivery.successRate} />
                <div className="absolute inset-0 grid place-items-center text-center">
                  <div>
                    <p className="text-[34px] font-bold tracking-[-0.04em] leading-none tabular-nums">
                      {data.delivery.successRate}
                      <span className="text-lg">%</span>
                    </p>
                    <p className="text-[11.5px] text-ink-3 mt-1">
                      {data.delivery.delivered} of {data.delivery.delivered + data.delivery.failed}
                    </p>
                  </div>
                </div>
              </div>
              <div className="w-full">
                <Bar label="Delivered" value={data.delivery.delivered} max={data.delivery.delivered + data.delivery.failed} colour="var(--ok)" />
                <Bar label="Failed" value={data.delivery.failed} max={data.delivery.delivered + data.delivery.failed} colour="#DC2626" />
              </div>
            </div>
          </section>

          <section className="card col-span-3 max-lg:col-span-1">
            <header className="card-head">
              <div>
                <h2 className="card-title">Auto replies per day</h2>
                <p className="card-sub">Replies the automation sent</p>
              </div>
              <span className={`chip ${change >= 0 ? 'bg-ok-soft text-ok' : 'bg-danger-soft text-danger'}`}>
                {change >= 0 ? <ArrowUp size={11} strokeWidth={2.8} /> : <ArrowDown size={11} strokeWidth={2.8} />}
                {Math.abs(change)}%
              </span>
            </header>
            <div className="p-6 pt-[18px]">
              <BarChart labels={labels} primary={autoReplied} />
            </div>
          </section>

          <section className="card col-span-3 max-lg:col-span-1">
            <header className="card-head">
              <div>
                <h2 className="card-title">Pending queue</h2>
                <p className="card-sub">Emails held for human approval</p>
              </div>
            </header>
            <div className="p-6 pt-[18px]">
              <LineChart labels={labels} primary={pending} />
            </div>
          </section>

          <section className="card col-span-3 max-lg:col-span-1">
            <header className="card-head">
              <div>
                <h2 className="card-title">Category distribution</h2>
                <p className="card-sub">Where the mail actually comes from</p>
              </div>
            </header>
            <div className="flex items-center gap-6 p-6 flex-wrap">
              <div className="relative shrink-0">
                <Donut
                  items={data.categories.map((c) => ({
                    label: c.category,
                    value: c.count,
                    colour: CATEGORY_COLOURS[c.category] ?? '#64748B',
                  }))}
                />
                <div className="absolute inset-0 grid place-items-center text-center">
                  <div>
                    <p className="text-[22px] font-bold tracking-[-0.03em]">{categoryTotal}</p>
                    <p className="text-[11px] text-ink-3">classified</p>
                  </div>
                </div>
              </div>
              <ul className="flex-1 min-w-[170px] flex flex-col gap-1.5">
                {data.categories.map((c) => (
                  <li key={c.category} className="flex items-center gap-2 text-xs text-ink-2 capitalize">
                    <span className="w-2 h-2 rounded-[3px] shrink-0" style={{ background: CATEGORY_COLOURS[c.category] }} />
                    {c.category}
                    <b className="ml-auto font-semibold text-ink tabular-nums">
                      {Math.round((c.count / categoryTotal) * 100)}%
                    </b>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section className="card col-span-3 max-lg:col-span-1">
            <header className="card-head">
              <div>
                <h2 className="card-title">Average response time</h2>
                <p className="card-sub">First reply, in seconds</p>
              </div>
            </header>
            <div className="p-6 pt-[18px]">
              <p className="text-[34px] font-bold tracking-[-0.04em] leading-none tabular-nums mb-2">
                {responseTime.at(-1) ?? 0}
                <span className="text-base font-semibold">s</span>
              </p>
              <LineChart labels={labels} primary={responseTime} primaryColour="#2563EB" height={150} formatValue={(v) => `${v}s`} />
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function Legend({ colour, label, value }: { colour: string; label: string; value: number }) {
  return (
    <span className="flex items-center gap-2 text-xs text-ink-2">
      <span className="w-2 h-2 rounded-[3px]" style={{ background: colour }} />
      {label}
      <b className="font-semibold text-ink tabular-nums">{value.toLocaleString()}</b>
    </span>
  );
}

function Bar({ label, value, max, colour }: { label: string; value: number; max: number; colour: string }) {
  return (
    <div className="flex items-center gap-3 py-[7px]">
      <span className="text-[12.5px] w-[76px] shrink-0 text-ink-2">{label}</span>
      <span className="flex-1 h-2 rounded-full bg-surface-3 overflow-hidden">
        <span
          className="block h-full rounded-full transition-[width] duration-700"
          style={{ width: `${max ? (value / max) * 100 : 0}%`, background: colour }}
        />
      </span>
      <span className="text-xs font-semibold w-[52px] text-right tabular-nums">{value}</span>
    </div>
  );
}
