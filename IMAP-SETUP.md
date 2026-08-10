# IMAP Setup — SiteGround / cPanel mailboxes

Ab teesra provider add ho gaya hai: **IMAP + SMTP**. Ye un mailboxes ke liye hai
jinpe OAuth nahi hota — SiteGround, cPanel, Zoho, self-hosted waghera. Koi Azure
tenant, koi app registration, koi admin consent nahi chahiye.

Google aur Microsoft wale rastay waise hi kaam kar rahe hain, kuch toota nahi.

---

## 1. Install

```
cd backend
npm install
```

Teen naye packages aaye hain: `imapflow`, `mailparser`, `nodemailer`.

## 2. Connection test (app se pehle)

`backend/.env` ke aakhir mein ye add karein:

```
IMAP_HOST=sgp13.siteground.asia
IMAP_PORT=993
IMAP_SECURE=true
SMTP_HOST=sgp13.siteground.asia
SMTP_PORT=465
SMTP_SECURE=true
IMAP_FOLDER=INBOX
MAIL_USER=aapka.email@compsi.com
MAIL_PASS=mailbox_ka_password
```

Phir:

```
npm run imap:check
```

Ye script IMAP aur SMTP dono legs test karti hai, server ke saare folders list
karti hai, aur pichle 7 din ke 5 emails parh kar dikhati hai. MongoDB ko haath
nahi lagati.

Agar ye pass ho gaya to app definitely chalegi.

## 3. App mein sign in

Backend aur frontend dono chalayein:

```
cd backend  && npm run dev
cd frontend && npm run dev
```

`http://localhost:3000` kholein. Google/Microsoft buttons ke neeche ab
**"Connect any mailbox (IMAP)"** ka option hai. Us pe click karein aur form
bharein:

| Field | Value |
|---|---|
| Email | aapka.email@compsi.com |
| Password | mailbox ka password (cPanel login nahi) |
| IMAP server | sgp13.siteground.asia |
| IMAP port | 993 |
| SMTP server | khud bhar jayega |
| SMTP port | 465 |
| Folder | INBOX (ya jo folder watch karna hai) |

Connect dabate hi credentials pehle server pe verify hoti hain — ghalat hon to
form pe asli error message dikhega, aur database mein kuch save nahi hoga.

Sahi hon to seedha `/inbox` pe pahunch jayenge.

---

## Kya kya bana

**`backend/src/providers/imap.provider.ts`** — poora provider. Wahi teen methods
jo Gmail/Graph implement karte hain (`listRecentMessages`, `sendReply`,
`markAsRead`), to sync job, AI drafting, dashboard, activity log — sab pehle se
kaam kar rahe hain, unme ek line nahi badli.

Kuch cheezein jo dhyan se ki gayi hain:

- **`externalId` = `uidValidity.uid`.** IMAP UIDs sirf ek folder ke andar unique
  hote hain, aur server rebuild pe reset ho jate hain. Dono ko pin karne se
  purane emails ghalat message pe point nahi karte.
- **Reply threading.** Bhejne se pehle original ka `Message-ID` nikala jata hai
  aur `In-Reply-To` + `References` headers set hote hain, warna customer ke
  inbox mein reply nayi conversation ban kar aati.
- **Sent folder.** Reply bhejne ke baad copy Sent mein file hoti hai taake
  webmail/Outlook mein nazar aaye. Har host isko alag naam deta hai
  (`INBOX.Sent`, `Sent`, `Sent Items`), to sab try hote hain. Ye best-effort
  hai — email pehle hi deliver ho chuki hoti hai.
- **TLS.** `rejectUnauthorized: false` set hai. Shared hosting pe certificate
  aksar server hostname (`sgp13.siteground.asia`) ka hota hai, mail domain ka
  nahi — ye normal hai.

**Baqi changes:**

- `user.model.ts` — `provider` enum mein `imap`, plus `imap` config sub-document
  aur `imapPassword` (AES-256-GCM encrypted, `select: false`, API kabhi return
  nahi karti)
- `providers/index.ts` — IMAP users OAuth token path se nahi guzarte
- `auth.routes.ts` — `POST /api/auth/imap` (verify → save → cookie),
  `GET /api/auth/imap/folders`, `GET /api/auth/imap/defaults`
- `sync.job.ts` — connected mailbox ki definition ab "refresh token **ya** IMAP
  password" hai; pehle sirf refresh token thi, to IMAP accounts skip ho jate
- `auth.service.ts` — disconnect ab `imapPassword` bhi clear karta hai
- Frontend `page.tsx` — IMAP connect form
- `npm run imap:check` — standalone diagnostic

---

## Agar kuch atke

**"Invalid credentials" / login fail** — mailbox ka password chahiye, cPanel
account ka nahi. cPanel → Email Accounts → us address ke saamne "Manage" →
password reset kar ke wahi use karein.

**"Connection timeout"** — office firewall outbound 993/465 block kar raha ho
sakta hai. Mobile hotspot pe `npm run imap:check` chala kar confirm karein.

**Emails khali aa rahe hain** — `IMAP_FOLDER` ka naam bilkul exact hona chahiye.
`imap:check` jo folder list deta hai usme se copy karein. SiteGround pe
sub-folders `INBOX.FolderName` format mein hote hain, sirf `FolderName` nahi.

**SMTP fail, IMAP theek** — port 465 ke saath `SMTP_SECURE=true`, ya port 587 ke
saath `false`. Dono mix karne se fail hota hai.

---

## Ab bhi pending

Ye pehle se khuli hui cheezein hain, IMAP se related nahi:

1. **MongoDB password rotate karein** — chat mein aa gaya tha. Atlas → Database
   Access → Edit Password.
2. **Google client secret rotate karein** — live secret `backend/.env.example`
   mein commit hai. Repo public hone se pehle zaroori.
3. **AI provider** — abhi `AI_MOCK` pe hai. OpenAI, NVIDIA NIM
   (`OPENAI_BASE_URL=https://integrate.api.nvidia.com/v1`), ya Gemini — jo
   chunein.
4. **Job Card Register write-back** — abhi wire nahi hua.
