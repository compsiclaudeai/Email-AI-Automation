/**
 * Standalone connection test: `npm run imap:check`
 *
 * Reads IMAP_* / SMTP_* / MAIL_USER / MAIL_PASS straight from .env and proves
 * both legs work before the app is involved. Nothing is written to MongoDB.
 */
import { env } from '../config/env';
import { ImapProvider } from '../providers/imap.provider';

const user = process.env.MAIL_USER ?? '';
const password = process.env.MAIL_PASS ?? '';

function line(label: string, value: string) {
  console.log(`  ${label.padEnd(14)} ${value}`);
}

async function main() {
  if (!env.imap.host || !user || !password) {
    console.error('\nMissing settings. backend/.env needs at least:\n');
    console.error('  IMAP_HOST=sgp13.siteground.asia');
    console.error('  IMAP_PORT=993');
    console.error('  SMTP_HOST=sgp13.siteground.asia');
    console.error('  SMTP_PORT=465');
    console.error('  MAIL_USER=you@yourdomain.com');
    console.error('  MAIL_PASS=your_mailbox_password\n');
    process.exit(1);
  }

  console.log('\nChecking mailbox connection\n');
  line('IMAP', `${env.imap.host}:${env.imap.port} (secure: ${env.imap.secure})`);
  line('SMTP', `${env.imap.smtpHost}:${env.imap.smtpPort} (secure: ${env.imap.smtpSecure})`);
  line('User', user);
  console.log('');

  const provider = new ImapProvider({
    host: env.imap.host,
    port: env.imap.port,
    secure: env.imap.secure,
    smtpHost: env.imap.smtpHost,
    smtpPort: env.imap.smtpPort,
    smtpSecure: env.imap.smtpSecure,
    user,
    password,
    folder: env.imap.folder,
  });

  const { folders } = await provider.verify();
  console.log(`IMAP login OK — ${folders.length} folders on the server:`);
  for (const f of folders) console.log(`  · ${f}`);
  console.log('\nSMTP login OK — replies can be sent.\n');

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const messages = await provider.listRecentMessages({ since, limit: 5 });
  console.log(`Read test on "${env.imap.folder}" — ${messages.length} message(s) in the last 7 days`);
  for (const m of messages) {
    console.log(`  · ${m.receivedAt.toISOString().slice(0, 16)}  ${m.fromEmail}  ${m.subject.slice(0, 60)}`);
  }

  if (messages.length === 0) {
    console.log('\n  Nothing found. That is fine if the folder is genuinely empty —');
    console.log('  otherwise check IMAP_FOLDER matches a folder listed above exactly.');
  }
  console.log('\nAll good.\n');
}

main().catch((e) => {
  console.error('\nFAILED:', e instanceof Error ? e.message : e);
  console.error('\nCommon causes:');
  console.error('  · Wrong password — mailbox password, not your cPanel login');
  console.error('  · Port mismatch — 993 needs IMAP_SECURE=true, 143 needs false');
  console.error('  · SMTP port 465 needs SMTP_SECURE=true, 587 needs false');
  console.error('  · Host firewall blocking outbound 993/465 — try a mobile hotspot\n');
  process.exit(1);
});
