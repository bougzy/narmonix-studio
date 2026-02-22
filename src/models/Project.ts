import mongoose, { Schema, Document, Model } from "mongoose";

export interface IProjectDocument extends Document {
  userId: mongoose.Types.ObjectId;
  name: string;
  bpm: number;
  key: string;
  tracks: mongoose.Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const ProjectSchema = new Schema<IProjectDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true },
    bpm: { type: Number, default: 120 },
    key: { type: String, default: "C major" },
    tracks: [{ type: Schema.Types.ObjectId, ref: "Track" }],
  },
  { timestamps: true }
);

export const Project: Model<IProjectDocument> =
  mongoose.models.Project ||
  mongoose.model<IProjectDocument>("Project", ProjectSchema);
