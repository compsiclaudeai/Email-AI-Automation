type Level = 'info' | 'warn' | 'error' | 'debug';

function write(level: Level, msg: string, meta?: unknown) {
  const line = `${new Date().toISOString()} [${level.toUpperCase()}] ${msg}`;
  if (level === 'error') console.error(line, meta ?? '');
  else if (level === 'warn') console.warn(line, meta ?? '');
  else console.log(line, meta ?? '');
}

export const logger = {
  info: (m: string, meta?: unknown) => write('info', m, meta),
  warn: (m: string, meta?: unknown) => write('warn', m, meta),
  error: (m: string, meta?: unknown) => write('error', m, meta),
  debug: (m: string, meta?: unknown) => {
    if (process.env.NODE_ENV !== 'production') write('debug', m, meta);
  },
};
