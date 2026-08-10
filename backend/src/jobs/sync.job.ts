import cron from 'node-cron';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { User } from '../models/user.model';
import { runAutomation, syncMailbox } from '../modules/automation/automation.service';

/** Set while a tick is in flight, so a slow sync cannot overlap the next tick. */
let tickRunning = false;
let stopped = false;

/**
 * Background loop: for every connected mailbox, pull new mail and then run the
 * automation over anything that still needs a draft.
 *
 * Mailboxes are processed one at a time. Running them in parallel looked
 * faster but meant one slow IMAP host held open connections while the rest of
 * the batch queued behind it anyway, and it multiplied the peak memory used by
 * attachment extraction.
 */
export function startSyncJob(): { stop: () => void } {
  if (!env.sync.enabled) {
    logger.warn('Background sync disabled (SYNC_ENABLED=false)');
    return { stop: () => undefined };
  }

  if (!cron.validate(env.sync.cron)) {
    logger.error(`SYNC_CRON is not a valid expression: "${env.sync.cron}" — background sync is off`);
    return { stop: () => undefined };
  }

  const task = cron.schedule(env.sync.cron, async () => {
    if (stopped) return;
    if (tickRunning) {
      logger.warn('Previous sync tick is still running — skipping this one');
      return;
    }
    tickRunning = true;

    try {
      // OAuth mailboxes are connected once a refresh token is stored; IMAP ones
      // once a password is. Either counts as connected. A paused account is
      // still synced (so the inbox stays current) but never auto-replies —
      // that decision belongs to the gate, not to this query.
      const users = await User.find({
        $or: [{ refreshToken: { $exists: true } }, { imapPassword: { $exists: true } }],
      })
        .select('_id email')
        .lean();

      if (users.length) logger.info(`Sync tick — ${users.length} connected mailbox(es)`);

      for (const u of users) {
        if (stopped) break;
        const id = u._id.toString();
        try {
          const synced = await syncMailbox(id);
          if (synced.created > 0) await runAutomation(id);
        } catch (e) {
          // One broken mailbox must never stop the others.
          logger.error(
            `Sync failed for account ${id}: ${e instanceof Error ? e.message : 'unknown error'}`,
          );
        }
      }
    } catch (e) {
      logger.error('Sync tick failed', e instanceof Error ? e.message : e);
    } finally {
      tickRunning = false;
    }
  });

  logger.info(`Background sync scheduled: ${env.sync.cron}`);

  return {
    stop: () => {
      stopped = true;
      task.stop();
    },
  };
}
