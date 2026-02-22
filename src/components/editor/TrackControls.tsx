"use client";

import { useState } from "react";
import {
  Volume2,
  VolumeX,
  Headphones,
  Trash2,
  Palette,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useEditorStore } from "@/store/useEditorStore";
import { getAudioEngine } from "@/lib/audioEngine";
import { ITrack } from "@/types";
import { toast } from "sonner";

const TRACK_COLORS = [
  "#6366f1", "#3b82f6", "#22c55e", "#f97316",
  "#ef4444", "#ec4899", "#8b5cf6", "#14b8a6",
];

const HARMONY_LABELS: Record<string, { label: string; color: string }> = {
  soprano: { label: "S", color: "#3b82f6" },
  alto: { label: "A", color: "#22c55e" },
  tenor: { label: "T", color: "#f97316" },
  bass: { label: "B", color: "#ef4444" },
};

interface TrackControlsProps {
  track: ITrack;
}

export function TrackControls({ track }: TrackControlsProps) {
  const { updateTrack, removeTrack } = useEditorStore();
  const [name, setName] = useState(track.name);
  const engine = getAudioEngine();

  function handleMute() {
    const muted = !track.muted;
    updateTrack(track._id, { muted });
    engine.muteTrack(track._id, muted);
  }

  function handleSolo() {
    const solo = !track.solo;
    updateTrack(track._id, { solo });
    engine.soloTrack(track._id, solo);
  }

  function handleDelete() {
    engine.removeTrack(track._id);
    removeTrack(track._id);

    fetch(`/api/tracks/${track._id}`, { method: "DELETE" }).catch(() => {
      toast.error("Failed to delete track from server");
    });
  }

  async function handleDownload() {
    try {
      const response = await fetch(track.audioUrl);
      if (!response.ok) throw new Error("Download failed");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = track.fileName || `${track.name}.wav`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Failed to download track");
    }
  }

  function handleRename() {
    if (name.trim() && name !== track.name) {
      updateTrack(track._id, { name: name.trim() });
      fetch(`/api/tracks/${track._id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      }).catch(() => {});
    }
  }

  const harmonyInfo = track.harmonyPart
    ? HARMONY_LABELS[track.harmonyPart]
    : null;

  return (
    <div className="w-48 flex-shrink-0 bg-card border-r border-border p-2 flex flex-col gap-1">
      {/* Track Name & Type Badge */}
      <div className="flex items-center gap-1">
        {harmonyInfo && (
          <span
            className="text-xs font-bold px-1.5 py-0.5 rounded"
            style={{
              backgroundColor: `${harmonyInfo.color}20`,
              color: harmonyInfo.color,
            }}
          >
            {harmonyInfo.label}
          </span>
        )}
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={handleRename}
          onKeyDown={(e) => e.key === "Enter" && handleRename()}
          className="h-6 text-xs bg-transparent border-none px-1 focus-visible:ring-1"
        />
      </div>

      {/* Controls Row */}
      <div className="flex items-center gap-0.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={track.muted ? "default" : "ghost"}
              size="sm"
              className="h-6 w-6 p-0"
              onClick={handleMute}
            >
              {track.muted ? (
                <VolumeX className="h-3 w-3" />
              ) : (
                <Volume2 className="h-3 w-3" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Mute</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={track.solo ? "default" : "ghost"}
              size="sm"
              className="h-6 w-6 p-0"
              onClick={handleSolo}
            >
              <Headphones className="h-3 w-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Solo</TooltipContent>
        </Tooltip>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
              <Palette className="h-3 w-3" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-2">
            <div className="grid grid-cols-4 gap-1">
              {TRACK_COLORS.map((color) => (
                <button
                  key={color}
                  className="w-6 h-6 rounded border border-border hover:scale-110 transition-transform"
                  style={{ backgroundColor: color }}
                  onClick={() => updateTrack(track._id, { color })}
                />
              ))}
            </div>
          </PopoverContent>
        </Popover>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              onClick={handleDownload}
            >
              <Download className="h-3 w-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Download</TooltipContent>
        </Tooltip>

        <div className="flex-1" />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-destructive hover:text-destructive"
              onClick={handleDelete}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Delete Track</TooltipContent>
        </Tooltip>
      </div>

      {/* Duration */}
      <span className="text-[10px] text-muted-foreground">
        {track.duration > 0
          ? `${Math.floor(track.duration / 60)}:${Math.floor(
              track.duration % 60
            )
              .toString()
              .padStart(2, "0")}`
          : "0:00"}
      </span>
    </div>
  );
}
