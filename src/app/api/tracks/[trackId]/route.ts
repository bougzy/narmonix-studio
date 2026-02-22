import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import { Project } from "@/models/Project";
import { Track } from "@/models/Track";
import { AudioFile } from "@/models/AudioFile";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ trackId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const { trackId } = await params;
  const updates = await req.json();

  await connectDB();

  const track = await Track.findById(trackId);
  if (!track) {
    return NextResponse.json({ message: "Track not found" }, { status: 404 });
  }

  // Verify project ownership
  const project = await Project.findOne({
    _id: track.projectId,
    userId: session.user.id,
  });

  if (!project) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 403 });
  }

  const updatedTrack = await Track.findByIdAndUpdate(
    trackId,
    { $set: updates },
    { new: true }
  );

  return NextResponse.json(updatedTrack);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ trackId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const { trackId } = await params;

  await connectDB();

  const track = await Track.findById(trackId);
  if (!track) {
    return NextResponse.json({ message: "Track not found" }, { status: 404 });
  }

  // Verify project ownership
  const project = await Project.findOne({
    _id: track.projectId,
    userId: session.user.id,
  });

  if (!project) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 403 });
  }

  // Delete audio file from MongoDB storage
  try {
    const audioIdMatch = track.audioUrl.match(/\/api\/audio\/([a-f0-9]+)/);
    if (audioIdMatch) {
      await AudioFile.findByIdAndDelete(audioIdMatch[1]);
    }
  } catch (e) {
    console.error("Failed to delete audio file:", e);
  }

  // Remove from project tracks array
  project.tracks = project.tracks.filter(
    (t) => t.toString() !== trackId
  );
  await project.save();

  await Track.findByIdAndDelete(trackId);

  return NextResponse.json({ message: "Track deleted" });
}
