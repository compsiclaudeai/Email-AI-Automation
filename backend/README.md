# Backend — Express + TypeScript + MongoDB

```
src/
├── config/          env parsing, Mongo connection
├── models/          Mongoose schemas (User, Email, Activity, Template)
├── middleware/      auth guard, error handler
├── providers/       Gmail + Graph behind one MailProvider interface
├── modules/
│   ├── auth/        OAuth flows, JWT session, token refresh
│   ├── ai/          OpenAI drafting + prompts + offline stub
│   ├── emails/      list, draft, approve, send, retry
│   ├── automation/  the gate, the run loop, mailbox sync
│   ├── analytics/   aggregation pipelines for the dashboard
│   ├── settings/    automation config + templates
│   ├── activity/    append-only event log
│   └── events/      server-sent events for live updates
├── jobs/            cron sync
├── app.ts           express wiring
├── server.ts        entry point
└── seed.ts          demo data
```

## Scripts

```bash
npm run dev        # tsx watch
npm run build      # tsc → dist/
npm start          # node dist/server.js
npm run typecheck  # tsc --noEmit
npm run seed       # demo mailbox
```

## Adding a third provider

Implement `MailProvider` from `src/providers/provider.types.ts` — three methods:
`listRecentMessages`, `sendReply`, `markAsRead` — then add a branch to
`providerFor()` in `src/providers/index.ts`. Nothing above that layer changes.

## Security notes

- Refresh tokens are AES-256-GCM encrypted (`utils/crypto.ts`) and excluded
  from queries by default (`select: false`).
- The session is an httpOnly JWT cookie; a bearer header also works for
  non-browser clients.
- OAuth state is a random nonce stored in a short-lived cookie and compared on
  callback, which blocks CSRF on the consent redirect.
- `helmet`, `cors` locked to `WEB_URL`, and a 300 req/min rate limit are on by
  default.
