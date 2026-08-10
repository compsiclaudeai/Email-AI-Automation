# Frontend — Next.js 14 + TypeScript + Tailwind

```
src/
├── app/
│   ├── page.tsx           OAuth sign-in
│   ├── layout.tsx         fonts, providers
│   ├── globals.css        design tokens (light + dark)
│   └── (app)/
│       ├── layout.tsx     nav + rail + auth guard
│       ├── inbox/         KPIs, list, detail, automation panel
│       ├── analytics/     six charts
│       └── settings/      automation configuration
├── components/
│   ├── layout/            top nav, side rail
│   ├── inbox/             email list, email detail
│   ├── automation/        status, quick actions, suggestions, timeline
│   ├── charts/            hand-rolled SVG chart primitives
│   ├── ui/                avatar, status chip, toasts
│   ├── kpi-cards.tsx
│   └── providers.tsx      theme + toast + SWR context
└── lib/                   api client, types, hooks, formatters
```

## Design system

Every colour is a CSS variable in `globals.css`, mapped into Tailwind in
`tailwind.config.ts`. Dark mode swaps one attribute on `<html>` — there is no
second set of utility classes to maintain.

Tokens follow the brief: Inter, `#2563EB` primary, 8px spacing scale, 16px card
radius, soft shadows, 200ms transitions.

## Charts

No chart library. `components/charts/primitives.tsx` has `AreaChart`,
`LineChart`, `BarChart`, `Donut`, `Gauge` and `Sparkline` as plain SVG. They
read the same CSS variables, so they re-theme for free and add nothing to the
bundle.

## Data fetching

SWR against the Express API through the `/api/*` rewrite in `next.config.mjs`,
which keeps the session cookie first-party in development. `useLiveUpdates`
subscribes to the server-sent event stream and revalidates the affected keys
when mail arrives or a reply goes out.

## Scripts

```bash
npm run dev        # http://localhost:3000
npm run build      # production build (needs network for the Inter font)
npm start
npm run typecheck
npm run lint
```
