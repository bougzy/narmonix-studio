import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import { AudioFile } from "@/models/AudioFile";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ audioId: string }> }
) {
  const { audioId } = await params;

  await connectDB();

  const audioFile = await AudioFile.findById(audioId);
  if (!audioFile) {
    return NextResponse.json({ message: "Audio not found" }, { status: 404 });
  }

  const uint8Array = new Uint8Array(audioFile.data);
  return new NextResponse(uint8Array, {
    headers: {
      "Content-Type": audioFile.contentType,
      "Content-Length": audioFile.size.toString(),
      "Cache-Control": "public, max-age=31536000, immutable",
      "Accept-Ranges": "bytes",
    },
  });
}
