"use client";

import {
  Play,
  Pause,
  Square,
  Mic,
  Repeat,
  ZoomIn,
  ZoomOut,
  Undo2,
  Redo2,
  Save,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useEditorStore } from "@/store/useEditorStore";
import { getAudioEngine } from "@/lib/audioEngine";
import { toast } from "sonner";

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  return `${mins}:${secs.toString().padStart(2, "0")}.${ms.toString().padStart(2, "0")}`;
}

interface TransportBarProps {
  onRecord: () => void;
  onSave: () => void;
}

export function TransportBar({ onRecord, onSave }: TransportBarProps) {
  const {
    isPlaying,
    isRecording,
    currentTime,
    bpm,
    loopEnabled,
    zoom,
    project,
    setPlaying,
    setBpm,
    setLoopEnabled,
    setZoom,
    undo,
    redo,
  } = useEditorStore();

  const engine = getAudioEngine();

  function handlePlay() {
    if (isPlaying) {
      engine.pause();
      setPlaying(false);
    } else {
      engine.play();
      setPlaying(true);
    }
  }

  function handleStop() {
    engine.stop();
    setPlaying(false);
  }

  function handleBpmChange(value: string) {
    const newBpm = parseInt(value);
    if (newBpm >= 40 && newBpm <= 300) {
      setBpm(newBpm);
      engine.setBpm(newBpm);
    }
  }

  function handleSave() {
    onSave();
    toast.success("Project saved");
  }

  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-card border-b border-border">
      {/* Project Name */}
      <span className="text-sm font-medium truncate max-w-[150px]">
        {project?.name || "Untitled"}
      </span>

      <Separator orientation="vertical" className="h-6" />

      {/* Transport Controls */}
      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={handleStop}
            >
              <Square className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Stop</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={isPlaying ? "default" : "ghost"}
              size="sm"
              className="h-8 w-8 p-0"
              onClick={handlePlay}
            >
              {isPlaying ? (
                <Pause className="h-4 w-4" />
              ) : (
                <Play className="h-4 w-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{isPlaying ? "Pause" : "Play"} (Space)</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={isRecording ? "destructive" : "ghost"}
              size="sm"
              className="h-8 w-8 p-0"
              onClick={onRecord}
              disabled={isRecording}
            >
              <Mic className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Record (R)</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={loopEnabled ? "default" : "ghost"}
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => setLoopEnabled(!loopEnabled)}
            >
              <Repeat className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Loop</TooltipContent>
        </Tooltip>
      </div>

      <Separator orientation="vertical" className="h-6" />

      {/* Time Display */}
      <div className="font-mono text-sm text-primary min-w-[80px] text-center">
        {formatTime(currentTime)}
      </div>

      <Separator orientation="vertical" className="h-6" />

      {/* BPM */}
      <div className="flex items-center gap-1">
        <span className="text-xs text-muted-foreground">BPM</span>
        <Input
          type="number"
          value={bpm}
          onChange={(e) => handleBpmChange(e.target.value)}
          className="w-16 h-7 text-xs text-center"
          min={40}
          max={300}
        />
      </div>

      <div className="flex-1" />

      {/* Zoom */}
      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => setZoom(zoom / 1.5)}
            >
              <ZoomOut className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Zoom Out</TooltipContent>
        </Tooltip>
        <span className="text-xs text-muted-foreground min-w-[40px] text-center">
          {Math.round(zoom * 100)}%
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => setZoom(zoom * 1.5)}
            >
              <ZoomIn className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Zoom In</TooltipContent>
        </Tooltip>
      </div>

      <Separator orientation="vertical" className="h-6" />

      {/* Undo/Redo */}
      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={undo}
            >
              <Undo2 className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Undo (Ctrl+Z)</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={redo}
            >
              <Redo2 className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Redo (Ctrl+Y)</TooltipContent>
        </Tooltip>
      </div>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={handleSave}>
            <Save className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Save (Ctrl+S)</TooltipContent>
      </Tooltip>
    </div>
  );
}
