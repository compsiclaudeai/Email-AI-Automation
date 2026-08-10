# Deploying free, with no credit card

Three services, all free, none of which ask for a card:

| Piece | Where | Free allowance |
|---|---|---|
| Backend API + cron | Render | 512 MB RAM, 750 instance hours/month |
| Database | MongoDB Atlas (M0) | 512 MB storage, no expiry |
| Frontend | Vercel Hobby | Plenty for this app |
| Keep-alive ping | cron-job.org | Unlimited 10-minute jobs |

Total: about 20 minutes.

---

## The one thing that breaks this app on a free tier

A Render free web service **spins down after 15 minutes without traffic**, and
a spun-down service runs no cron.

This app syncs mailboxes on an internal 5-minute cron. If the service sleeps,
**syncing and automation stop entirely** — this is not "the first request is
slow", it is the feature not running.

Step 6 fixes it. Do not skip it.

---

## 1. Database — MongoDB Atlas

1. Sign up at `cloud.mongodb.com`. No card.
2. **Build a Database → Free (M0)**. Any provider; pick a region near you.
3. **Database Access → Add New Database User.** Username and password, note
   both. Avoid `@ : / ?` in the password, or it has to be URL-encoded.
4. **Network Access → Add IP Address → Allow access from anywhere
   (`0.0.0.0/0`).**
   This is required, not laziness: Render's free tier has no fixed outbound IP,
   so there is nothing narrower to allowlist. Your database is still protected
   by the username and password.
5. **Connect → Drivers** and copy the string. It looks like:

   ```
   mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/email_automation?retryWrites=true&w=majority
   ```

   Replace `USER` and `PASSWORD`, and make sure `/email_automation` is in
   there before the `?` — without a database name everything lands in `test`.

---

## 2. Generate the two secrets

```bash
openssl rand -hex 32   # JWT_SECRET
openssl rand -hex 32   # TOKEN_ENCRYPTION_KEY
```

Save both somewhere you will not lose them.

**`TOKEN_ENCRYPTION_KEY` must never change once a mailbox is connected.** It
encrypts stored mailbox passwords and OAuth refresh tokens. Change it and every
stored credential becomes unreadable — every account has to reconnect, and
until then nothing sends. The app detects this and says so, but the only fixes
are restoring the old key or reconnecting.

The server refuses to start in production if either value is missing or still
on its development default. That is deliberate: a default JWT secret lets
anyone mint a session for any account.

---

## 3. Backend — Render

1. Push this repository to GitHub.
2. Sign up at `render.com` with GitHub. No card for the free tier.
3. **New → Blueprint**, pick the repository. Render reads `render.yaml`.
4. It prompts for the values marked `sync: false`. Fill in:

   | Variable | Value |
   |---|---|
   | `MONGODB_URI` | the Atlas string from step 1 |
   | `JWT_SECRET` | first `openssl` value |
   | `TOKEN_ENCRYPTION_KEY` | second `openssl` value |
   | `APP_URL` | leave blank for now, filled in step 5 |
   | `WEB_URL` | leave blank for now, filled in step 5 |
   | `CORS_ORIGINS` | leave blank for now, filled in step 5 |
   | `OPENAI_API_KEY` | your OpenRouter key |
   | `OPENAI_BASE_URL` | `https://openrouter.ai/api/v1` |
   | `OPENAI_MODEL` | a model that answers — see below |

5. Deploy. When it finishes you have a URL like
   `https://ai-email-automation-api.onrender.com`.
6. Open `https://<that URL>/health`. You should get
   `{"ok":true,...}`. If you do, the API and the database are both fine.

### Checking the AI actually works

Free models on OpenRouter come and go. After deploying, open a message in the
app: if every draft is the same generic template starting "Thank you for your
email regarding", the model is not being reached. Render's **Logs** tab shows
the exact reason on the line beginning `AI draft FAILED` — status, provider
message, and the endpoint it tried. Change `OPENAI_MODEL` and redeploy.

---

## 4. Frontend — Netlify

`netlify.toml` in the repository root already sets the base directory, the
build command, the Next runtime plugin, Node 20 and the security headers.

