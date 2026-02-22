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

  const body = await req.json();
  const { projectId, name, type, harmonyPart, audioUrl, fileName, duration, volume } = body;

  if (!projectId || !audioUrl || !fileName) {
    return NextResponse.json(
      { message: "projectId, audioUrl, and fileName are required" },
      { status: 400 }
    );
  }

  await connectDB();

  // Verify project belongs to user
  const project = await Project.findOne({
    _id: projectId,
    userId: session.user.id,
  });

  if (!project) {
    return NextResponse.json({ message: "Project not found" }, { status: 404 });
  }

  const trackCount = await Track.countDocuments({ projectId });

  const track = await Track.create({
    projectId,
    name: name || `Track ${trackCount + 1}`,
    type: type || "vocal",
    harmonyPart: harmonyPart || null,
    audioUrl,
    fileName,
    duration: duration || 0,
    volume: volume ?? 0.8,
    order: trackCount,
  });

  // Add track to project
  project.tracks.push(track._id);
  await project.save();

  return NextResponse.json(track, { status: 201 });
}
