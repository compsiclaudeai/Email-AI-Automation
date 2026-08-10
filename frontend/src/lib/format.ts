const AVATAR_COLOURS = ['#2563EB', '#7C3AED', '#0D9488', '#DB2777', '#D97706', '#0891B2', '#4F46E5', '#65A30D'];

/**
 * Splits on dots and underscores as well as spaces, because a sender with no
 * display name arrives as their local part ("hassan.siraj") and produced a
 * single-letter avatar for everyone whose address was shaped that way.
 */
export function initials(name: string): string {
  const parts = (name ?? '')
    .replace(/["<>]/g, '')
    .split(/[\s._\-+]+/)
    .filter(Boolean)
    .slice(0, 2);
  if (!parts.length) return '?';
  return parts.map((w) => w[0]).join('').toUpperCase();
}

export function avatarColour(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLOURS[h % AVATAR_COLOURS.length];
}

export function timeAgo(iso: string): string {
  const then = new Date(iso);
  const mins = Math.round((Date.now() - then.getTime()) / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;

  const today = new Date();
  const sameDay = then.toDateString() === today.toDateString();
  if (sameDay) return then.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

  const days = Math.round(mins / 1440);
  if (days === 1) return 'Yesterday';
  if (days < 7) return then.toLocaleDateString([], { weekday: 'short' });
  return then.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

export function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function confidenceColour(v: number): string {
  if (v >= 90) return 'var(--ok)';
  if (v >= 75) return '#2563EB';
  return 'var(--warn)';
}

export const CATEGORY_COLOURS: Record<string, string> = {
  invoice: '#0891B2',
  support: '#2563EB',
  hr: '#7C3AED',
  sales: '#16A34A',
  marketing: '#D97706',
  spam: '#8A93A0',
  other: '#64748B',
};

export const STATUS_LABEL: Record<string, { label: string; tone: string }> = {
  unread: { label: 'Unread', tone: 'brand' },
  pending: { label: 'Needs approval', tone: 'warn' },
  replied: { label: 'Auto replied', tone: 'ok' },
  failed: { label: 'Send failed', tone: 'danger' },
  ignored: { label: 'Filed, no reply', tone: 'muted' },
};