1. Sign up at `netlify.com` with GitHub. No card.
2. **Add new site → Import an existing project**, same repository. Netlify
   reads `netlify.toml`, so leave the build settings alone.
3. Environment variable:

   ```
   NEXT_PUBLIC_API_URL = https://ai-email-automation-api.onrender.com
   ```

4. Deploy. You get `https://your-site.netlify.app`.

The frontend proxies `/api` to the backend, so every API call is same-origin
from the browser's point of view. That is what makes the session cookie work
across two different hosts.

---

## 5. Point the two at each other

Back in Render → your service → **Environment**, now fill in:

```
APP_URL      = https://ai-email-automation-api.onrender.com
WEB_URL      = https://your-site.netlify.app
CORS_ORIGINS = https://your-site.netlify.app
```

Save. Render redeploys.

If you use Google sign-in, also add the callback in Google Cloud Console →
Credentials → your OAuth client → Authorised redirect URIs:

```
https://ai-email-automation-api.onrender.com/api/auth/google/callback
```

and set `GOOGLE_CALLBACK_URL` in Render to the same string. They must match
exactly, including `https` and no trailing slash.

---

## 6. Keep it awake — the important step

1. Sign up at `cron-job.org`. Free, no card.
2. **Create cronjob:**
   - URL: `https://ai-email-automation-api.onrender.com/health`
   - Schedule: **every 10 minutes**
3. Save and enable.

Ten minutes is under Render's 15-minute idle window, so the service never
sleeps and the internal 5-minute sync keeps running.

**Stay on one free service.** 750 instance hours a month covers one always-on
service (730 hours). A second one running full-time exhausts the allowance and
both get suspended until the next month.

---

## 7. First run

1. Open your Vercel URL and connect a mailbox.
2. Click **Sync** in the inbox toolbar.
3. Click **Run automation**.
4. Open a message and check the draft is about that email — if every reply is
   the same generic template, the AI is not being reached. Render's Logs tab
   shows the exact reason.

Leave approval mode on **manual** until you have read a few dozen drafts. Real
customers receive these.

---

## Free-tier limits worth knowing

- **First request after a deploy is slow.** Cold start is 30–60 seconds. With
  the keep-alive running you rarely see it.
- **The filesystem is wiped on every restart.** Everything real is in MongoDB,
  so this is fine — but nothing may be written to disk and expected to survive.
- **Image OCR is off** (`ATTACHMENT_OCR=false` in `render.yaml`). 512 MB is not
  enough to OCR scans comfortably. Text-based PDFs are still read; only
  photographs and scans are skipped, and the AI is told plainly that an
  attachment could not be read rather than pretending it was.
- **512 MB Atlas storage.** Thousands of emails, but attachment *text* is
  stored on each message. If it fills up, lower
  `ATTACHMENT_MAX_CHARS`.
- **100 GB/month Render bandwidth.** Not a concern at this scale.

---

## When something goes wrong

| What you see | What it means |
|---|---|
| Render logs: `MongoDB unreachable after 6 attempts` | The message underneath names it: wrong password, hostname does not resolve, or Atlas Network Access is not `0.0.0.0/0`. |
| Server will not start, mentions `JWT_SECRET` | It is missing or still the dev default. Set both secrets from step 2. |
| Banner: "This mailbox needs reconnecting" | `TOKEN_ENCRYPTION_KEY` changed. Restore the old one, or reconnect the mailbox. |
| Every reply is the same generic template | The AI is not reachable. Render Logs shows `AI draft FAILED` with the status and provider message. |
| Automation stops overnight | The keep-alive ping is not running. Check step 6. |
| Sign-in redirects then fails | `GOOGLE_CALLBACK_URL` and the URI in Google Cloud Console do not match exactly. |
| Requests fail with a CORS error | `CORS_ORIGINS` does not exactly match your Vercel URL. |

---

## Deploying without the blueprint

If you would rather configure Render by hand:

- **Root Directory:** `backend`
- **Build Command:** `npm ci && npm run build`
- **Start Command:** `npm start`
- **Health Check Path:** `/health`
- **Instance Type:** Free

Then add every variable from `backend/.env.example`.
