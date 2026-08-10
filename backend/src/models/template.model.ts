import { Schema, model, models, type Model, type Document, type Types } from 'mongoose';
import type { Category } from './email.model';

export interface TemplateDoc extends Document {
  userId: Types.ObjectId;
  name: string;
  category: Category;
  body: string;
  usageCount: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const templateSchema = new Schema<TemplateDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true },
    category: { type: String, default: 'other' },
    body: { type: String, required: true },
    usageCount: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

// `models` is checked first so a re-import (tsx watch, a test reloading the
// module registry) reuses the compiled model instead of throwing
// OverwriteModelError.
export const Template =
  (models.Template as Model<TemplateDoc>) ?? model<TemplateDoc>('Template', templateSchema);
