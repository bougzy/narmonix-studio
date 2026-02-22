"use client";

import { useState, useEffect } from "react";
import { Sparkles, ChevronDown, ChevronUp, Loader2, CheckCircle2 } from "lucide-react";
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
  "Generating Alto harmony...",
  "Generating Tenor harmony...",
  "Generating Bass harmony...",
  "Done!",
];

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

  const vocalTracks = tracks.filter(
    (t) => t.type === "vocal" || t.type === "mixed"
  );

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
      toast.success("Harmonies generated successfully!");
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
          <span className="text-sm font-semibold">AI Harmony Generator</span>
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
          <div className="flex items-end gap-3">
            <div className="flex-1 space-y-1">
              <label className="text-xs text-muted-foreground">
                Select vocal track
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
