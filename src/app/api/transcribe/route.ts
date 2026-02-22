import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import { Project } from "@/models/Project";
import { Track } from "@/models/Track";

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || "http://localhost:8000";
const AI_SERVICE_SECRET =
  process.env.AI_SERVICE_SECRET || "hx-internal-secret-key";

/**
 * POST /api/transcribe
 *
 * Sends track audio to the Python AI service for tonic sol-fa transcription.
 * Uses CREPE neural pitch detection, auto key/BPM detection, and
 * functional harmony SATB generation.
 *
 * Body: { projectId, trackIds?: string[] }
 *
 * Returns: { notation_text, sheet, detected }
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const { projectId, trackIds } = await req.json();

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
    return NextResponse.json(
      { message: "Project not found" },
      { status: 404 }
    );
  }

  // Find eligible tracks (vocal, harmony, mixed)
  const query: Record<string, unknown> = {
    projectId,
    type: { $in: ["vocal", "harmony", "mixed"] },
  };
  if (trackIds?.length) {
    query._id = { $in: trackIds };
  }

  const tracks = await Track.find(query).sort({ order: 1 });

  if (tracks.length === 0) {
    return NextResponse.json(
      { message: "No eligible tracks found" },
      { status: 400 }
    );
  }

  // Build the full audio URL for the Python service to fetch
  const origin = getInternalOrigin(req);

  try {
    // Use the first vocal/melody track for transcription
    const melodyTrack =
      tracks.find((t) => t.type === "vocal" || t.type === "mixed") || tracks[0];

    const fullAudioUrl = melodyTrack.audioUrl.startsWith("http")
      ? melodyTrack.audioUrl
      : `${origin}${melodyTrack.audioUrl}`;

    // Call Python AI service /transcribe endpoint
    const transcribeRes = await fetch(`${AI_SERVICE_URL}/transcribe`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Secret": AI_SERVICE_SECRET,
      },
      body: JSON.stringify({
        audio_url: fullAudioUrl,
        project_name: project.name,
        project_key: project.key === "Auto-detect" ? null : (project.key || null),
        project_bpm: project.bpm || null,
      }),
    });

    if (!transcribeRes.ok) {
      const errBody = await transcribeRes.text();
      console.error("AI transcribe error:", errBody);
      return NextResponse.json(
        {
          message: "AI transcription failed",
          fallback: true,
          error: errBody,
        },
        { status: 502 }
      );
    }

    const result = await transcribeRes.json();

    // Convert Python response to frontend SolfaSheet format
    const sheet = {
      projectName: project.name,
      key: `${result.key} ${result.scale}`,
      bpm: result.bpm,
      timeSignature: { numerator: 4, denominator: 4 },
      parts: Object.entries(result.parts).map(
        ([partKey, measures]: [string, unknown]) => ({
          partName:
            partKey.charAt(0).toUpperCase() + partKey.slice(1),
          partKey,
          measures: measures as Array<{
            measure_number: number;
            beats: Array<{
              syllable: string;
              octave_offset: number;
              confidence: number;
            }>;
          }>,
        })
      ),
      totalMeasures: result.total_measures,
    };

    // Normalize measure format for frontend compatibility
    for (const part of sheet.parts) {
      for (const measure of part.measures) {
        // Rename measure_number → measureNumber for frontend
        const m = measure as Record<string, unknown>;
        if (m.measure_number !== undefined) {
          m.measureNumber = m.measure_number;
          delete m.measure_number;
        }
        // Normalize beat format
        for (const beat of measure.beats) {
          const b = beat as Record<string, unknown>;
          if (b.octave_offset !== undefined) {
            b.octaveOffset = b.octave_offset;
            delete b.octave_offset;
          }
          // Add duration field expected by frontend
          if (b.duration === undefined) {
            b.duration = 1;
          }
        }
      }
    }

    return NextResponse.json({
      notation_text: result.notation_text,
      sheet,
      detected: {
        key: result.key,
        scale: result.scale,
        bpm: result.bpm,
        confidence: result.confidence,
        is_polyphonic: result.is_polyphonic,
        duration: result.duration,
      },
    });
  } catch (error) {
    console.error("Transcribe route error:", error);

    // Return fallback signal so frontend can use client-side processing
    return NextResponse.json(
      {
        message:
          "AI service unavailable. Using client-side transcription.",
        fallback: true,
      },
      { status: 503 }
    );
  }
}

/**
 * Determine the internal URL for the Next.js app that the
 * Python AI service can use to fetch audio files.
 *
 * In Docker: http://nextjs:3000
 * In dev: http://localhost:3000
 */
function getInternalOrigin(req: NextRequest): string {
  // Docker Compose sets this for the AI service to reach back to Next.js
  const internalUrl = process.env.NEXTJS_INTERNAL_URL;
  if (internalUrl) return internalUrl;

  // Fallback: use the request's host header
  const proto = req.headers.get("x-forwarded-proto") || "http";
  const host = req.headers.get("host") || "localhost:3000";
  return `${proto}://${host}`;
}
