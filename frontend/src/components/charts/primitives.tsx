'use client';

/** Hand-rolled SVG charts — no chart library, so bundle size stays flat. */

function smoothPath(values: number[], w: number, h: number, pad: number, max: number) {
  const iw = w - pad * 2;
  const ih = h - pad - 18;
  const x = (i: number) => pad + (values.length > 1 ? (i / (values.length - 1)) * iw : iw / 2);
  const y = (v: number) => pad + ih - (max ? (v / max) * ih : 0);

  let d = `M${x(0)},${y(values[0] ?? 0)}`;
  for (let i = 1; i < values.length; i++) {
    const cx = (x(i - 1) + x(i)) / 2;
    d += ` C${cx},${y(values[i - 1])} ${cx},${y(values[i])} ${x(i)},${y(values[i])}`;
  }
  return { d, x, y, ih };
}

export function Sparkline({ values, colour, width = 88, height = 30 }: { values: number[]; colour: string; width?: number; height?: number }) {
  if (!values.length) return <svg width={width} height={height} />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => [
    (i / Math.max(1, values.length - 1)) * width,
    height - ((v - min) / range) * (height - 4) - 2,
  ]);

  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const cx = (pts[i - 1][0] + pts[i][0]) / 2;
    d += ` C${cx.toFixed(1)},${pts[i - 1][1].toFixed(1)} ${cx.toFixed(1)},${pts[i][1].toFixed(1)} ${pts[i][0].toFixed(1)},${pts[i][1].toFixed(1)}`;
  }

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} fill="none" aria-hidden>
      <path d={d} stroke={colour} strokeWidth={1.8} strokeLinecap="round" opacity={0.85} />
    </svg>
  );
}

interface SeriesChartProps {
  labels: string[];
  primary: number[];
  secondary?: number[];
  primaryColour?: string;
  secondaryColour?: string;
  height?: number;
  formatValue?: (v: number) => string;
}

export function AreaChart({
  labels,
  primary,
  secondary,
  primaryColour = '#2563EB',
  secondaryColour = '#7C3AED',
  height = 210,
  formatValue = String,
}: SeriesChartProps) {
  const w = 560;
  const pad = 30;
  const max = Math.max(1, ...primary, ...(secondary ?? [])) * 1.12;
  const main = smoothPath(primary, w, height, pad, max);
  const alt = secondary ? smoothPath(secondary, w, height, pad, max) : null;
  const gradientId = `area-${primaryColour.replace('#', '')}`;

  return (
    <svg viewBox={`0 0 ${w} ${height}`} width="100%" preserveAspectRatio="xMidYMid meet" role="img">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={primaryColour} stopOpacity="0.22" />
          <stop offset="100%" stopColor={primaryColour} stopOpacity="0" />
        </linearGradient>
      </defs>

      {[0, 0.25, 0.5, 0.75, 1].map((t) => (
        <g key={t}>
          <line x1={pad} y1={pad + main.ih * t} x2={w - pad} y2={pad + main.ih * t} stroke="var(--line)" strokeDasharray="3 4" />
          <text x={pad - 8} y={pad + main.ih * t + 4} textAnchor="end" fontSize={10} fill="var(--text-3)">
            {formatValue(Math.round(max * (1 - t)))}
          </text>
        </g>
      ))}

      <path d={`${main.d} L${main.x(primary.length - 1)},${pad + main.ih} L${main.x(0)},${pad + main.ih} Z`} fill={`url(#${gradientId})`} />
      {alt && <path d={alt.d} fill="none" stroke={secondaryColour} strokeWidth={2} strokeDasharray="5 4" opacity={0.7} />}
      <path d={main.d} fill="none" stroke={primaryColour} strokeWidth={2.4} strokeLinecap="round" />

      {labels.map((l, i) =>
        i % Math.ceil(labels.length / 7) === 0 ? (
          <text key={l + i} x={main.x(i)} y={height - 2} textAnchor="middle" fontSize={10} fill="var(--text-3)">
            {l}
          </text>
        ) : null,
      )}
    </svg>
  );
}

