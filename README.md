# AI Email Automation

A full-stack email automation platform. It connects a Gmail or Microsoft 365
mailbox over OAuth, classifies incoming mail with an LLM, drafts a reply, and
either sends it automatically or holds it for your approval — depending on how
confident the model is and which safety rails you have switched on.

```
.
├── backend/     Node.js · Express · TypeScript · MongoDB · Gmail API · Graph API · OpenAI
└── frontend/    Next.js 14 (App Router) · React 18 · TypeScript · Tailwind CSS
```

## What it does

1. **Sync** — a cron job pulls new mail from Gmail or Microsoft Graph.
2. **Classify** — the LLM assigns a category, a priority, and a confidence score.
3. **Draft** — it writes a reply in your configured tone, starting from your templates.
4. **Gate** — the draft only sends itself if it clears *every* rule you set.
5. **Send** — approved replies go out through the same provider, threaded correctly.
6. **Learn** — every action is logged and surfaced in analytics.

### The gate is the important part

Nothing sends automatically unless all of these pass:

| Check | Where to change it |
|---|---|
| Automation not paused | Settings → Safety rails |
| Auto reply is on | Settings → Replies |
| Approval mode is `automatic` | Settings → Replies |
| Category is enabled | Settings → Categories |
| Confidence ≥ your threshold | Settings → Confidence threshold |
| Draft mentions no money | Settings → Safety rails |
| Draft touches no personal data | Settings → Safety rails |
| Inside business hours | Settings → Business hours |

The default configuration is `manual` approval — the safest starting point.
Read `backend/src/modules/automation/automation.service.ts` to see the logic.

## Quick start

Prerequisites: Node 18+, MongoDB 6+ (local or Atlas).

```bash
# 1. Backend
cd backend
cp .env.example .env          # then fill in the values below
npm install
npm run seed                  # optional: demo mailbox so the UI has data
npm run dev                   # http://localhost:4000

# 2. Frontend (second terminal)
cd frontend
cp .env.local.example .env.local
npm install
npm run dev                   # http://localhost:3000
```

Generate the two secrets your `.env` needs:

```bash
openssl rand -hex 32   # JWT_SECRET
openssl rand -hex 32   # TOKEN_ENCRYPTION_KEY
```

`TOKEN_ENCRYPTION_KEY` encrypts OAuth refresh tokens with AES-256-GCM before
they touch MongoDB. Losing it means every mailbox has to reconnect, so treat it
like a database password.

### Running it without API keys

Leave `OPENAI_API_KEY` empty (or set `AI_MOCK=true`) and the AI service falls
back to a deterministic keyword classifier. The whole pipeline — drafting,
gating, approval, analytics — runs end to end, so you can build the UI before
you have a billing account. It is a stub, not a model: use it for development
only.

## Provider setup

### Google (Gmail API)

1. [console.cloud.google.com](https://console.cloud.google.com) → new project.
2. Enable the **Gmail API**.
3. OAuth consent screen → External → add your address as a test user.
4. Credentials → OAuth client ID → Web application.
5. Authorised redirect URI: `http://localhost:4000/api/auth/google/callback`.
6. Copy the client ID and secret into `.env`.

Scopes requested: `gmail.readonly`, `gmail.send`, `gmail.modify`, plus profile.
Google only returns a refresh token on the *first* consent, so the code never
overwrites a stored one with a blank.

### Microsoft (Graph API)

1. [entra.microsoft.com](https://entra.microsoft.com) → App registrations → New.
2. Redirect URI (Web): `http://localhost:4000/api/auth/microsoft/callback`.
3. Certificates & secrets → New client secret.
4. API permissions → Microsoft Graph → Delegated: `Mail.Read`, `Mail.Send`,
   `Mail.ReadWrite`, `User.Read`, `offline_access`.
5. Copy the application (client) ID, secret and tenant ID into `.env`.

Use `MICROSOFT_TENANT_ID=common` for any account, or your tenant GUID to lock
sign-in to one organisation.

> **Note on folders.** `GraphProvider.listRecentMessages` accepts a `folder`
> argument. If an Outlook rule already routes client mail into a named folder,
> pass that folder name to `POST /api/automation/sync` and the automation will
> only ever look there.

## API

All routes sit under `/api` and require the `ea_session` cookie except the auth
handshake itself.

| Method | Route | Purpose |
|---|---|---|
| GET | `/auth/google` · `/auth/microsoft` | Start the OAuth flow |
| GET | `/auth/me` | Current account and settings |
| POST | `/auth/disconnect` · `/auth/logout` | Revoke tokens · end session |
| GET | `/emails` | List with `status`, `category`, `q`, `page`, `limit` |
| GET | `/emails/counts` | Per-status counts for the filter tabs |
| GET | `/emails/:id` | One email with its thread |
| POST | `/emails/:id/open` | Move `unread` → `pending` |
| PATCH | `/emails/:id/draft` | Save an edited draft |
| POST | `/emails/:id/regenerate` | Ask the model again |
| POST | `/emails/:id/approve` | Approve and send |
| POST | `/emails/:id/reject` | Send the draft back to the queue |
| POST | `/emails/retry-failed` | Retry every failed send |
| GET | `/automation/status` | Live counters for the right-hand panel |
| POST | `/automation/run` | Draft and send across the queue |
| POST | `/automation/sync` | Pull new mail now |
| POST | `/automation/pause` · `/resume` | Stop or restart sending |
| GET | `/automation/suggestions` | Grouped hints for the suggestions card |
| GET | `/analytics/kpis` · `/analytics/overview?days=14` | Dashboard data |
| GET | `/settings` · PATCH `/settings` | Automation configuration |
| GET/POST/PATCH/DELETE | `/settings/templates` | Reply templates |
| GET | `/activity?limit=8` | Recent activity timeline |
| GET | `/events/stream` | Server-sent events for live updates |

## Data model

- **User** — profile, provider, encrypted tokens, embedded automation settings.
- **Email** — the message, its thread, AI draft, confidence, status, delivery result.
- **Activity** — an append-only log that feeds the timeline.
- **Template** — approved reply skeletons passed to the model as context.

Indexes worth knowing: `{userId, externalId}` is unique (idempotent sync), and
there is a text index across subject, snippet and sender for search.

## Keyboard shortcuts

`/` search · `J`/`K` move through the list · `A` approve and send ·
`R` regenerate · `D` toggle dark mode

## Deployment notes

- Set `NODE_ENV=production`. Cookies switch to `secure` + `SameSite=None`, so
  the API must be served over HTTPS.
- Point `WEB_URL` at the deployed frontend; CORS and the OAuth redirect both
  read it.
- Update both callback URLs in the Google and Microsoft consoles to match the
  production domain.
- `npm run build && npm start` in each folder, or use the included
  `docker-compose.yml` for a one-command local stack.
- The frontend build fetches Inter from Google Fonts, so the build machine
  needs outbound network access.

## Known limits

- The sync job polls. For production volume, switch to Gmail `watch` +
  Pub/Sub and Graph change notifications; the provider interface is already
  shaped for it.
- Attachments are listed, not downloaded. The provider layer exposes the ids
  you need to fetch them.
- Single mailbox per user account. The schema is per-user, so multi-mailbox
  support means adding a `Mailbox` collection between `User` and `Email`.
