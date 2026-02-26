"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Play,
  Pause,
  Square,
  Volume2,
  VolumeX,
  Download,
  Loader2,
  Headphones,
  Music,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useEditorStore } from "@/store/useEditorStore";
import { exportSingleTrack } from "@/lib/audioMixer";
import { toast } from "sonner";
import { ITrack } from "@/types";

interface HarmonyModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface PartState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  isDownloading: boolean;
  downloadProgress: number;
}

const PART_ORDER = ["soprano", "alto", "tenor", "bass"] as const;

const PART_STYLES: Record<
  string,
  { dot: string; text: string; border: string; bg: string }
> = {
  soprano: {
    dot: "bg-blue-500",
    text: "text-blue-400",
    border: "border-blue-500/30",
    bg: "bg-blue-500/5",
  },
  alto: {
    dot: "bg-green-500",
    text: "text-green-400",
    border: "border-green-500/30",
    bg: "bg-green-500/5",
  },
  tenor: {
    dot: "bg-orange-500",
    text: "text-orange-400",
    border: "border-orange-500/30",
    bg: "bg-orange-500/5",
  },
  bass: {
    dot: "bg-red-500",
    text: "text-red-400",
    border: "border-red-500/30",
    bg: "bg-red-500/5",
  },
};

function formatTime(secs: number): string {
  if (!secs || !isFinite(secs)) return "0:00";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function HarmonyModal({ open, onOpenChange }: HarmonyModalProps) {
  const { tracks, harmonySopranoTrackId } = useEditorStore();

  const [partStates, setPartStates] = useState<Record<string, PartState>>({});
  const [isDownloadingAll, setIsDownloadingAll] = useState(false);
  const audioRefs = useRef<Record<string, HTMLAudioElement>>({});
  const animFrameRef = useRef<number>(0);

  // Gather the parts to display
  const harmonyTracks = tracks.filter((t) => t.type === "harmony");
  const sopranoTrack = harmonySopranoTrackId
    ? tracks.find((t) => t._id === harmonySopranoTrackId)
    : tracks.find((t) => t.type === "vocal" || t.type === "mixed");

  const partTracks: Array<{ partKey: string; track: ITrack }> = [];
  if (sopranoTrack) {
    partTracks.push({ partKey: "soprano", track: sopranoTrack });
  }
  for (const part of ["alto", "tenor", "bass"]) {
    const t = harmonyTracks.find((h) => h.harmonyPart === part);
    if (t) partTracks.push({ partKey: part, track: t });
  }

  // Initialize audio elements when modal opens
  useEffect(() => {
    if (!open || partTracks.length === 0) return;

    const newAudios: Record<string, HTMLAudioElement> = {};
    const newStates: Record<string, PartState> = {};

    for (const { partKey, track } of partTracks) {
      const audio = new Audio(track.audioUrl);
      audio.preload = "metadata";
      audio.volume = 0.8;
      newAudios[partKey] = audio;
      newStates[partKey] = {
        isPlaying: false,
        currentTime: 0,
        duration: track.duration || 0,
        volume: 0.8,
        isDownloading: false,
        downloadProgress: 0,
      };

      // Update duration when metadata loads
      audio.addEventListener("loadedmetadata", () => {
        setPartStates((prev) => ({
          ...prev,
          [partKey]: { ...prev[partKey], duration: audio.duration },
        }));
      });

      // Reset on end
      audio.addEventListener("ended", () => {
        setPartStates((prev) => ({
          ...prev,
          [partKey]: { ...prev[partKey], isPlaying: false, currentTime: 0 },
        }));
      });
    }

    audioRefs.current = newAudios;
    setPartStates(newStates);

    // Time tracking loop
    const tick = () => {
      setPartStates((prev) => {
        const next = { ...prev };
        for (const key in audioRefs.current) {
          const audio = audioRefs.current[key];
          if (audio && !audio.paused) {
            next[key] = { ...next[key], currentTime: audio.currentTime };
          }
        }
        return next;
      });
      animFrameRef.current = requestAnimationFrame(tick);
    };
    animFrameRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      Object.values(newAudios).forEach((audio) => {
        audio.pause();
        audio.src = "";
      });
      audioRefs.current = {};
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, harmonySopranoTrackId, harmonyTracks.length]);

  const updatePartState = useCallback(
    (partKey: string, updates: Partial<PartState>) => {
      setPartStates((prev) => ({
        ...prev,
        [partKey]: { ...prev[partKey], ...updates },
      }));
    },
    []
  );

  function togglePlay(partKey: string) {
    const audio = audioRefs.current[partKey];
    if (!audio) return;

    if (audio.paused) {
      // Pause all others
      for (const [key, a] of Object.entries(audioRefs.current)) {
        if (key !== partKey && !a.paused) {
          a.pause();
          updatePartState(key, { isPlaying: false });
        }
      }
      audio.play();
      updatePartState(partKey, { isPlaying: true });
    } else {
      audio.pause();
      updatePartState(partKey, { isPlaying: false });
    }
  }

  function handleSeek(partKey: string, time: number) {
    const audio = audioRefs.current[partKey];
    if (!audio) return;
    audio.currentTime = time;
    updatePartState(partKey, { currentTime: time });
  }

  function handleVolumeChange(partKey: string, vol: number) {
    const audio = audioRefs.current[partKey];
    if (!audio) return;
    audio.volume = vol;
    updatePartState(partKey, { volume: vol });
  }

  function playAll() {
    // Stop all first, reset to start
    for (const [key, audio] of Object.entries(audioRefs.current)) {
      audio.currentTime = 0;
      audio.play();
      updatePartState(key, { isPlaying: true, currentTime: 0 });
    }
  }

  function stopAll() {
    for (const [key, audio] of Object.entries(audioRefs.current)) {
      audio.pause();
      audio.currentTime = 0;
      updatePartState(key, { isPlaying: false, currentTime: 0 });
    }
  }

  const isAnyPlaying = Object.values(partStates).some((s) => s.isPlaying);

  async function handleDownloadPart(partKey: string) {
    const pt = partTracks.find((p) => p.partKey === partKey);
    if (!pt) return;

    updatePartState(partKey, { isDownloading: true, downloadProgress: 0 });

    try {
      const blob = await exportSingleTrack(pt.track.audioUrl, (pct) => {
        updatePartState(partKey, { downloadProgress: pct });
      });
      const name = `${pt.track.name || partKey}_harmony.wav`;
      downloadBlob(blob, name);
      toast.success(`Downloaded ${partKey} part`);
    } catch {
      toast.error(`Failed to download ${partKey} part`);
    } finally {
      updatePartState(partKey, { isDownloading: false, downloadProgress: 0 });
    }
  }

  async function handleDownloadAll() {
    setIsDownloadingAll(true);
    try {
      for (const { partKey, track } of partTracks) {
        updatePartState(partKey, { isDownloading: true, downloadProgress: 0 });
        const blob = await exportSingleTrack(track.audioUrl, (pct) => {
          updatePartState(partKey, { downloadProgress: pct });
        });
        const name = `${track.name || partKey}_harmony.wav`;
        downloadBlob(blob, name);
        updatePartState(partKey, { isDownloading: false, downloadProgress: 0 });
        // Small delay between downloads to avoid browser blocking
        await new Promise((r) => setTimeout(r, 300));
      }
      toast.success("All parts downloaded!");
    } catch {
      toast.error("Failed to download some parts");
    } finally {
      setIsDownloadingAll(false);
      for (const { partKey } of partTracks) {
        updatePartState(partKey, { isDownloading: false, downloadProgress: 0 });
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Headphones className="h-5 w-5 text-primary" />
            SATB Harmony Parts
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            Play each part individually to learn your line, or download them for
            practice.
          </p>
        </DialogHeader>

        <ScrollArea className="flex-1 -mx-6 px-6">
          {partTracks.length === 0 ? (
            <div className="flex flex-col items-center py-10 text-muted-foreground">
              <Music className="h-10 w-10 mb-3" />
              <p className="text-sm">No harmony parts generated yet.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pb-2">
              {PART_ORDER.map((partKey) => {
                const pt = partTracks.find((p) => p.partKey === partKey);
                if (!pt) return null;
                const state = partStates[partKey];
                if (!state) return null;
                const colors = PART_STYLES[partKey];

                return (
                  <div
                    key={partKey}
                    className={`rounded-lg border ${colors.border} ${colors.bg} p-3 space-y-3`}
                  >
                    {/* Header */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div
                          className={`h-2.5 w-2.5 rounded-full ${colors.dot}`}
                        />
                        <span
                          className={`text-sm font-semibold ${colors.text}`}
                        >
                          {partKey.charAt(0).toUpperCase() + partKey.slice(1)}
                        </span>
                      </div>
                      <Badge variant="outline" className="text-[10px]">
                        {partKey === "soprano" ? "Melody" : "Generated"}
                      </Badge>
                    </div>

                    {/* Playback */}
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 shrink-0"
                        onClick={() => togglePlay(partKey)}
                      >
                        {state.isPlaying ? (
                          <Pause className="h-4 w-4" />
                        ) : (
                          <Play className="h-4 w-4" />
                        )}
                      </Button>
                      <Slider
                        value={[state.currentTime]}
                        max={state.duration || 1}
                        step={0.1}
                        onValueChange={([v]) => handleSeek(partKey, v)}
                        className="flex-1"
                      />
                      <span className="text-[10px] text-muted-foreground font-mono whitespace-nowrap">
                        {formatTime(state.currentTime)}/
                        {formatTime(state.duration)}
                      </span>
                    </div>

                    {/* Volume + Download */}
                    <div className="flex items-center gap-2">
                      {state.volume > 0 ? (
                        <Volume2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      ) : (
                        <VolumeX className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      )}
                      <Slider
                        value={[state.volume * 100]}
                        max={100}
                        step={1}
                        onValueChange={([v]) =>
                          handleVolumeChange(partKey, v / 100)
                        }
                        className="flex-1"
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 w-8 p-0 shrink-0"
                        onClick={() => handleDownloadPart(partKey)}
                        disabled={state.isDownloading}
                      >
                        {state.isDownloading ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Download className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </div>

                    {/* Download progress */}
                    {state.isDownloading && (
                      <Progress value={state.downloadProgress} className="h-1" />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={isAnyPlaying ? stopAll : playAll}
            disabled={partTracks.length === 0}
          >
            {isAnyPlaying ? (
              <>
                <Square className="h-3.5 w-3.5 mr-1.5" />
                Stop All
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5 mr-1.5" />
                Play All
              </>
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleDownloadAll}
            disabled={partTracks.length === 0 || isDownloadingAll}
          >
            {isDownloadingAll ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5 mr-1.5" />
            )}
            Download All
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
