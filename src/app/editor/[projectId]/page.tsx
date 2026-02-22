import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import { Project } from "@/models/Project";
import { Track } from "@/models/Track";
import { DAWEditor } from "@/components/editor/DAWEditor";
import { IProject, ITrack } from "@/types";

interface EditorPageProps {
  params: Promise<{ projectId: string }>;
}

export default async function EditorPage({ params }: EditorPageProps) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const { projectId } = await params;

  await connectDB();

  const project = await Project.findOne({
    _id: projectId,
    userId: session.user.id,
  }).lean();

  if (!project) {
    redirect("/dashboard");
  }

  const tracks = await Track.find({ projectId }).sort({ order: 1 }).lean();

  // Serialize MongoDB documents to plain objects
  const serializedProject: IProject = {
    _id: project._id.toString(),
    userId: project.userId.toString(),
    name: project.name,
    bpm: project.bpm,
    key: project.key,
    tracks: project.tracks.map((t: unknown) => t?.toString() || ""),
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };

  const serializedTracks: ITrack[] = tracks.map((t) => ({
    _id: t._id.toString(),
    projectId: t.projectId.toString(),
    name: t.name,
    type: t.type,
    harmonyPart: t.harmonyPart,
    audioUrl: t.audioUrl,
    fileName: t.fileName,
    duration: t.duration,
    volume: t.volume,
    pan: t.pan,
    muted: t.muted,
    solo: t.solo,
    eq: t.eq,
    reverb: t.reverb,
    color: t.color || "#6366f1",
    order: t.order,
    createdAt: t.createdAt,
  }));

  return (
    <DAWEditor project={serializedProject} initialTracks={serializedTracks} />
  );
}
