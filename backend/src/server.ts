import { createApp } from './app';
import { connectDb, disconnectDb } from './config/db';
import { env } from './config/env';
import { startSyncJob } from './jobs/sync.job';
import { closeAllStreams } from './modules/events/sse';
import { logger } from './utils/logger';

async function main() {
  await connectDb();

  const app = createApp();
  const server = app.listen(env.port, () => {
    logger.info(`API listening on ${env.appUrl} (${env.nodeEnv})`);
    if (env.openai.mock) {
      logger.warn(
        'AI is in mock mode — every draft comes from the keyword stub and will never auto-send. ' +
          'Set OPENAI_API_KEY (and OPENAI_BASE_URL for non-OpenAI providers) to use a real model.',
      );
    }
  });

  const job = startSyncJob();

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`${signal} received — shutting down`);

    job.stop();
    closeAllStreams();

    // Stop taking new work, let in-flight requests finish, then drop the DB.
    // The old version called server.close() without awaiting it and exited
    // immediately, cutting off any request that was mid-send.
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await disconnectDb();
    logger.info('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  // A rejected promise nobody handled is a bug, but it must not take a running
  // mail server down without a trace.
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', reason instanceof Error ? reason.message : reason);
  });
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception — shutting down', err.message);
    void shutdown('uncaughtException');
  });
}

main().catch((e) => {
  logger.error('Failed to start server', e instanceof Error ? e.message : e);
  process.exit(1);
});
