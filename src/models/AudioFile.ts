import mongoose, { Schema, Document, Model } from "mongoose";

export interface IAudioFileDocument extends Document {
  userId: mongoose.Types.ObjectId;
  projectId: mongoose.Types.ObjectId;
  fileName: string;
  contentType: string;
  data: Buffer;
  size: number;
  createdAt: Date;
}

const AudioFileSchema = new Schema<IAudioFileDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    projectId: { type: Schema.Types.ObjectId, ref: "Project", required: true },
    fileName: { type: String, required: true },
    contentType: { type: String, required: true },
    data: { type: Buffer, required: true },
    size: { type: Number, required: true },
  },
  { timestamps: true }
);

export const AudioFile: Model<IAudioFileDocument> =
  mongoose.models.AudioFile ||
  mongoose.model<IAudioFileDocument>("AudioFile", AudioFileSchema);
