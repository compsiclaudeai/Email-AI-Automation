import mongoose from 'mongoose';
import { env } from './env';
import { logger } from '../utils/logger';

/**
 * Connects to MongoDB, retrying before giving up.
 *
 * One attempt is enough on a laptop but not on free hosting: a cold-starting
 * container often reaches the network before DNS is ready, and a shared Atlas
 * cluster can take a few seconds to accept its first connection. Throwing on
 * the first failure exits the process, the platform restarts it, and the whole
 * thing becomes a crash loop caused by being a second too early.
 */
export async function connectDb(): Promise<void> {
  mongoose.set('strictQuery', true);

  const attempts = 6;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await mongoose.connect(env.mongoUri, {
        serverSelectionTimeoutMS: 10_000,
        // Free shared clusters cap connections; a small pool leaves headroom.
        maxPoolSize: 10,
        minPoolSize: 1,
      });
      logger.info(`MongoDB connected → ${mongoose.connection.name}`);
      break;
    } catch (e) {
      const message = e instanceof Error ? e.message : 'connection failed';

      if (attempt === attempts) {
        // The three misconfigurations that actually happen, named plainly.
        logger.error(`MongoDB unreachable after ${attempts} attempts: ${message}`);
        if (/authentication failed|bad auth/i.test(message)) {
          logger.error('  → The username or password in MONGODB_URI is wrong.');
        } else if (/ENOTFOUND|querySrv|getaddrinfo/i.test(message)) {
          logger.error('  → The cluster hostname in MONGODB_URI does not resolve.');
        } else {
          logger.error(
            '  → If this is Atlas, add 0.0.0.0/0 under Network Access. Hosts like Render have no fixed IP to allowlist.',
          );
        }
        throw e;
      }

      const wait = Math.min(15_000, 1000 * 2 ** (attempt - 1));
      logger.warn(`MongoDB attempt ${attempt}/${attempts} failed — retrying in ${wait / 1000}s`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }

  mongoose.connection.on('error', (e) =>
    logger.error('MongoDB error', e instanceof Error ? e.message : e),
  );
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected — reconnecting'));
  mongoose.connection.on('reconnected', () => logger.info('MongoDB reconnected'));
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
}
