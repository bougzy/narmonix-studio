import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import { Project } from "@/models/Project";
import { Track } from "@/models/Track";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const { projectId, type, trackId } = await req.json();

  if (!projectId) {
    return NextResponse.json(
      { message: "projectId is required" },
      { status: 400 }
    );
  }

  await connectDB();

  const project = await Project.findOne({
    _id: projectId,
    userId: session.user.id,
  });

  if (!project) {
    return NextResponse.json({ message: "Project not found" }, { status: 404 });
  }

  let tracks;

  if (type === "individual" && trackId) {
    const track = await Track.findById(trackId);
    if (!track) {
      return NextResponse.json({ message: "Track not found" }, { status: 404 });
    }
    tracks = [track];
  } else {
    tracks = await Track.find({ projectId }).sort({ order: 1 });
  }

  // Return track audio URLs for client-side processing with ffmpeg.wasm
  const audioData = tracks.map((t) => ({
    id: t._id,
    name: t.name,
    audioUrl: t.audioUrl,
    volume: t.volume,
    pan: t.pan,
    muted: t.muted,
  }));

  return NextResponse.json({
    projectName: project.name,
    tracks: audioData,
  });
}
