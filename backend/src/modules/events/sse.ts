import type { Response } from 'express';
import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';

type Client = { userId: string; res: Response; ping: NodeJS.Timeout };

const clients = new Set<Client>();

/** Ceiling per account, so one runaway tab cannot pin open unlimited streams. */
const MAX_STREAMS_PER_USER = 5;

/** Pushes a named event to every open stream belonging to one user. */
export function publish(userId: string, event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) {
    if (c.userId !== userId) continue;
    try {
      c.res.write(payload);
    } catch {
      // A socket that died between the close event and this write would
      // otherwise throw straight out of whatever business logic published.
      drop(c);
    }
  }
}

function drop(client: Client) {
  clearInterval(client.ping);
  clients.delete(client);
  try {
    client.res.end();
  } catch {
    /* already gone */
  }
}

/** Used on shutdown so open streams are closed rather than cut off. */
export function closeAllStreams(): void {
  for (const c of [...clients]) drop(c);
}

export const eventsRouter = Router();

/** Server-sent events: real-time inbox updates without a websocket dependency. */
eventsRouter.get('/stream', requireAuth, (req, res) => {
  const userId = req.userId!;

  const mine = [...clients].filter((c) => c.userId === userId);
  if (mine.length >= MAX_STREAMS_PER_USER) {
    // Drop the oldest rather than refusing the new one: the newest tab is the
    // one the person is actually looking at.
    drop(mine[0]);
  }

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  // Tells EventSource how long to wait before reconnecting after a drop.
  res.write('retry: 5000\n\n');
  res.write('event: ready\ndata: {"ok":true}\n\n');

  const ping = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      drop(client);
    }
  }, 25_000);

  const client: Client = { userId, res, ping };
  clients.add(client);

  const cleanup = () => drop(client);
  req.on('close', cleanup);
  req.on('error', cleanup);
  res.on('error', cleanup);
});

/** Exposed for the health check and tests. */
export const streamCount = () => clients.size;
