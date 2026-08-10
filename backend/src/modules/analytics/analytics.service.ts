import { Types } from 'mongoose';
import { Email } from '../../models/email.model';

const DAY = 24 * 60 * 60 * 1000;

function dayKeys(days: number): string[] {
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    out.push(new Date(Date.now() - i * DAY).toISOString().slice(0, 10));
  }
  return out;
}

/** Fills gaps so charts always get a continuous series. */
function series(rows: { _id: string; n: number }[], days: number) {
  const map = new Map(rows.map((r) => [r._id, r.n]));
  return dayKeys(days).map((d) => ({ date: d, value: map.get(d) ?? 0 }));
}

export async function overview(userId: string, days = 14) {
  const uid = new Types.ObjectId(userId);
  const from = new Date(Date.now() - days * DAY);
  const prevFrom = new Date(Date.now() - days * 2 * DAY);

  const [received, autoReplied, pending, responseTime, categories, statusRows, prevTotal] =
    await Promise.all([
      Email.aggregate<{ _id: string; n: number }>([
        { $match: { userId: uid, receivedAt: { $gte: from } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$receivedAt' } }, n: { $sum: 1 } } },
      ]),
      Email.aggregate<{ _id: string; n: number }>([
        { $match: { userId: uid, status: 'replied', sentAt: { $gte: from } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$sentAt' } }, n: { $sum: 1 } } },
      ]),
      Email.aggregate<{ _id: string; n: number }>([
        { $match: { userId: uid, status: 'pending', receivedAt: { $gte: from } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$receivedAt' } }, n: { $sum: 1 } } },
      ]),
      Email.aggregate<{ _id: string; ms: number }>([
        { $match: { userId: uid, responseTimeMs: { $ne: null }, sentAt: { $gte: from } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$sentAt' } },
            ms: { $avg: '$responseTimeMs' },
          },
        },
      ]),
      Email.aggregate<{ _id: string; n: number }>([
        { $match: { userId: uid, receivedAt: { $gte: from } } },
        { $group: { _id: '$category', n: { $sum: 1 } } },
        { $sort: { n: -1 } },
      ]),
      Email.aggregate<{ _id: string; n: number }>([
        { $match: { userId: uid } },
        { $group: { _id: '$status', n: { $sum: 1 } } },
      ]),
      Email.countDocuments({ userId: uid, receivedAt: { $gte: prevFrom, $lt: from } }),
    ]);

  const status = Object.fromEntries(statusRows.map((r) => [r._id, r.n])) as Record<string, number>;
  const replied = status.replied ?? 0;
  const failed = status.failed ?? 0;
  const totalReceived = received.reduce((s, r) => s + r.n, 0);

  return {
    range: { days, from, to: new Date() },
    received: series(received, days),
    autoReplied: series(autoReplied, days),
    pending: series(pending, days),
    responseTimeSeconds: series(
      responseTime.map((r) => ({ _id: r._id, n: Math.round(r.ms / 1000) })),
      days,
    ),
    categories: categories.map((c) => ({ category: c._id, count: c.n })),
    totals: {
      received: totalReceived,
      autoReplied: autoReplied.reduce((s, r) => s + r.n, 0),
      previousPeriodReceived: prevTotal,
      changePercent: prevTotal ? Math.round(((totalReceived - prevTotal) / prevTotal) * 100) : 0,
    },
    delivery: {
      delivered: replied,
      failed,
      successRate: replied + failed ? Math.round((replied / (replied + failed)) * 100) : 100,
    },
  };
}

/**
 * The five KPI cards at the top of the dashboard.
 *
 * Each card gets its own sparkline. Every card used to be handed the *same*
 * `trend` array — the daily received count — so the "Failed replies" card drew
 * the shape of incoming mail and the numbers underneath it disagreed with the
 * line above them. Same class of bug as the generic reply: one value rendered
 * for five different questions.
 */
export async function kpis(userId: string) {
  const uid = new Types.ObjectId(userId);
  const weekAgo = new Date(Date.now() - 7 * DAY);
  const twoWeeks = new Date(Date.now() - 14 * DAY);

  const [total, unread, pending, replied, failed, thisWeek, lastWeek, byStatus, receivedDaily] =
    await Promise.all([
      Email.countDocuments({ userId: uid }),
      Email.countDocuments({ userId: uid, status: 'unread' }),
      Email.countDocuments({ userId: uid, status: 'pending' }),
      Email.countDocuments({ userId: uid, status: 'replied' }),
      Email.countDocuments({ userId: uid, status: 'failed' }),
      Email.countDocuments({ userId: uid, receivedAt: { $gte: weekAgo } }),
      Email.countDocuments({ userId: uid, receivedAt: { $gte: twoWeeks, $lt: weekAgo } }),
      // One pass over the window, grouped by day *and* status, rather than
      // five separate aggregates.
      Email.aggregate<{ _id: { day: string; status: string }; n: number }>([
        { $match: { userId: uid, receivedAt: { $gte: twoWeeks } } },
        {
          $group: {
            _id: {
              day: { $dateToString: { format: '%Y-%m-%d', date: '$receivedAt' } },
              status: '$status',
            },
            n: { $sum: 1 },
          },
        },
      ]),
      Email.aggregate<{ _id: string; n: number }>([
        { $match: { userId: uid, receivedAt: { $gte: twoWeeks } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$receivedAt' } },
            n: { $sum: 1 },
          },
        },
      ]),
    ]);

  const trendFor = (status: string) =>
    series(
      byStatus.filter((r) => r._id.status === status).map((r) => ({ _id: r._id.day, n: r.n })),
      14,
    ).map((s) => s.value);

  const change = lastWeek ? Math.round(((thisWeek - lastWeek) / lastWeek) * 1000) / 10 : 0;
  const receivedTrend = series(receivedDaily, 14).map((s) => s.value);

  return [
    { key: 'total', label: 'Total emails', value: total, change, trend: receivedTrend },
    { key: 'unread', label: 'Unread', value: unread, change: 0, trend: trendFor('unread') },
    { key: 'pending', label: 'Pending replies', value: pending, change: 0, trend: trendFor('pending') },
    { key: 'replied', label: 'Auto replied', value: replied, change, trend: trendFor('replied') },
    { key: 'failed', label: 'Failed replies', value: failed, change: 0, trend: trendFor('failed') },
  ];
}