export function LineChart({ labels, primary, primaryColour = '#D97706', height = 170, formatValue = String }: SeriesChartProps) {
  const w = 560;
  const pad = 30;
  const max = Math.max(1, ...primary) * 1.2;
  const line = smoothPath(primary, w, height, pad, max);
  const lastX = line.x(primary.length - 1);
  const lastY = line.y(primary[primary.length - 1] ?? 0);

  return (
    <svg viewBox={`0 0 ${w} ${height}`} width="100%" preserveAspectRatio="xMidYMid meet" role="img">
      {[0, 0.5, 1].map((t) => (
        <g key={t}>
          <line x1={pad} y1={pad + line.ih * t} x2={w - pad} y2={pad + line.ih * t} stroke="var(--line)" strokeDasharray="3 4" />
          <text x={pad - 8} y={pad + line.ih * t + 4} textAnchor="end" fontSize={10} fill="var(--text-3)">
            {formatValue(Math.round(max * (1 - t)))}
          </text>
        </g>
      ))}
      <path d={line.d} fill="none" stroke={primaryColour} strokeWidth={2.4} strokeLinecap="round" />
      <circle cx={lastX} cy={lastY} r={4} fill={primaryColour} />
      <circle cx={lastX} cy={lastY} r={8} fill={primaryColour} opacity={0.18} />
      {labels.map((l, i) =>
        i % Math.ceil(labels.length / 5) === 0 ? (
          <text key={l + i} x={line.x(i)} y={height - 2} textAnchor="middle" fontSize={10} fill="var(--text-3)">
            {l}
          </text>
        ) : null,
      )}
    </svg>
  );
}

export function BarChart({ labels, primary, primaryColour = '#16A34A', height = 190 }: SeriesChartProps) {
  const w = 560;
  const pad = 30;
  const iw = w - pad * 2;
  const ih = height - pad - 18;
  const max = Math.max(1, ...primary) * 1.15;
  const peak = Math.max(1, ...primary);
  const gap = iw / Math.max(1, primary.length);
  const bw = gap * 0.56;

  return (
    <svg viewBox={`0 0 ${w} ${height}`} width="100%" preserveAspectRatio="xMidYMid meet" role="img">
      {[0, 0.5, 1].map((t) => (
        <g key={t}>
          <line x1={pad} y1={pad + ih * t} x2={w - pad} y2={pad + ih * t} stroke="var(--line)" strokeDasharray="3 4" />
          <text x={pad - 8} y={pad + ih * t + 4} textAnchor="end" fontSize={10} fill="var(--text-3)">
            {Math.round(max * (1 - t))}
          </text>
        </g>
      ))}
      {primary.map((v, i) => {
        const bh = (v / max) * ih;
        const x = pad + gap * i + (gap - bw) / 2;
        return (
          <g key={i}>
            <rect x={x} y={pad + ih - bh} width={bw} height={bh} rx={4} fill={primaryColour} opacity={0.45 + 0.55 * (v / peak)}>
              <title>{`${labels[i]}: ${v}`}</title>
            </rect>
            {i % Math.ceil(primary.length / 7) === 0 && (
              <text x={x + bw / 2} y={height - 2} textAnchor="middle" fontSize={10} fill="var(--text-3)">
                {labels[i]}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export function Donut({ items, size = 176 }: { items: { label: string; value: number; colour: string }[]; size?: number }) {
  const r = size / 2 - 14;
  const c = 2 * Math.PI * r;
  const total = items.reduce((s, i) => s + i.value, 0) || 1;
  let offset = 0;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }} role="img">
      {items.map((i) => {
        const len = (i.value / total) * c;
        const el = (
          <circle
            key={i.label}
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={i.colour}
            strokeWidth={16}
            strokeDasharray={`${Math.max(0, len - 3)} ${c - len + 3}`}
            strokeDashoffset={-offset}
          >
            <title>{`${i.label}: ${i.value}`}</title>
          </circle>
        );
        offset += len;
        return el;
      })}
    </svg>
  );
}

export function Gauge({ percent, size = 180, colour = 'var(--ok)' }: { percent: number; size?: number; colour?: string }) {
  const r = size / 2 - 16;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }} role="img">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={14} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={colour}
        strokeWidth={14}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - percent / 100)}
      />
    </svg>
  );
}
