"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { useEditorStore } from "@/store/useEditorStore";
import { TrackControls } from "./TrackControls";
import { WaveformDisplay } from "./WaveformDisplay";
import { ITrack } from "@/types";

interface TrackLaneProps {
  track: ITrack;
}

export function TrackLane({ track }: TrackLaneProps) {
  const { selectedTrackId, setSelectedTrack } = useEditorStore();
  const isSelected = selectedTrackId === track._id;

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: track._id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const borderColor = track.harmonyPart
    ? {
        soprano: "border-l-blue-500",
        alto: "border-l-green-500",
        tenor: "border-l-orange-500",
        bass: "border-l-red-500",
      }[track.harmonyPart] || "border-l-primary"
    : "border-l-primary/50";

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`track-lane flex border-b border-border ${borderColor} border-l-2 ${
        isSelected ? "bg-accent/30" : "bg-background hover:bg-accent/10"
      } ${track.muted ? "opacity-50" : ""}`}
      onClick={() => setSelectedTrack(track._id)}
    >
      {/* Drag Handle */}
      <div
        className="flex items-center px-1 cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </div>

      {/* Track Info & Controls */}
      <TrackControls track={track} />

      {/* Waveform */}
      <div
        className="flex-1 overflow-hidden"
        style={{ height: isSelected ? "160px" : "80px" }}
      >
        <WaveformDisplay
          trackId={track._id}
          audioUrl={track.audioUrl}
          harmonyPart={track.harmonyPart}
          isSelected={isSelected}
        />
      </div>
    </div>
  );
}
