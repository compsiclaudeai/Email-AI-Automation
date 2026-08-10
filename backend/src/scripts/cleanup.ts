/**
 * `npx tsx src/scripts/cleanup.ts` — housekeeping after a config change.
 *
 * Two jobs:
 *   1. Clears drafts written by the keyword stub so the real model redraws them
 *      on the next run. Automation skips any email that already has a draft, so
 *      without this the stub replies stay forever.
 *   2. Removes accounts that never connected a mailbox.
 *
 * Pass --dry to see what would change without writing anything.
 * Pass --accounts to also remove the dead accounts (off by default).
 */
import mongoose from 'mongoose';
import { env } from '../config/env';
import { User } from '../models/user.model';
import { Email } from '../models/email.model';

const dry = process.argv.includes('--dry');
const doAccounts = process.argv.includes('--accounts');

async function main() {
  await mongoose.connect(env.mongoUri);
  console.log(`\n${dry ? 'DRY RUN — nothing will be written' : 'Applying changes'}\n`);

  /* ---------------------- stub drafts -> redraft ----------------------- */
  const stubQuery = { aiModel: { $regex: /^(stub|keyword-stub)/i } };
  const stubs = await Email.find(stubQuery).select('subject status aiModel').lean();

  console.log(`Drafts written by the keyword stub: ${stubs.length}`);
  for (const e of stubs.slice(0, 10)) {
    console.log(`  · [${e.status}] ${String(e.subject).slice(0, 56)}`);
  }
  if (stubs.length > 10) console.log(`  … and ${stubs.length - 10} more`);

  if (stubs.length && !dry) {
    // Already-sent replies are left alone — the mail has gone out, and
    // clearing the draft would only lose the record of what was sent.
    const result = await Email.updateMany(
      { ...stubQuery, status: { $ne: 'replied' } },
      {
        $unset: { aiReply: 1, aiGeneratedAt: 1, aiModel: 1, aiConfidence: 1, aiReason: 1 },
        $set: { status: 'pending' },
      },
    );
    console.log(`\n  Cleared ${result.modifiedCount} draft(s) — the model will redraw them.`);
    const kept = await Email.countDocuments({ ...stubQuery, status: 'replied' });
    if (kept) console.log(`  Left ${kept} already-sent repl(y/ies) untouched.`);
  }

  /* ------------------------- dead accounts ----------------------------- */
  const users = await User.find().select('+imapPassword +refreshToken');
  const dead = users.filter((u) => !u.refreshToken && !u.imapPassword);

  console.log(`\nAccounts with no working mailbox connection: ${dead.length}`);
  for (const u of dead) {
    const n = await Email.countDocuments({ userId: u._id });
    console.log(`  · ${u.email} [${u.provider}] — ${n} email(s)`);
  }

  if (dead.length && doAccounts && !dry) {
    for (const u of dead) {
      await Email.deleteMany({ userId: u._id });
      await User.deleteOne({ _id: u._id });
      console.log(`  Removed ${u.email}`);
    }
  } else if (dead.length) {
    console.log('  (Pass --accounts to remove these and their emails.)');
  }

  console.log('');
  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error('\nCleanup failed:', e instanceof Error ? e.message : e);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
