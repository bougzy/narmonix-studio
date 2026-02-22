import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import { Project } from "@/models/Project";
import { Track } from "@/models/Track";

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || "http://localhost:8000";
const AI_SERVICE_SECRET =
  process.env.AI_SERVICE_SECRET || "hx-internal-secret-key";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const { trackId, projectId } = await req.json();

  if (!trackId || !projectId) {
    return NextResponse.json(
      { message: "trackId and projectId are required" },
      { status: 400 }
    );
  }

  await connectDB();

  // Verify ownership
  const project = await Project.findOne({
    _id: projectId,
    userId: session.user.id,
  });

  if (!project) {
    return NextResponse.json({ message: "Project not found" }, { status: 404 });
  }

  const sourceTrack = await Track.findById(trackId);
  if (!sourceTrack) {
    return NextResponse.json({ message: "Track not found" }, { status: 404 });
  }

  try {
    // Step 1: Analyze the audio
    const analyzeRes = await fetch(`${AI_SERVICE_URL}/analyze`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Secret": AI_SERVICE_SECRET,
      },
      body: JSON.stringify({
        audio_url: sourceTrack.audioUrl,
        project_key: project.key === "Auto-detect" ? null : project.key,
        bpm: project.bpm,
      }),
    });

    if (!analyzeRes.ok) {
      throw new Error("AI analysis failed");
    }

    const analysis = await analyzeRes.json();

    // Step 2: Generate harmonies
    const harmonyRes = await fetch(`${AI_SERVICE_URL}/generate-harmonies`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Secret": AI_SERVICE_SECRET,
      },
      body: JSON.stringify({
        pitch_contour: analysis.pitch_contour,
        key: analysis.key,
        scale: analysis.scale,
        bpm: analysis.bpm,
        duration: analysis.duration,
      }),
    });

    if (!harmonyRes.ok) {
      throw new Error("Harmony generation failed");
    }

    const harmonies = await harmonyRes.json();

    // Step 3: Synthesize voices
    const synthRes = await fetch(`${AI_SERVICE_URL}/synthesize-voice`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Secret": AI_SERVICE_SECRET,
      },
      body: JSON.stringify({
        audio_url: sourceTrack.audioUrl,
        harmony_parts: harmonies.parts,
        duration: analysis.duration,
      }),
    });

    if (!synthRes.ok) {
      throw new Error("Voice synthesis failed");
    }

    const synthesis = await synthRes.json();

    // Step 4: Create track records for each harmony part
    const parts: Array<{ name: string; part: "soprano" | "alto" | "tenor" | "bass" }> = [
      { name: "Soprano", part: "soprano" },
      { name: "Alto", part: "alto" },
      { name: "Tenor", part: "tenor" },
      { name: "Bass", part: "bass" },
    ];

    const newTracks = [];
    const trackCount = await Track.countDocuments({ projectId });

    for (let i = 0; i < parts.length; i++) {
      const { name, part } = parts[i];
      const audioUrl = synthesis.audio_urls[i];

      const track = await Track.create({
        projectId,
        name: `${name} Harmony`,
        type: "harmony",
        harmonyPart: part,
        audioUrl,
        fileName: `${part}_harmony.wav`,
        duration: analysis.duration,
        volume: 0.7,
        order: trackCount + i,
      });

      project.tracks.push(track._id);
      newTracks.push(track);
    }

    await project.save();

    return NextResponse.json({
      message: "Harmonies generated successfully",
      tracks: newTracks,
      analysis: {
        key: analysis.key,
        scale: analysis.scale,
        bpm: analysis.bpm,
      },
    });
  } catch (error) {
    console.error("Harmony generation error:", error);
    return NextResponse.json(
      { message: "Failed to generate harmonies. Please ensure the AI service is running." },
      { status: 500 }
    );
  }
}
