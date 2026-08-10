'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowRight, Check, Loader2, Lock, Mail, Send, Server, ShieldX, Sparkles, Zap } from 'lucide-react';
import { ApiError, connectImap, oauthUrl } from '@/lib/api';
import { useMe } from '@/lib/hooks';

const PIPELINE = [
  { Icon: Mail, colour: 'var(--text-2)', bg: 'var(--surface-3)', title: 'Email arrives', detail: 'Warranty claim from a customer', time: '09:15' },
  { Icon: Sparkles, colour: '#7C3AED', bg: 'var(--violet-soft)', title: 'AI drafts the reply', detail: 'Matched to a template · 94% confidence', time: '09:16' },
  { Icon: Check, colour: 'var(--warn)', bg: 'var(--amber-soft)', title: 'You approve', detail: 'One keystroke, or fully automatic', time: '09:17' },
  { Icon: Send, colour: 'var(--ok)', bg: 'var(--green-soft)', title: 'Sent and logged', detail: 'Delivered · activity recorded', time: '09:18' },
];

export default function SignInPage() {
  return (
    <Suspense fallback={<div className="grid min-h-screen place-items-center" />}>
      <SignIn />
    </Suspense>
  );
}

function SignIn() {
  const router = useRouter();
  const params = useSearchParams();
  const { data: me, isLoading } = useMe();
  const [busy, setBusy] = useState<string | null>(null);
  const [showImap, setShowImap] = useState(false);

  // The OAuth callback redirects back here with ?error=... on failure. Nothing
  // ever read it, so a rejected consent screen looked like nothing happened.
  const oauthError = params.get('error');

  useEffect(() => {
    // Only follow a session that this page actually fetched — a cached hit from
    // before a sign out would send us to /inbox, which bounces straight back.
    if (me?.connected && !isLoading) router.replace('/inbox');
  }, [me, isLoading, router]);

  function connect(provider: 'google' | 'microsoft') {
    setBusy(provider);
    window.location.href = oauthUrl(provider);
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-2 bg-surface">
      <section className="flex flex-col justify-between p-8 lg:p-12">
        <div className="flex items-center gap-2.5">
          <span className="grid place-items-center w-8 h-8 rounded-[9px] bg-brand shadow-[0_2px_8px_rgba(37,99,235,.35)]">
            <Zap size={17} className="text-white" strokeWidth={2.1} />
          </span>
          <span className="text-[14.5px] font-semibold tracking-[-0.02em]">Email Automation</span>
        </div>

        <div className="w-full max-w-[392px] my-auto">
          <h1 className="text-[31px] font-bold tracking-[-0.035em] leading-[1.15] mb-2.5">
            Put your inbox on autopilot.
          </h1>
          <p className="text-ink-2 text-[14.5px] mb-8">
            Connect your work mailbox and let AI draft, route and send replies — with you approving
            anything it is not sure about.
          </p>

          {oauthError && (
            <div
              role="alert"
              className="flex gap-2.5 mb-4 p-3.5 rounded-xl bg-danger-soft border border-danger/30
                         text-[12.5px] text-ink-2 leading-relaxed"
            >
              <ShieldX size={16} className="text-danger mt-0.5 shrink-0" strokeWidth={1.9} />
              <p>
                <strong className="text-danger">Sign-in did not complete.</strong> {oauthError}
              </p>
            </div>
          )}

          <OAuthButton
            label="Continue with Google"
            busy={busy === 'google'}
            onClick={() => connect('google')}
            logo={<GoogleMark />}
          />
          <OAuthButton
            label="Continue with Microsoft Outlook"
            busy={busy === 'microsoft'}
            onClick={() => connect('microsoft')}
            logo={<MicrosoftMark />}
          />

          <div className="flex items-center gap-3 my-5">
            <span className="h-px flex-1 bg-line" />
            <span className="text-[11.5px] uppercase tracking-wider text-ink-3">or</span>
            <span className="h-px flex-1 bg-line" />
          </div>

          {showImap ? (
            <ImapForm
              onCancel={() => setShowImap(false)}
              onDone={() => {
                window.location.href = '/inbox';
              }}
            />
          ) : (
            <OAuthButton
              label="Connect any mailbox (IMAP)"
              busy={false}
              onClick={() => setShowImap(true)}
              logo={<Server size={19} className="text-ink-2" strokeWidth={1.9} />}
            />
          )}

          <p className="mt-5 text-[13px] text-ink-2 leading-relaxed">
            Securely connect your email account to automate replies and manage your inbox.
          </p>

          <div className="flex gap-2.5 mt-6 p-3.5 rounded-xl bg-surface-2 border border-line text-[12.5px] text-ink-2 leading-relaxed">
            <Lock size={16} className="text-ok mt-0.5 shrink-0" strokeWidth={1.8} />
            <p>
              {showImap
                ? 'IMAP needs your mailbox password. It is encrypted with AES-256 before it is stored and is never sent back to the browser.'
                : 'Sign-in happens on your provider\u2019s page. We never see or store your password, and you can revoke access from your account settings at any time.'}
            </p>
          </div>
        </div>

        <p className="text-xs text-ink-3">
          Read-only until you grant send access · Tokens encrypted at rest · Data stays in your region
        </p>
      </section>

      <section className="relative hidden lg:grid place-items-center overflow-hidden bg-surface-2 border-l border-line p-12">
        <div
          className="absolute inset-0 opacity-50"
          style={{
            backgroundImage:
              'linear-gradient(var(--line) 1px, transparent 1px), linear-gradient(90deg, var(--line) 1px, transparent 1px)',
            backgroundSize: '32px 32px',
            maskImage: 'radial-gradient(ellipse 80% 70% at 50% 45%, #000, transparent)',
            WebkitMaskImage: 'radial-gradient(ellipse 80% 70% at 50% 45%, #000, transparent)',
          }}
        />
        <div className="relative w-full max-w-[400px] flex flex-col gap-3">
          {PIPELINE.map((s, i) => (
            <div
              key={s.title}
              className="flex items-center gap-3.5 p-4 rounded-2xl bg-surface border border-line shadow-e2 animate-fade"
              style={{ animationDelay: `${i * 120}ms`, animationFillMode: 'backwards' }}
            >
              <span
                className="grid place-items-center w-[34px] h-[34px] rounded-[10px] shrink-0"
                style={{ background: s.bg, color: s.colour }}
              >
                <s.Icon size={16} strokeWidth={2} />
              </span>
              <div className="min-w-0">
                <div className="text-[13.5px] font-semibold tracking-[-0.01em]">{s.title}</div>
                <div className="text-xs text-ink-3 mt-px">{s.detail}</div>
              </div>
              <span className="ml-auto text-[11.5px] text-ink-3 font-mono">{s.time}</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

function OAuthButton({
  label,
  logo,
  busy,
  onClick,
}: {
  label: string;
  logo: React.ReactNode;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="group flex items-center gap-3 w-full h-[52px] px-4.5 mt-3 first:mt-0
                 border border-line-strong rounded-xl bg-surface text-[14.5px] font-medium
                 tracking-[-0.01em] transition hover:border-brand-border hover:bg-surface-2
                 hover:shadow-e2 hover:-translate-y-px disabled:opacity-60 disabled:pointer-events-none"
      style={{ paddingLeft: 18, paddingRight: 18 }}
    >
      {logo}
      <span>{busy ? 'Opening sign-in…' : label}</span>
      <ArrowRight
        size={16}
        className="ml-auto text-ink-3 transition group-hover:translate-x-1 group-hover:text-brand"
      />
    </button>
  );
}

function GoogleMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

function MicrosoftMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 23 23" aria-hidden>
      <path fill="#f25022" d="M1 1h10v10H1z" />
      <path fill="#7fba00" d="M12 1h10v10H12z" />
      <path fill="#00a4ef" d="M1 12h10v10H1z" />
      <path fill="#ffb900" d="M12 12h10v10H12z" />
    </svg>
  );
}

/* ----------------------------- IMAP form ------------------------------- */

const FIELD =
  'w-full h-[42px] px-3 rounded-lg bg-surface border border-line-strong text-[13.5px] ' +
  'outline-none transition focus:border-brand-border focus:ring-2 focus:ring-[var(--blue-200)]';

function ImapForm({ onCancel, onDone }: { onCancel: () => void; onDone: () => void }) {
  const [form, setForm] = useState({
    email: '',
    password: '',
    imapHost: '',
    imapPort: 993,
    smtpHost: '',
    smtpPort: 465,
    folder: 'INBOX',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  // The server name is the same for both legs on almost every shared host,
  // so mirroring it saves the user a step while staying overridable.
  function onImapHostChange(value: string) {
    setForm((f) => ({
      ...f,
      imapHost: value,
      smtpHost: f.smtpHost === f.imapHost || !f.smtpHost ? value : f.smtpHost,
    }));
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await connectImap({
        ...form,
        smtpHost: form.smtpHost || form.imapHost,
        imapSecure: Number(form.imapPort) === 993,
        smtpSecure: Number(form.smtpPort) === 465,
      });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not connect to the mailbox.');
    } finally {
      setBusy(false);
    }
  }

  const ready = Boolean(form.email && form.password && form.imapHost);

  return (
    <div className="p-4 rounded-xl border border-line-strong bg-surface-2 animate-fade">
      <div className="flex items-center gap-2 mb-3.5">
        <Server size={15} className="text-ink-2" strokeWidth={1.9} />
        <span className="text-[13.5px] font-semibold tracking-[-0.01em]">Connect over IMAP</span>
        <button
          onClick={onCancel}
          className="ml-auto text-[12.5px] text-ink-3 hover:text-ink transition"
        >
          Back
        </button>
      </div>

      {/* A real form, so Enter submits and password managers recognise it.
          It used to be loose inputs with a click-only button. */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy && ready) void submit();
        }}
      >
        <div className="grid gap-2.5">
          <Field label="Email address" htmlFor="imap-email">
            <input
              id="imap-email"
              className={FIELD}
              type="email"
              required
              placeholder="you@yourdomain.com"
              autoComplete="username"
              value={form.email}
              onChange={(e) => set('email', e.target.value)}
            />
          </Field>
          <Field label="Mailbox password" htmlFor="imap-password">
            <input
              id="imap-password"
              className={FIELD}
              type="password"
              required
              placeholder="Mailbox password"
              autoComplete="current-password"
              value={form.password}
              onChange={(e) => set('password', e.target.value)}
            />
          </Field>
          <div className="grid grid-cols-[1fr_88px] gap-2.5">
            <Field label="IMAP server" htmlFor="imap-host">
              <input
                id="imap-host"
                className={FIELD}
                required
                placeholder="mail.yourdomain.com"
                value={form.imapHost}
                onChange={(e) => onImapHostChange(e.target.value)}
              />
            </Field>
            <Field label="Port" htmlFor="imap-port">
              <input
                id="imap-port"
                className={FIELD}
                type="number"
                min={1}
                max={65535}
                value={form.imapPort}
                onChange={(e) => set('imapPort', Number(e.target.value))}
              />
            </Field>
          </div>
          <div className="grid grid-cols-[1fr_88px] gap-2.5">
            <Field label="SMTP server" htmlFor="smtp-host">
              <input
                id="smtp-host"
                className={FIELD}
                placeholder="mail.yourdomain.com"
                value={form.smtpHost}
                onChange={(e) => set('smtpHost', e.target.value)}
              />
            </Field>
            <Field label="Port" htmlFor="smtp-port">
              <input
                id="smtp-port"
                className={FIELD}
                type="number"
                min={1}
                max={65535}
                value={form.smtpPort}
                onChange={(e) => set('smtpPort', Number(e.target.value))}
              />
            </Field>
          </div>
          <Field label="Folder to watch" htmlFor="imap-folder">
            <input
              id="imap-folder"
              className={FIELD}
              placeholder="INBOX"
              value={form.folder}
              onChange={(e) => set('folder', e.target.value)}
            />
          </Field>
        </div>

        {error && (
          <p role="alert" className="mt-3 text-[12.5px] text-danger leading-relaxed break-words">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy || !ready}
          className="flex items-center justify-center gap-2 w-full h-[44px] mt-3.5 rounded-lg
                     bg-brand text-white text-[14px] font-medium tracking-[-0.01em] transition
                     hover:brightness-110 disabled:opacity-50 disabled:pointer-events-none"
        >
          {busy && <Loader2 size={15} className="animate-spin" />}
          {busy ? 'Testing the connection\u2026' : 'Connect mailbox'}
        </button>
      </form>

      <p className="mt-2.5 text-[11.5px] text-ink-3 leading-relaxed">
        Ports: 993 for IMAP over SSL, 465 for SMTP over SSL. Your host&apos;s webmail settings page
        lists both.
      </p>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={htmlFor} className="block text-[11.5px] font-medium text-ink-2 mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}
