"use client";

import { useState, useEffect } from "react";
import {
  Sparkles,
  ChevronDown,
  ChevronUp,
  Loader2,
  CheckCircle2,
  Music,
  Headphones,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { useEditorStore } from "@/store/useEditorStore";
import { getAudioEngine } from "@/lib/audioEngine";
import { generateHarmonies } from "@/lib/harmonyGenerator";
import { toast } from "sonner";

const HARMONY_STEPS = [
  "Loading source audio...",
  "Analyzing pitch and melody...",
  "Detecting key and scale...",
  "Synthesizing Alto part...",
  "Synthesizing Tenor part...",
  "Synthesizing Bass part...",
  "Done!",
];

/** Colors matching TrackLane harmony part colors */
const PART_COLORS: Record<string, string> = {
  soprano: "text-blue-400",
  alto: "text-green-400",
  tenor: "text-orange-400",
  bass: "text-red-400",
};

export function HarmonyPanel() {
  const {
    tracks,
    project,
    isGeneratingHarmonies,
    harmonyProgress,
    setGeneratingHarmonies,
    setHarmonyProgress,
    addTrack,
  } = useEditorStore();

  const [isCollapsed, setIsCollapsed] = useState(false);
  const [selectedTrackId, setSelectedTrackId] = useState<string>("");
  const [currentStep, setCurrentStep] = useState(0);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // Show all non-harmony tracks as candidates for harmony generation.
  // Uploaded songs, recordings, and instrumentals can all be harmonized.
  const vocalTracks = tracks.filter(
    (t) => t.type !== "harmony"
  );

  const harmonyTracks = tracks.filter((t) => t.type === "harmony");
  const hasHarmonies = harmonyTracks.length > 0;

  /** Solo a specific harmony part so the user can learn it */
  function practicePartSolo(partName: string) {
    const engine = getAudioEngine();
    // Un-solo everything first
    for (const t of tracks) {
      engine.soloTrack(t._id, false);
    }
    // Solo just this part
    const partTrack = harmonyTracks.find(
      (t) => t.harmonyPart === partName
    );
    if (partTrack) {
      engine.soloTrack(partTrack._id, true);
      toast.success(`Practicing ${partName} part — solo enabled`);
    }
  }

  /** Play all parts together */
  function practiceAllParts() {
    const engine = getAudioEngine();
    for (const t of tracks) {
      engine.soloTrack(t._id, false);
    }
    toast.success("All parts playing together");
  }

  async function handleGenerate() {
    if (!selectedTrackId || !project?._id) {
      toast.error("Please select a vocal track");
      return;
    }

    const sourceTrack = tracks.find((t) => t._id === selectedTrackId);
    if (!sourceTrack) return;

    setGeneratingHarmonies(true);
    setCurrentStep(0);

    try {
      const results = await generateHarmonies(
        sourceTrack.audioUrl,
        project.key,
        (step, message) => {
          setCurrentStep(step);
          setHarmonyProgress(message);
        }
      );

      // Upload each harmony and create track records
      const engine = getAudioEngine();

      for (const { part, blob } of results) {
        const formData = new FormData();
        formData.append("file", blob, `${part.part}_harmony.wav`);
        formData.append("projectId", project._id);

        const uploadRes = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        });
        if (!uploadRes.ok) {
          const err = await uploadRes.json().catch(() => ({}));
          throw new Error(
            err.message || `Failed to upload harmony (${uploadRes.status})`
          );
        }
        const { audioUrl } = await uploadRes.json();

        const trackRes = await fetch("/api/tracks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: project._id,
            name: part.name,
            type: "harmony",
            harmonyPart: part.part,
            audioUrl,
            fileName: `${part.part}_harmony.wav`,
            duration: sourceTrack.duration,
            volume: part.volume,
          }),
        });

        if (!trackRes.ok) throw new Error("Failed to create harmony track");
        const newTrack = await trackRes.json();
        addTrack(newTrack);
        await engine.addTrack(newTrack._id, newTrack.audioUrl);
      }

      setCurrentStep(HARMONY_STEPS.length - 1);
      toast.success("Harmonies generated! Use the practice buttons to learn each part.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to generate harmonies"
      );
    } finally {
      setGeneratingHarmonies(false);
      setHarmonyProgress("");
      setCurrentStep(0);
    }
  }

  return (
    <div className="border-t border-border bg-card">
      {/* Header */}
      <button
        className="w-full flex items-center justify-between px-4 py-2 hover:bg-accent/50 transition-colors"
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">SATB Harmony Generator</span>
          {hasHarmonies && (
            <span className="text-xs text-muted-foreground">
              ({harmonyTracks.length} parts)
            </span>
          )}
        </div>
        {isCollapsed ? (
          <ChevronDown className="h-4 w-4" />
        ) : (
          <ChevronUp className="h-4 w-4" />
        )}
      </button>

      {/* Content */}
      {!isCollapsed && (
        <div className="px-4 pb-4 space-y-4">
          {/* Generation controls */}
          <div className="flex items-end gap-3">
            <div className="flex-1 space-y-1">
              <label className="text-xs text-muted-foreground">
                Select vocal track (melody/soprano)
              </label>
              {mounted ? (
                <Select
                  value={selectedTrackId}
                  onValueChange={setSelectedTrackId}
                  disabled={isGeneratingHarmonies}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a track..." />
                  </SelectTrigger>
                  <SelectContent>
                    {vocalTracks.map((track) => (
                      <SelectItem key={track._id} value={track._id}>
                        {track.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <div className="h-9 w-full rounded-md border border-input bg-transparent" />
              )}
            </div>
            <Button
              onClick={handleGenerate}
              disabled={isGeneratingHarmonies || !selectedTrackId}
            >
              {isGeneratingHarmonies ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4 mr-2" />
              )}
              Generate Harmonies
            </Button>
          </div>

          {/* Progress */}
          {isGeneratingHarmonies && (
            <div className="space-y-3">
              <Progress
                value={(currentStep / (HARMONY_STEPS.length - 1)) * 100}
              />
              <div className="space-y-1">
                {HARMONY_STEPS.map((step, i) => (
                  <div
                    key={step}
                    className={`flex items-center gap-2 text-xs ${
                      i < currentStep
                        ? "text-green-400"
                        : i === currentStep
                        ? "text-primary"
                        : "text-muted-foreground"
                    }`}
                  >
                    {i < currentStep ? (
                      <CheckCircle2 className="h-3 w-3" />
                    ) : i === currentStep ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <div className="h-3 w-3 rounded-full border border-muted-foreground" />
                    )}
                    {step}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Practice Mode — shown when harmonies exist */}
          {hasHarmonies && !isGeneratingHarmonies && (
            <div className="space-y-2 pt-2 border-t border-border">
              <div className="flex items-center gap-2">
                <Headphones className="h-4 w-4 text-primary" />
                <span className="text-xs font-semibold">Practice Mode</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Solo a part to hear it alone and learn your line:
              </p>
              <div className="flex flex-wrap gap-2">
                {(["soprano", "alto", "tenor", "bass"] as const).map((part) => {
                  const exists =
                    part === "soprano"
                      ? vocalTracks.length > 0
                      : harmonyTracks.some((t) => t.harmonyPart === part);
                  if (!exists) return null;
                  return (
                    <Button
                      key={part}
                      variant="outline"
                      size="sm"
                      className={`text-xs ${PART_COLORS[part]}`}
                      onClick={() => {
                        if (part === "soprano") {
                          // Solo the original vocal track
                          const engine = getAudioEngine();
                          for (const t of tracks) engine.soloTrack(t._id, false);
                          if (selectedTrackId) engine.soloTrack(selectedTrackId, true);
                          toast.success("Practicing soprano (melody) — solo enabled");
                        } else {
                          practicePartSolo(part);
                        }
                      }}
                    >
                      <Music className="h-3 w-3 mr-1" />
                      {part.charAt(0).toUpperCase() + part.slice(1)}
                    </Button>
                  );
                })}
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs"
                  onClick={practiceAllParts}
                >
                  All Parts
                </Button>
              </div>
            </div>
          )}

          {vocalTracks.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Record or upload a vocal track first to generate harmonies.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
