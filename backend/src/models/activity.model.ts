import { Schema, model, models, type Model, type Document, type Types } from 'mongoose';

export type ActivityType =
  | 'email_received'
  | 'ai_generated'
  | 'reply_approved'
  | 'reply_rejected'
  | 'email_sent'
  | 'delivery_failed'
  | 'delivery_success'
  | 'sync'
  | 'automation_run'
  | 'settings_changed';

export interface ActivityDoc extends Document {
  userId: Types.ObjectId;
  emailId?: Types.ObjectId;
  type: ActivityType;
  title: string;
  detail?: string;
  createdAt: Date;
}

const activitySchema = new Schema<ActivityDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    emailId: { type: Schema.Types.ObjectId, ref: 'Email' },
    type: { type: String, required: true },
    title: { type: String, required: true },
    detail: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

activitySchema.index({ userId: 1, createdAt: -1 });

// `models` is checked first so a re-import (tsx watch, a test reloading the
// module registry) reuses the compiled model instead of throwing
// OverwriteModelError.
export const Activity =
  (models.Activity as Model<ActivityDoc>) ?? model<ActivityDoc>('Activity', activitySchema);
