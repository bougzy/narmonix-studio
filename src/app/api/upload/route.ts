import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import { AudioFile } from "@/models/AudioFile";

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB API limit
const MONGO_DOC_LIMIT = 15 * 1024 * 1024; // 15MB safe limit for MongoDB (16MB BSON limit minus overhead)

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const projectId = formData.get("projectId") as string;

    if (!file || !projectId) {
      return NextResponse.json(
        { message: "file and projectId are required" },
        { status: 400 }
      );
    }

    const allowedTypes = [
      "audio/wav",
      "audio/wave",
      "audio/x-wav",
      "audio/mp3",
      "audio/mpeg",
      "audio/ogg",
      "audio/flac",
      "audio/webm",
      "application/octet-stream",
    ];

    const allowedExtensions = [".wav", ".mp3", ".ogg", ".flac", ".webm"];
    const ext = file.name
      ? file.name.substring(file.name.lastIndexOf(".")).toLowerCase()
      : "";
    const typeOk =
      !file.type ||
      allowedTypes.includes(file.type) ||
      allowedExtensions.includes(ext);

    if (!typeOk) {
      return NextResponse.json(
        {
          message: `Unsupported file type: ${file.type || "unknown"} (${file.name})`,
        },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { message: "File too large (max 25MB)" },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    let buffer: Buffer = Buffer.from(arrayBuffer);

    // If WAV file exceeds MongoDB doc limit, downmix stereo to mono to halve size
    if (buffer.length > MONGO_DOC_LIMIT && (ext === ".wav" || file.type?.includes("wav"))) {
      buffer = downmixWavToMono(buffer) as Buffer;
    }

    if (buffer.length > MONGO_DOC_LIMIT) {
      return NextResponse.json(
        { message: `File too large for storage (${(buffer.length / 1024 / 1024).toFixed(1)}MB, max ~15MB). Try a shorter clip or compressed format.` },
        { status: 400 }
      );
    }

    // Determine content type - fallback to extension-based detection
    let contentType = file.type;
    if (!contentType || contentType === "application/octet-stream") {
      const extMap: Record<string, string> = {
        ".wav": "audio/wav",
        ".mp3": "audio/mpeg",
        ".ogg": "audio/ogg",
        ".flac": "audio/flac",
        ".webm": "audio/webm",
      };
      contentType = extMap[ext] || "audio/wav";
    }

    await connectDB();

    const audioFile = await AudioFile.create({
      userId: session.user.id,
      projectId,
      fileName: file.name,
      contentType,
      data: buffer,
      size: buffer.length,
    });

    const audioUrl = `/api/audio/${audioFile._id}`;

    return NextResponse.json({
      audioUrl,
      fileName: file.name,
      audioFileId: audioFile._id.toString(),
    });
  } catch (error) {
    console.error("Upload error:", error);
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ message }, { status: 500 });
  }
}

/**
 * Downmix a stereo WAV buffer to mono in-place to reduce file size.
 * Returns the original buffer unchanged if it's already mono or not a valid WAV.
 */
function downmixWavToMono(buf: Buffer): Buffer {
  // Validate WAV header
  if (buf.length < 44) return buf;
  const riff = buf.toString("ascii", 0, 4);
  const wave = buf.toString("ascii", 8, 12);
  if (riff !== "RIFF" || wave !== "WAVE") return buf;

  const numChannels = buf.readUInt16LE(22);
  if (numChannels !== 2) return buf; // already mono or unsupported

  const sampleRate = buf.readUInt32LE(24);
  const bitsPerSample = buf.readUInt16LE(34);
  if (bitsPerSample !== 16) return buf; // only handle 16-bit

  const dataOffset = 44; // standard WAV header
  const dataSize = buf.readUInt32LE(40);
  const bytesPerSample = bitsPerSample / 8;
  const numSamples = Math.floor(dataSize / (numChannels * bytesPerSample));

  // Create mono buffer
  const monoDataSize = numSamples * bytesPerSample;
  const monoBuffer = Buffer.alloc(44 + monoDataSize);

  // Write WAV header for mono
  buf.copy(monoBuffer, 0, 0, 44);
  monoBuffer.writeUInt16LE(1, 22); // mono
  monoBuffer.writeUInt32LE(sampleRate * 1 * bytesPerSample, 28); // byte rate
  monoBuffer.writeUInt16LE(1 * bytesPerSample, 32); // block align
  monoBuffer.writeUInt32LE(monoDataSize, 40); // data size
  monoBuffer.writeUInt32LE(36 + monoDataSize, 4); // file size - 8

  // Downmix stereo to mono by averaging channels
  for (let i = 0; i < numSamples; i++) {
    const srcOffset = dataOffset + i * numChannels * bytesPerSample;
    const left = buf.readInt16LE(srcOffset);
    const right = buf.readInt16LE(srcOffset + bytesPerSample);
    const mono = Math.round((left + right) / 2);
    monoBuffer.writeInt16LE(Math.max(-32768, Math.min(32767, mono)), 44 + i * bytesPerSample);
  }

  return monoBuffer;
}
