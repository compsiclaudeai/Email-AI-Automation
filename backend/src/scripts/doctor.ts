/**
 * `npm run doctor` — reports why automation is not drafting or sending.
 *
 * Read-only: connects, counts, prints. Nothing is written or sent.
 */
import mongoose from 'mongoose';
import { env } from '../config/env';
import { User } from '../models/user.model';
import { Email } from '../models/email.model';
import { Template } from '../models/template.model';

const tick = (ok: boolean) => (ok ? 'OK  ' : 'STOP');

async function main() {
  await mongoose.connect(env.mongoUri);
  console.log('\n===== AI EMAIL AUTOMATION — DIAGNOSTIC =====\n');

  /* ---------------------------- AI provider ---------------------------- */
  const key = process.env.OPENAI_API_KEY ?? '';
  const usingRealAi = !env.openai.mock && key.length > 0;

  console.log('AI PROVIDER');
  console.log(`  ${tick(usingRealAi)} Mode: ${usingRealAi ? 'real model' : 'MOCK (keyword stub)'}`);
  console.log(`       AI_MOCK=${env.openai.mock}`);
  console.log(`       Key: ${key ? `set (${key.slice(0, 6)}…, ${key.length} chars)` : 'NOT SET'}`);
  console.log(`       Model: ${env.openai.model}`);
  console.log(`       Base URL: ${process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1 (default)'}`);
  if (!usingRealAi) {
    console.log('       → Replies are canned keyword templates, not written by a model.');
    console.log('       → Set OPENAI_API_KEY and AI_MOCK=false in backend/.env');
  }

  /* ------------------------------ accounts ----------------------------- */
  // Both credential fields are select:false, so they must be asked for
  // explicitly — otherwise every OAuth account reads as disconnected.
  const users = await User.find().select('+imapPassword +refreshToken');
  console.log(`\nACCOUNTS (${users.length})`);
  if (users.length === 0) {
    console.log('  STOP No user has connected a mailbox — sign in through the app first.');
  }

  for (const u of users) {
    const s = u.settings;
    const connected = Boolean(u.refreshToken || u.imapPassword);
    console.log(`\n  ${u.email}  [${u.provider}]`);
    console.log(`    ${tick(connected)} Mailbox connected`);
    console.log(`    ${tick(!s.paused)} Automation ${s.paused ? 'PAUSED — nothing will send' : 'active'}`);
    console.log(`    ${tick(s.autoReply)} Auto reply ${s.autoReply ? 'on' : 'OFF — every draft waits for you'}`);
    console.log(`         Approval mode: ${s.approvalMode}${s.approvalMode === 'manual' ? ' (nothing sends by itself)' : ''}`);
    console.log(`         Confidence threshold: ${s.confidenceThreshold}%`);
    console.log(`         Business hours: ${s.businessHoursEnabled ? `${s.businessHoursFrom}–${s.businessHoursTo} (outside these, replies queue)` : 'off'}`);
    console.log(`         Enabled categories: ${s.enabledCategories.join(', ') || 'NONE — every email is skipped'}`);
    console.log(`         Last sync: ${u.lastSyncAt ? u.lastSyncAt.toISOString() : 'never'}`);

    const id = u._id;
    const [stubDrafts, injectionHeld] = await Promise.all([
      Email.countDocuments({ userId: id, aiIsStub: true }),
      Email.countDocuments({ userId: id, aiInjectionSuspected: true }),
    ]);

    // The fingerprint of an AI outage: drafts written by the keyword stub.
    // If this is not zero while a real model is configured, those emails are
    // all carrying the same canned template and need `Rewrite stub drafts`.
    if (stubDrafts > 0) {
      console.log(
        `    ${tick(!usingRealAi)} ${stubDrafts} draft(s) came from the offline keyword stub` +
          (usingRealAi
            ? ' — a real model is configured now, so run "Rewrite stub drafts" in the app'
            : ''),
      );
    }
    if (injectionHeld > 0) {
      console.log(`         ${injectionHeld} email(s) held after a prompt-injection attempt`);
    }

    const [total, unread, pending, drafted, replied, ignored, failed] = await Promise.all([
      Email.countDocuments({ userId: id }),
      Email.countDocuments({ userId: id, status: 'unread' }),
      Email.countDocuments({ userId: id, status: 'pending' }),
      Email.countDocuments({ userId: id, aiReply: { $exists: true, $ne: '' } }),
      Email.countDocuments({ userId: id, status: 'replied' }),
      Email.countDocuments({ userId: id, status: 'ignored' }),
      Email.countDocuments({ userId: id, status: 'failed' }),
    ]);

    console.log(`\n    EMAILS: ${total} total`);
    console.log(`      unread ${unread} · pending ${pending} · drafted ${drafted} · replied ${replied} · ignored ${ignored} · failed ${failed}`);

    if (total === 0) {
      console.log('      → Nothing synced yet. Press "Sync now", or check IMAP_FOLDER matches a real folder.');
    } else if (unread + pending === 0) {
      console.log('      → No email is in unread/pending, so automation has nothing to work on.');
    } else if (drafted === 0) {
      console.log('      → Emails are waiting but none has a draft. Press "Run automation" and watch the log.');
    }

    const categories = await Email.aggregate<{ _id: string; n: number }>([
      { $match: { userId: id } },
      { $group: { _id: '$category', n: { $sum: 1 } } },
      { $sort: { n: -1 } },
    ]);
    if (categories.length) {
      console.log(`      categories: ${categories.map((c) => `${c._id ?? 'none'} ${c.n}`).join(' · ')}`);
      const off = categories.filter((c) => c._id && !s.enabledCategories.includes(c._id));
      if (off.length) {
        console.log(`      → These categories are switched off in Settings and get skipped: ${off.map((c) => c._id).join(', ')}`);
      }
    }

    const templates = await Template.countDocuments({ userId: id, active: true });
    console.log(`      active templates: ${templates}${templates === 0 ? ' (fine — the model works without them)' : ''}`);

    const sample = await Email.find({ userId: id })
      .sort({ receivedAt: -1 })
      .limit(3)
      .select('subject status category aiConfidence aiReason aiModel attachments')
      .lean();

    if (sample.length) {
      console.log('\n      Most recent:');
      for (const e of sample) {
        console.log(`        · ${e.subject?.slice(0, 48)}`);
        console.log(`            status=${e.status} category=${e.category ?? '—'} confidence=${e.aiConfidence ?? '—'}%`);
        if (e.aiModel) console.log(`            drafted by: ${e.aiModel}`);
        if (e.aiReason) console.log(`            reason: ${String(e.aiReason).slice(0, 90)}`);
        for (const a of e.attachments ?? []) {
          console.log(`            attachment: ${a.filename} → ${a.extractStatus ?? 'not processed'}${a.extractDetail ? ` (${a.extractDetail})` : ''}`);
        }
      }
    }
  }

  console.log('\n===========================================\n');
  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error('\nDiagnostic failed:', e instanceof Error ? e.message : e);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
