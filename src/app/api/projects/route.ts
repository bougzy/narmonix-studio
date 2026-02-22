import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import { Project } from "@/models/Project";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    await connectDB();

    const projects = await Project.find({ userId: session.user.id })
      .sort({ updatedAt: -1 })
      .lean();

    const serialized = projects.map((p) => ({
      _id: p._id.toString(),
      userId: p.userId.toString(),
      name: p.name,
      bpm: p.bpm,
      key: p.key,
      tracks: (p.tracks || []).map((t: unknown) => String(t)),
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    }));

    return NextResponse.json(serialized);
  } catch (error) {
    console.error("GET /api/projects error:", error);
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { message: "Internal server error", detail: msg },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const { name, bpm, key } = await req.json();

  if (!name) {
    return NextResponse.json(
      { message: "Project name is required" },
      { status: 400 }
    );
  }

  await connectDB();

  const project = await Project.create({
    userId: session.user.id,
    name,
    bpm: bpm || 120,
    key: key || "C major",
    tracks: [],
  });

  return NextResponse.json(project, { status: 201 });
}
