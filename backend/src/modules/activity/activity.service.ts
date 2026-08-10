import { Types } from 'mongoose';
import { Activity, type ActivityType } from '../../models/activity.model';
import { publish } from '../events/sse';

export async function record(
  userId: string,
  type: ActivityType,
  title: string,
  detail?: string,
  emailId?: string,
): Promise<void> {
  const doc = await Activity.create({
    userId: new Types.ObjectId(userId),
    type,
    title,
    detail,
    emailId: emailId ? new Types.ObjectId(emailId) : undefined,
  });
  publish(userId, 'activity', {
    id: doc._id,
    type,
    title,
    detail,
    createdAt: doc.createdAt,
  });
}

export async function recent(userId: string, limit = 20) {
  return Activity.find({ userId }).sort({ createdAt: -1 }).limit(limit).lean();
}
