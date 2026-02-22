import mongoose, { Schema, Document, Model } from "mongoose";

export interface ITrackDocument extends Document {
  projectId: mongoose.Types.ObjectId;
  name: string;
  type: "vocal" | "harmony" | "instrumental" | "mixed";
  harmonyPart: "soprano" | "alto" | "tenor" | "bass" | null;
  audioUrl: string;
  fileName: string;
  duration: number;
  volume: number;
  pan: number;
  muted: boolean;
  solo: boolean;
  eq: { low: number; mid: number; high: number };
  reverb: number;
  color: string;
  order: number;
  createdAt: Date;
}

const TrackSchema = new Schema<ITrackDocument>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: "Project", required: true },
    name: { type: String, required: true },
    type: {
      type: String,
      enum: ["vocal", "harmony", "instrumental", "mixed"],
      default: "vocal",
    },
    harmonyPart: {
      type: String,
      enum: ["soprano", "alto", "tenor", "bass", null],
      default: null,
    },
    audioUrl: { type: String, required: true },
    fileName: { type: String, required: true },
    duration: { type: Number, default: 0 },
    volume: { type: Number, default: 0.8, min: 0, max: 1.5 },
    pan: { type: Number, default: 0, min: -1, max: 1 },
    muted: { type: Boolean, default: false },
    solo: { type: Boolean, default: false },
    eq: {
      low: { type: Number, default: 0 },
      mid: { type: Number, default: 0 },
      high: { type: Number, default: 0 },
    },
    reverb: { type: Number, default: 0, min: 0, max: 1 },
    color: { type: String, default: "#6366f1" },
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const Track: Model<ITrackDocument> =
  mongoose.models.Track ||
  mongoose.model<ITrackDocument>("Track", TrackSchema);
